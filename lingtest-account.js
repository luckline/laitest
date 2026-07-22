(() => {
  const LICENSE_API = "https://timelens.cc/api/lingtest/licenses";
  const USER_API = "https://timelens.cc/api/user/info";
  const BROWSER_KEY = "lingtest:browser-id:v1";
  const TOKEN_KEY = "timelens.pc.token";
  const actions = document.querySelector(".unified-nav .nav-actions,.unified-nav .workspace-actions");
  if (!actions) return;

  let browserId = localStorage.getItem(BROWSER_KEY);
  if (!browserId) {
    browserId = crypto.randomUUID();
    localStorage.setItem(BROWSER_KEY, browserId);
  }

  function readToken() {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return "";
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "string" ? parsed : parsed?.token || "";
    } catch { return raw; }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }
  function maskMobile(value) {
    const mobile = String(value || "");
    return mobile.length >= 7 ? `${mobile.slice(0, 3)}****${mobile.slice(-4)}` : mobile;
  }
  function maskEmail(value) {
    const [name, domain] = String(value || "").split("@");
    return domain ? `${name.slice(0, 2)}***@${domain}` : value || "";
  }

  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "lingtest-account-chip";
  chip.setAttribute("aria-label", "查看铭测账户与版本");
  chip.innerHTML = '<span class="account-avatar">游</span><span class="account-name">读取账户</span><strong>免费版</strong>';
  actions.appendChild(chip);

  const dialog = document.createElement("dialog");
  dialog.className = "lingtest-account-dialog";
  dialog.innerHTML = '<div class="lingtest-account-card"><button class="lingtest-account-close" aria-label="关闭">×</button><p class="lingtest-account-plan">ACCOUNT &amp; PLAN</p><h2>铭测免费版</h2><p class="lingtest-account-sub">账户身份与当前浏览器权益</p><div class="lingtest-account-details"></div><div class="lingtest-account-actions"></div></div>';
  document.body.appendChild(dialog);

  let user = null;
  let entitlement = { plan: "free", active: false };
  const userName = () => user?.nickname || (user?.mobile ? `用户 ${maskMobile(user.mobile)}` : "铭测用户");

  function render() {
    const pro = entitlement.active && entitlement.plan === "pro";
    const loggedIn = Boolean(user?.id);
    const applicationStatus = entitlement.applicationStatus;
    const pending = ["new", "contacted"].includes(applicationStatus);
    const approved = applicationStatus === "approved";
    const card = dialog.querySelector(".lingtest-account-card");
    const details = dialog.querySelector(".lingtest-account-details");
    const name = loggedIn ? userName() : "未登录";
    chip.classList.toggle("pro", pro);
    chip.classList.toggle("logged-in", loggedIn);
    chip.querySelector(".account-avatar").textContent = loggedIn ? name.trim().slice(0, 1) : "游";
    chip.querySelector(".account-name").textContent = name;
    chip.querySelector("strong").textContent = pro ? "PRO" : approved ? "待激活" : pending ? "审核中" : "免费版";
    document.querySelectorAll("[data-plan-cta]").forEach((link) => {
      link.textContent = pro ? "进入工作台" : approved ? "前往激活" : pending ? "申请审核中" : link.dataset.freeLabel || "开始使用";
      link.setAttribute("href", pro || approved ? "/app" : pending ? "/mingtest-pricing" : link.dataset.freeHref || "/app");
    });
    card.classList.toggle("pro", pro);
    card.querySelector("h2").textContent = pro ? "铭测专业版" : approved ? "专业版待激活" : pending ? "专业版申请审核中" : "铭测免费版";
    card.querySelector(".lingtest-account-sub").textContent = loggedIn ? "账户已登录，登录状态可在本站产品间共享" : "登录后，可在本站产品间共享账户身份";
    const identity = loggedIn
      ? `<div><span>账户</span><b>${escapeHtml(name)}</b></div><div><span>绑定信息</span><b>${escapeHtml(maskMobile(user.mobile) || maskEmail(user.email) || "微信账户")}</b></div>`
      : '<div><span>账户状态</span><b>未登录</b></div>';
    const plan = pro
      ? `<div><span>当前版本</span><b>专业版 PRO</b></div><div><span>有效期至</span><b>${entitlement.expiresAt ? new Date(entitlement.expiresAt).toLocaleDateString("zh-CN") : "长期有效"}</b></div><div><span>权益绑定</span><b>${escapeHtml(maskMobile(user?.mobile) || entitlement.contactMasked || "登录账户")}</b></div>`
      : approved
        ? '<div><span>申请状态</span><b>已通过，等待激活</b></div><div><span>当前权益</span><b>免费版</b></div><div><span>下一步</span><b>在工作台输入激活码</b></div>'
        : pending
          ? '<div><span>申请状态</span><b>审核中</b></div><div><span>当前权益</span><b>免费版</b></div><div><span>进度说明</span><b>通过后将获得激活码</b></div>'
          : '<div><span>当前版本</span><b>免费版</b></div><div><span>每日生成</span><b>5 次</b></div><div><span>每日执行</span><b>3 次</b></div>';
    details.innerHTML = identity + plan;
    dialog.querySelector(".lingtest-account-actions").innerHTML = pro
      ? '<a class="primary" href="/app">进入工作台</a>'
      : approved
        ? '<a class="primary" href="/app">前往激活</a>'
        : loggedIn
          ? '<a class="primary" href="/mingtest-pricing">查看专业版</a>'
        : `<a href="/mingtest-login?return=${encodeURIComponent(location.pathname)}">登录</a><a class="primary" href="/mingtest-pricing">查看专业版</a>`;
  }

  async function loadAccount() {
    const token = readToken();
    const userRequest = token
      ? fetch(USER_API, { headers: { Authorization: `Bearer ${token}`, "X-Auth-Token": token } }).then((response) => response.json()).then((data) => { user = data.code === 0 ? data.data : null; }).catch(() => { user = null; })
      : Promise.resolve().then(() => { user = null; });
    const licenseHeaders = token ? { Authorization: `Bearer ${token}`, "X-Auth-Token": token } : {};
    const licenseRequest = fetch(`${LICENSE_API}/status?browserId=${encodeURIComponent(browserId)}`, { headers: licenseHeaders }).then((response) => response.json()).then((data) => { if (data.code === 0) entitlement = data.data || entitlement; }).catch(() => {});
    await Promise.allSettled([userRequest, licenseRequest]);
    render();
    window.LingTestAccount = { user, entitlement };
    window.dispatchEvent(new CustomEvent("lingtest:account-loaded", { detail: { user, entitlement } }));
  }

  chip.addEventListener("click", () => { render(); dialog.showModal(); });
  dialog.querySelector(".lingtest-account-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  window.addEventListener("storage", (event) => { if (event.key === TOKEN_KEY) loadAccount(); });
  render();
  loadAccount();
})();
