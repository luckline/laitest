const API_BASE = "https://timelens.cc/api/jmfood"
const TOKEN_KEY = "jmfood:merchant-token"
const AUTO_REFRESH_MS = 15000

const $ = selector => document.querySelector(selector)
const loginPanel = $("#loginPanel")
const orderPanel = $("#orderPanel")
const orderList = $("#orderList")
const orderStatus = $("#orderStatus")
const loginMessage = $("#loginMessage")
let token = sessionStorage.getItem(TOKEN_KEY) || ""
let merchantSession = null
let currentStoreId = sessionStorage.getItem("jmfood:store-id") || ""
let activeStatus = ""
let activeView = "orders"
let refreshTimer = null
let loading = false
let generatedCodes = []
let adminMenu = null
let menuLoading = false
let tableRegistry = []
let tableRegistryLoading = false
let editingImageUrls = []
let imageUploading = false

function localDateValue(date = new Date()) {
  const pad = value => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

let activeOrderDate = localDateValue()

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
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      "Authorization": `Bearer ${token}`,
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
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
  $("#merchantPassword").value = ""
  $("#storePickerWrap").hidden = true
}

function showOrders() {
  loginPanel.hidden = true
  orderPanel.hidden = false
  $("#logout").hidden = false
  $("#storePickerWrap").hidden = false
  startAutoRefresh()
}

function clearToken(message = "") {
  token = ""
  sessionStorage.removeItem(TOKEN_KEY)
  merchantSession = null
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
    ["订单总数", orders.length, activeOrderDate],
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

function renderMenu() {
  const manager = $("#menuManager")
  const categories = adminMenu && Array.isArray(adminMenu.categories) ? adminMenu.categories : []
  if (!categories.length) {
    manager.innerHTML = `<div class="empty"><i>菜</i><b>还没有菜单分类</b><span>先新增分类，再添加菜品</span></div>`
    return
  }
  manager.innerHTML = categories.map(category => `
    <article class="menu-category ${category.enabled ? "" : "is-disabled"}">
      <header>
        <div>
          <span class="menu-order">排序 ${Number(category.sortOrder) || 0}</span>
          <h2>${escapeHtml(category.name)}</h2>
          <small>${category.items.length} 道菜 · ${category.enabled ? "前台展示中" : "分类已隐藏"}</small>
        </div>
        <div class="menu-actions">
          <button class="ghost-button" data-add-dish="${escapeHtml(category.id)}">添加菜品</button>
          <button class="ghost-button" data-edit-category="${escapeHtml(category.id)}">编辑分类</button>
          <button class="state-action ${category.enabled ? "danger" : ""}" data-toggle-category="${escapeHtml(category.id)}">${category.enabled ? "隐藏分类" : "恢复展示"}</button>
        </div>
      </header>
      <div class="dish-admin-list">
        ${category.items.length ? category.items.map(item => `
          <div class="dish-admin-row ${item.enabled ? "" : "is-disabled"}">
            <div class="dish-admin-icon">${item.imageUrl
              ? `<img src="${escapeHtml(item.imageUrl)}" alt="" referrerpolicy="no-referrer">`
              : escapeHtml(item.emoji || "🍽️")}</div>
            <div class="dish-admin-copy">
              <div><b>${escapeHtml(item.name)}</b>${item.tag ? `<em>${escapeHtml(item.tag)}</em>` : ""}</div>
              <span>${escapeHtml(item.description || "暂无描述")}</span>
              <small>排序 ${Number(item.sortOrder) || 0} · ${item.enabled ? "已上架" : "已下架"}</small>
            </div>
            <strong>¥${Number(item.price || 0).toFixed(2)}</strong>
            <div class="dish-admin-actions">
              <button data-edit-dish="${escapeHtml(item.id)}">编辑</button>
              <button class="${item.enabled ? "danger" : ""}" data-toggle-dish="${escapeHtml(item.id)}">${item.enabled ? "下架" : "上架"}</button>
            </div>
          </div>
        `).join("") : `<div class="menu-empty-row">该分类暂无菜品</div>`}
      </div>
    </article>
  `).join("")
}

async function loadMenu({ quiet = false } = {}) {
  if (menuLoading || !token) return
  menuLoading = true
  const status = $("#menuStatus")
  if (!quiet) {
    status.hidden = false
    status.className = "data-status"
    status.textContent = "正在读取菜单…"
  }
  try {
    adminMenu = await api(`/admin/stores/${encodeURIComponent(currentStoreId)}/menu`)
    renderMenu()
    status.className = "data-status success"
    status.textContent = `菜单已更新：${adminMenu.categories.length} 个分类，${adminMenu.categories.reduce((sum, category) => sum + category.items.length, 0)} 道菜`
  } catch (error) {
    if ([401, 403].includes(error.status)) clearToken("管理凭证无效或已失效，请重新输入")
    else {
      status.hidden = false
      status.className = "data-status error"
      status.textContent = `菜单读取失败：${error.message}`
    }
  } finally {
    menuLoading = false
  }
}

function findCategory(id) {
  return adminMenu?.categories.find(category => category.id === id)
}

function findDish(id) {
  for (const category of adminMenu?.categories || []) {
    const dish = category.items.find(item => item.id === id)
    if (dish) return dish
  }
  return null
}

function openEditor(type, record = {}, categoryId = "") {
  const categoryMode = type === "category"
  $("#editorMask").hidden = false
  document.body.classList.add("editor-open")
  $("#categoryForm").hidden = !categoryMode
  $("#dishForm").hidden = categoryMode
  $("#editorStatus").hidden = true
  $("#editorKicker").textContent = categoryMode ? "CATEGORY EDITOR" : "DISH EDITOR"
  $("#editorTitle").textContent = `${record.id ? "编辑" : "新增"}${categoryMode ? "分类" : "菜品"}`
  if (categoryMode) {
    $("#categoryId").value = record.id || ""
    $("#categoryName").value = record.name || ""
    $("#categorySort").value = Number(record.sortOrder) || 0
    $("#categoryEnabled").checked = record.enabled !== false
    setTimeout(() => $("#categoryName").focus(), 0)
    return
  }
  $("#dishCategory").innerHTML = (adminMenu?.categories || []).map(category =>
    `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}${category.enabled ? "" : "（已隐藏）"}</option>`
  ).join("")
  $("#dishId").value = record.id || ""
  $("#dishName").value = record.name || ""
  $("#dishCategory").value = record.categoryId || categoryId
  $("#dishPrice").value = record.id ? Number(record.price).toFixed(2) : ""
  $("#dishSort").value = Number(record.sortOrder) || 0
  $("#dishEmoji").value = record.emoji || ""
  editingImageUrls = Array.isArray(record.imageUrls) && record.imageUrls.length
    ? record.imageUrls.slice(0, 3)
    : (record.imageUrl ? [record.imageUrl] : [])
  renderDishImageGallery()
  $("#dishTag").value = record.tag || ""
  $("#dishDescription").value = record.description || ""
  $("#dishEnabled").checked = record.enabled !== false
  setTimeout(() => $("#dishName").focus(), 0)
}

function renderDishImageGallery() {
  $("#chooseDishImages").disabled = imageUploading || editingImageUrls.length >= 3
  $("#chooseDishImages").textContent = imageUploading
    ? "上传中…"
    : (editingImageUrls.length >= 3 ? "已满 3 张" : "选择图片")
  $("#dishImageGallery").innerHTML = editingImageUrls.map((url, index) => `
    <figure>
      <img src="${escapeHtml(url)}" alt="菜品图片 ${index + 1}" referrerpolicy="no-referrer">
      <button type="button" data-remove-dish-image="${index}" aria-label="移除第 ${index + 1} 张图片">×</button>
      <figcaption>第 ${index + 1} 张${index === 0 ? " · 封面" : ""}</figcaption>
    </figure>
  `).join("")
}

async function uploadDishImages(files) {
  const selected = [...files]
  const available = 3 - editingImageUrls.length
  const status = $("#editorStatus")
  if (!selected.length) return
  if (selected.length > available) {
    status.hidden = false
    status.className = "data-status error"
    status.textContent = `最多还能上传 ${available} 张图片`
    return
  }
  const invalid = selected.find(file =>
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024
  )
  if (invalid) {
    status.hidden = false
    status.className = "data-status error"
    status.textContent = "图片必须是 JPEG、PNG 或 WebP，且单张不超过 5MB"
    return
  }
  imageUploading = true
  renderDishImageGallery()
  try {
    for (let index = 0; index < selected.length; index += 1) {
      status.hidden = false
      status.className = "data-status"
      status.textContent = `正在上传 ${index + 1}/${selected.length}…`
      const form = new FormData()
      form.append("storeId", currentStoreId)
      form.append("image", selected[index])
      const result = await api("/admin/menu/images/upload", { method: "POST", body: form })
      if (!result.url) throw new Error("上传成功，但服务端未返回图片地址")
      editingImageUrls.push(result.url)
      renderDishImageGallery()
    }
    status.className = "data-status success"
    status.textContent = `已上传 ${editingImageUrls.length}/3 张图片`
  } catch (error) {
    if ([401, 403].includes(error.status)) clearToken("管理凭证无效或已失效，请重新输入")
    else {
      status.className = "data-status error"
      status.textContent = error.message
    }
  } finally {
    imageUploading = false
    $("#dishImageFiles").value = ""
    renderDishImageGallery()
  }
}

function closeEditor() {
  $("#editorMask").hidden = true
  document.body.classList.remove("editor-open")
}

async function saveEditor(form, path, method, payload) {
  const status = $("#editorStatus")
  const submit = form.querySelector('[type="submit"]')
  if (imageUploading) return
  submit.disabled = true
  status.hidden = false
  status.className = "data-status"
  status.textContent = "正在保存…"
  try {
    await api(path, { method, body: JSON.stringify(payload) })
    closeEditor()
    await loadMenu()
  } catch (error) {
    if ([401, 403].includes(error.status)) clearToken("管理凭证无效或已失效，请重新输入")
    else {
      status.className = "data-status error"
      status.textContent = error.message
    }
  } finally {
    submit.disabled = false
  }
}

async function toggleMenuRecord(type, record) {
  const isCategory = type === "category"
  const path = `/admin/stores/${encodeURIComponent(currentStoreId)}/menu/${isCategory ? "categories" : "items"}/${encodeURIComponent(record.id)}`
  try {
    await api(path, { method: "PATCH", body: JSON.stringify({ enabled: !record.enabled }) })
    await loadMenu({ quiet: true })
  } catch (error) {
    if ([401, 403].includes(error.status)) clearToken("管理凭证无效或已失效，请重新输入")
    else alert(error.message)
  }
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
  const storeName = merchantSession?.stores?.find(store => store.id === currentStoreId)?.name || currentStoreId
  $("#downloadAllCodes").hidden = !generatedCodes.length
  $("#codeList").innerHTML = generatedCodes.map(code =>
    `<article class="code-card">
      <div class="code-image"><img src="data:${escapeHtml(code.mimeType)};base64,${code.base64}" alt="${escapeHtml(code.tableNo)} 桌小程序码"></div>
      <div><span>${escapeHtml(storeName)}</span><b>${escapeHtml(code.tableNo)} 桌</b><small>微信扫码点餐</small></div>
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
        body: JSON.stringify({ storeId: currentStoreId, tableNo: tableNumbers[index], width: 430 })
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
    await loadTables({ quiet: true })
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

function renderTables() {
  const list = $("#registeredTableList")
  if (!tableRegistry.length) {
    list.innerHTML = `<div class="menu-empty-row">尚未登记桌台，生成桌码后会自动登记</div>`
    return
  }
  list.innerHTML = tableRegistry.map(table => `
    <article class="${table.enabled ? "" : "is-disabled"}">
      <div><b>${escapeHtml(table.tableNo)} 桌</b><span>${table.enabled ? "可正常下单" : "已暂停下单"}</span></div>
      <button class="${table.enabled ? "danger" : ""}" data-toggle-table="${escapeHtml(table.tableNo)}">${table.enabled ? "停用" : "启用"}</button>
    </article>
  `).join("")
}

async function loadTables({ quiet = false } = {}) {
  if (tableRegistryLoading || !token) return
  tableRegistryLoading = true
  const status = $("#tableRegistryStatus")
  if (!quiet) {
    status.hidden = false
    status.className = "data-status"
    status.textContent = "正在读取桌台…"
  }
  try {
    const data = await api(`/admin/stores/${encodeURIComponent(currentStoreId)}/tables`)
    tableRegistry = Array.isArray(data.list) ? data.list : []
    renderTables()
    status.hidden = true
  } catch (error) {
    if ([401, 403].includes(error.status)) clearToken("管理凭证无效或已失效，请重新输入")
    else {
      status.hidden = false
      status.className = "data-status error"
      status.textContent = `桌台读取失败：${error.message}`
    }
  } finally {
    tableRegistryLoading = false
  }
}

async function toggleTable(tableNo) {
  const table = tableRegistry.find(item => item.tableNo === tableNo)
  if (!table) return
  try {
    await api(`/admin/stores/${encodeURIComponent(currentStoreId)}/tables/${encodeURIComponent(tableNo)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !table.enabled })
    })
    await loadTables()
  } catch (error) {
    if ([401, 403].includes(error.status)) clearToken("管理凭证无效或已失效，请重新输入")
    else alert(error.message)
  }
}

function downloadCode(code) {
  const link = document.createElement("a")
  link.href = `data:${code.mimeType};base64,${code.base64}`
  link.download = code.fileName || `${currentStoreId}-${code.tableNo}桌.png`
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
    const data = await api(`/stores/${encodeURIComponent(currentStoreId)}/orders?date=${encodeURIComponent(activeOrderDate)}`)
    const orders = Array.isArray(data.list) ? data.list : []
    renderSummary(orders)
    renderOrders(activeStatus ? orders.filter(order => order.status === activeStatus) : orders)
    orderStatus.hidden = true
    $("#updatedAt").textContent = `更新于 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
    $("#orderHeading").textContent = activeOrderDate === localDateValue() ? "今日订单" : `${activeOrderDate} 订单`
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
      body: JSON.stringify({ storeId: currentStoreId, status: nextStatus })
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

async function bootstrapSession() {
  const data = await api("/merchant/auth/me")
  merchantSession = data
  const stores = Array.isArray(data.stores) ? data.stores : []
  if (!stores.length) throw new Error("该账号尚未授权任何门店")
  if (!stores.some(store => store.id === currentStoreId)) currentStoreId = stores[0].id
  sessionStorage.setItem("jmfood:store-id", currentStoreId)
  $("#storePicker").innerHTML = stores.map(store =>
    `<option value="${escapeHtml(store.id)}">${escapeHtml(store.name)} · ${escapeHtml(store.role || "")}</option>`
  ).join("")
  $("#storePicker").value = currentStoreId
  const store = stores.find(item => item.id === currentStoreId)
  $("#headerStoreName").textContent = store?.name || "锦食铭味"
  showOrders()
  await loadOrders()
}

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault()
  loginMessage.textContent = "正在登录…"
  try {
    const response = await fetch(`${API_BASE}/merchant/auth/login`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: $("#merchantUsername").value.trim(),
        password: $("#merchantPassword").value
      })
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body.code !== 0 || !body.data?.token) throw new Error(body.message || "登录失败")
    token = body.data.token
    sessionStorage.setItem(TOKEN_KEY, token)
    loginMessage.textContent = ""
    await bootstrapSession()
  } catch (error) {
    clearToken(error.message)
  }
})

$("#logout").addEventListener("click", () => clearToken())
$("#refreshOrders").addEventListener("click", () => loadOrders())
$("#orderDate").value = activeOrderDate
$("#orderDate").addEventListener("change", event => {
  if (!event.target.value) {
    event.target.value = activeOrderDate
    return
  }
  activeOrderDate = event.target.value
  loadOrders()
})
$("#workspaceTabs").addEventListener("click", event => {
  const button = event.target.closest("[data-view]")
  if (!button) return
  activeView = button.dataset.view
  $("#workspaceTabs").querySelectorAll("button").forEach(item => item.classList.toggle("active", item === button))
  $("#ordersView").hidden = activeView !== "orders"
  $("#menuView").hidden = activeView !== "menu"
  $("#tablesView").hidden = activeView !== "tables"
  if (activeView === "orders") loadOrders({ quiet: true })
  if (activeView === "menu") loadMenu()
  if (activeView === "tables") loadTables()
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
$("#refreshMenu").addEventListener("click", () => loadMenu())
$("#addCategory").addEventListener("click", () => openEditor("category"))
$("#menuManager").addEventListener("click", event => {
  const addDish = event.target.closest("[data-add-dish]")
  if (addDish) return openEditor("dish", {}, addDish.dataset.addDish)
  const editCategory = event.target.closest("[data-edit-category]")
  if (editCategory) return openEditor("category", findCategory(editCategory.dataset.editCategory))
  const toggleCategory = event.target.closest("[data-toggle-category]")
  if (toggleCategory) return toggleMenuRecord("category", findCategory(toggleCategory.dataset.toggleCategory))
  const editDish = event.target.closest("[data-edit-dish]")
  if (editDish) return openEditor("dish", findDish(editDish.dataset.editDish))
  const toggleDish = event.target.closest("[data-toggle-dish]")
  if (toggleDish) return toggleMenuRecord("dish", findDish(toggleDish.dataset.toggleDish))
})
$("#categoryForm").addEventListener("submit", event => {
  event.preventDefault()
  const id = $("#categoryId").value
  saveEditor(
    event.currentTarget,
    `/admin/stores/${encodeURIComponent(currentStoreId)}/menu/categories${id ? `/${encodeURIComponent(id)}` : ""}`,
    id ? "PATCH" : "POST",
    {
      name: $("#categoryName").value,
      sortOrder: Number($("#categorySort").value),
      enabled: $("#categoryEnabled").checked
    }
  )
})
$("#dishForm").addEventListener("submit", event => {
  event.preventDefault()
  const id = $("#dishId").value
  saveEditor(
    event.currentTarget,
    `/admin/stores/${encodeURIComponent(currentStoreId)}/menu/items${id ? `/${encodeURIComponent(id)}` : ""}`,
    id ? "PATCH" : "POST",
    {
      categoryId: $("#dishCategory").value,
      name: $("#dishName").value,
      price: $("#dishPrice").value,
      sortOrder: Number($("#dishSort").value),
      emoji: $("#dishEmoji").value,
      imageUrls: editingImageUrls,
      tag: $("#dishTag").value,
      description: $("#dishDescription").value,
      enabled: $("#dishEnabled").checked
    }
  )
})
$("#closeEditor").addEventListener("click", closeEditor)
$("#chooseDishImages").addEventListener("click", () => $("#dishImageFiles").click())
$("#dishImageFiles").addEventListener("change", event => uploadDishImages(event.target.files || []))
$("#dishImageGallery").addEventListener("click", event => {
  const button = event.target.closest("[data-remove-dish-image]")
  if (!button || imageUploading) return
  editingImageUrls.splice(Number(button.dataset.removeDishImage), 1)
  renderDishImageGallery()
})
$("#editorMask").addEventListener("click", event => {
  if (event.target === event.currentTarget || event.target.closest("[data-close-editor]")) closeEditor()
})
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("#editorMask").hidden) closeEditor()
})
$("#generateCodes").addEventListener("click", generateTableCodes)
$("#refreshTables").addEventListener("click", () => loadTables())
$("#registeredTableList").addEventListener("click", event => {
  const button = event.target.closest("[data-toggle-table]")
  if (button) toggleTable(button.dataset.toggleTable)
})
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

$("#storePicker").addEventListener("change", async event => {
  currentStoreId = event.target.value
  sessionStorage.setItem("jmfood:store-id", currentStoreId)
  const store = merchantSession?.stores?.find(item => item.id === currentStoreId)
  $("#headerStoreName").textContent = store?.name || "锦食铭味"
  adminMenu = null
  generatedCodes = []
  await loadOrders()
  if (activeView === "menu") await loadMenu()
  if (activeView === "tables") await loadTables()
})

if (token) bootstrapSession().catch(error => clearToken(error.message))
else showLogin()
