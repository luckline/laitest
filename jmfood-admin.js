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
let activeView = "orders"
let refreshTimer = null
let loading = false
let generatedCodes = []

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

function expandTableNumbers(value) {
  const output = []
  const seen = new Set()
  const tokens = String(value || "").split(/[\s,，、;；]+/).map(item => item.trim()).filter(Boolean)
  for (const token of tokens) {
    const range = token.match(/^([A-Za-z\u4e00-\u9fa5_]*?)(\d+)-([A-Za-z\u4e00-\u9fa5_]*?)(\d+)$/)
    if (range) {
      const [, startPrefix, startDigits, endPrefixRaw, endDigits] = range
      const endPrefix = endPrefixRaw || startPrefix
      const start = Number(startDigits)
      const end = Number(endDigits)
      if (startPrefix !== endPrefix || end < start || end - start > 49) throw new Error(`无法识别桌号范围：${token}`)
      const width = Math.max(startDigits.length, endDigits.length)
      for (let number = start; number <= end; number += 1) {
        const tableNo = `${startPrefix}${String(number).padStart(width, "0")}`
        if (!seen.has(tableNo)) { seen.add(tableNo); output.push(tableNo) }
      }
      continue
    }
    if (!/^[A-Za-z0-9\u4e00-\u9fa5_-]{1,20}$/.test(token)) throw new Error(`桌号格式不正确：${token}`)
    if (!seen.has(token)) { seen.add(token); output.push(token) }
  }
  if (!output.length) throw new Error("请至少输入一个桌号")
  if (output.length > 50) throw new Error("单次最多生成 50 张桌码")
  return output
}

function renderCodes() {
  $("#downloadAllCodes").hidden = !generatedCodes.length
  $("#codeList").innerHTML = generatedCodes.map(code =>
    `<article class="code-card">
      <div class="code-image"><img src="data:${escapeHtml(code.mimeType)};base64,${code.base64}" alt="${escapeHtml(code.tableNo)} 桌小程序码"></div>
      <div><span>香满碗</span><b>${escapeHtml(code.tableNo)} 桌</b><small>微信扫码点餐</small></div>
      <button data-download-table="${escapeHtml(code.tableNo)}">下载 PNG</button>
    </article>`
  ).join("")
}

async function generateTableCodes() {
  const status = $("#codeStatus")
  const button = $("#generateCodes")
  let tableNumbers
  try {
    tableNumbers = expandTableNumbers($("#tableNumbers").value)
  } catch (error) {
    status.hidden = false
    status.className = "data-status error"
    status.textContent = error.message
    return
  }
  generatedCodes = []
  renderCodes()
  button.disabled = true
  status.hidden = false
  status.className = "data-status"
  try {
    for (let index = 0; index < tableNumbers.length; index += 1) {
      status.textContent = `正在生成 ${index + 1}/${tableNumbers.length}：${tableNumbers[index]} 桌`
      const code = await api("/admin/table-qrcode", {
        method: "POST",
        body: JSON.stringify({ tableNo: tableNumbers[index], width: 430 })
      })
      if (!/^[A-Za-z0-9+/=]+$/.test(code.base64 || "") ||
          !["image/png", "image/jpeg"].includes(code.mimeType)) {
        throw new Error(`${tableNumbers[index]} 桌返回的图片数据无效`)
      }
      generatedCodes.push(code)
      renderCodes()
    }
    status.className = "data-status success"
    status.textContent = `已生成 ${generatedCodes.length} 张桌码，请扫码确认后再印刷`
  } catch (error) {
    if ([401, 403].includes(error.status)) clearToken("管理凭证无效或已失效，请重新输入")
    else {
      status.className = "data-status error"
      status.textContent = `生成失败：${error.message}`
    }
  } finally {
    button.disabled = false
  }
}

function downloadCode(code) {
  const link = document.createElement("a")
  link.href = `data:${code.mimeType};base64,${code.base64}`
  link.download = code.fileName || `香满碗-${code.tableNo}桌.png`
  link.rel = "noopener"
  link.click()
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
    if (!document.hidden && activeView === "orders") loadOrders({ quiet: true })
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
$("#workspaceTabs").addEventListener("click", event => {
  const button = event.target.closest("[data-view]")
  if (!button) return
  activeView = button.dataset.view
  $("#workspaceTabs").querySelectorAll("button").forEach(item => item.classList.toggle("active", item === button))
  $("#ordersView").hidden = activeView !== "orders"
  $("#tablesView").hidden = activeView !== "tables"
  if (activeView === "orders") loadOrders({ quiet: true })
})
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
$("#generateCodes").addEventListener("click", generateTableCodes)
$("#downloadAllCodes").addEventListener("click", () => {
  generatedCodes.forEach((code, index) => setTimeout(() => downloadCode(code), index * 180))
})
$("#codeList").addEventListener("click", event => {
  const button = event.target.closest("[data-download-table]")
  if (!button) return
  const code = generatedCodes.find(item => item.tableNo === button.dataset.downloadTable)
  if (code) downloadCode(code)
})
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && token) loadOrders({ quiet: true })
})
window.addEventListener("beforeunload", stopAutoRefresh)

if (token) loadOrders()
else showLogin()
