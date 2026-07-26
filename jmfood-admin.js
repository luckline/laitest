const API_BASE = "https://timelens.cc/api/jmfood"
const STORE_ID = "demo-store"
const TOKEN_KEY = "jmfood:merchant-token"
const AUTO_REFRESH_MS = 15000

const $ = selector => document.querySelector(selector)
const loginPanel = $("#loginPanel")
const orderPanel = $("#orderPanel")
const orderList = $("#orderList")
const orderStatus = $("#orderStatus")
const loginMessage = $("#loginMessage")
let token = sessionStorage.getItem(TOKEN_KEY) || ""
let activeStatus = ""
let refreshTimer = null
let loading = false

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]))

function formatTime(value) {
  if (!value) return "时间未知"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "时间未知"
    : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      ...options.headers
    }
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.code !== 0) {
    const error = new Error(body.message || `请求失败（${response.status}）`)
    error.status = response.status
    throw error
  }
  return body.data || {}
}

function showLogin(message = "") {
  stopAutoRefresh()
  loginPanel.hidden = false
  orderPanel.hidden = true
  $("#logout").hidden = true
  loginMessage.textContent = message
  $("#merchantToken").value = ""
}

function showOrders() {
  loginPanel.hidden = true
  orderPanel.hidden = false
  $("#logout").hidden = false
  startAutoRefresh()
}

function clearToken(message = "") {
  token = ""
  sessionStorage.removeItem(TOKEN_KEY)
  showLogin(message)
}

function statusClass(status) {
  if (status === "已完成") return "completed"
  if (status === "制作中") return "preparing"
  return "pending"
}

function renderSummary(orders) {
  const count = status => orders.filter(order => order.status === status).length
  const revenue = orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0)
  const cards = [
    ["全部订单", orders.length, "今天"],
    ["待接单", count("待接单"), "请及时处理"],
    ["制作中", count("制作中"), "后厨进行中"],
    ["订单金额", `¥${revenue.toFixed(2)}`, "未扣除退款"]
  ]
  $("#summary").innerHTML = cards.map(([label, value, note]) =>
    `<article><span>${label}</span><strong>${escapeHtml(value)}</strong><small>${note}</small></article>`
  ).join("")
}

function renderOrders(orders) {
  if (!orders.length) {
    orderList.innerHTML = `<div class="empty"><i>单</i><b>暂无${escapeHtml(activeStatus)}订单</b><span>新订单到达后会自动显示在这里</span></div>`
    return
  }
  orderList.innerHTML = orders.map(order => {
    const items = Array.isArray(order.items) ? order.items : []
    const nextStatus = order.status === "待接单" ? "制作中" : "已完成"
    const action = order.status === "已完成" ? "" :
      `<button class="order-action" data-order-id="${escapeHtml(order.id)}" data-next-status="${nextStatus}">${order.status === "待接单" ? "接单制作" : "完成订单"}</button>`
    return `<article class="order-card">
      <header>
        <div><b>${escapeHtml(order.tableNo || "—")} 桌</b><small>${escapeHtml(formatTime(order.createdAt || order.created_at))} · ${escapeHtml(order.id)}</small></div>
        <span class="order-state ${statusClass(order.status)}">${escapeHtml(order.status || "状态未知")}</span>
      </header>
      <div class="foods">${items.map(item =>
        `<div><span>${escapeHtml(item.name)}</span><b>× ${Number(item.count) || 0}</b><em>¥${((Number(item.price) || 0) * (Number(item.count) || 0)).toFixed(2)}</em></div>`
      ).join("") || "<div><span>未返回菜品明细</span></div>"}</div>
      ${order.remark ? `<div class="remark"><b>备注</b><span>${escapeHtml(order.remark)}</span></div>` : ""}
      <footer>
        <div><small>${escapeHtml(order.paymentStatus || "支付状态未知")}</small><strong><i>¥</i>${Number(order.total || 0).toFixed(2)}</strong></div>
        ${action}
      </footer>
    </article>`
  }).join("")
}

async function loadOrders({ quiet = false } = {}) {
  if (loading || !token) return
  loading = true
  if (!quiet) {
    orderStatus.hidden = false
    orderStatus.className = "data-status"
    orderStatus.textContent = "正在读取订单…"
  }
  try {
    const data = await api(`/stores/${encodeURIComponent(STORE_ID)}/orders`)
    const orders = Array.isArray(data.list) ? data.list : []
    renderSummary(orders)
    renderOrders(activeStatus ? orders.filter(order => order.status === activeStatus) : orders)
    orderStatus.hidden = true
    $("#updatedAt").textContent = `更新于 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
    $("#connectionCopy").textContent = "订单数据已连接"
    showOrders()
  } catch (error) {
    if ([401, 403].includes(error.status)) {
      clearToken("管理凭证无效或已失效，请重新输入")
      return
    }
    orderStatus.hidden = false
    orderStatus.className = "data-status error"
    orderStatus.textContent = `订单读取失败：${error.message}`
    $("#connectionCopy").textContent = "连接异常"
  } finally {
    loading = false
  }
}

async function updateStatus(orderId, nextStatus, button) {
  button.disabled = true
  button.textContent = "处理中…"
  try {
    await api(`/orders/${encodeURIComponent(orderId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: nextStatus })
    })
    await loadOrders()
  } catch (error) {
    if ([401, 403].includes(error.status)) clearToken("管理凭证无效或已失效，请重新输入")
    else alert(error.message)
  } finally {
    button.disabled = false
  }
}

function startAutoRefresh() {
  stopAutoRefresh()
  refreshTimer = setInterval(() => {
    if (!document.hidden) loadOrders({ quiet: true })
  }, AUTO_REFRESH_MS)
}

function stopAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = null
}

$("#loginForm").addEventListener("submit", event => {
  event.preventDefault()
  token = $("#merchantToken").value.trim()
  if (!token) return
  sessionStorage.setItem(TOKEN_KEY, token)
  loginMessage.textContent = ""
  loadOrders()
})

$("#logout").addEventListener("click", () => clearToken())
$("#refreshOrders").addEventListener("click", () => loadOrders())
$("#statusTabs").addEventListener("click", event => {
  const button = event.target.closest("[data-status]")
  if (!button) return
  activeStatus = button.dataset.status
  $("#statusTabs").querySelectorAll("button").forEach(item => item.classList.toggle("active", item === button))
  loadOrders()
})
orderList.addEventListener("click", event => {
  const button = event.target.closest("[data-order-id]")
  if (button) updateStatus(button.dataset.orderId, button.dataset.nextStatus, button)
})
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && token) loadOrders({ quiet: true })
})
window.addEventListener("beforeunload", stopAutoRefresh)

if (token) loadOrders()
else showLogin()
