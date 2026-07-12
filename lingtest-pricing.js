(() => {
  const API_BASE = "https://timelens.cc";
  const dialog = document.getElementById("leadDialog");
  const form = document.getElementById("leadForm");
  const message = document.getElementById("leadMessage");
  const proButton = document.querySelector('[data-open-lead="pro"]');
  const serviceButton = document.querySelector('[data-open-lead="service"]');
  let account = { loaded: false, user: null, entitlement: { plan: "free", active: false } };

  function openForm(source) {
    message.textContent = ""; message.className = "";
    form.elements.source.value = source;
    const mobile = account.user?.mobile || "";
    if (source === "pro" && mobile) {
      form.elements.contact.value = mobile;
      form.elements.contact.readOnly = true;
      form.elements.contact.closest("label").classList.add("verified-contact");
      if (!form.elements.name.value) form.elements.name.value = account.user?.nickname || "";
    } else {
      form.elements.contact.readOnly = false;
      form.elements.contact.closest("label").classList.remove("verified-contact");
    }
    dialog.showModal();
  }

  function loginForPro() {
    location.href = "/lingtest-login?return=%2Flingtest-pricing&intent=pro";
  }

  function renderAccountState() {
    const { user, entitlement } = account;
    const pro = entitlement.active && entitlement.plan === "pro";
    const pending = ["new", "contacted"].includes(entitlement.applicationStatus);
    const approved = entitlement.applicationStatus === "approved";
    document.body.classList.toggle("has-pro-plan", pro);
    document.querySelectorAll("[data-plan-entry]").forEach((link) => { link.textContent = pro ? "进入工作台" : "开始使用"; });
    if (pro) {
      document.querySelectorAll("[data-free-action]").forEach((link) => { link.textContent = "当前为专业版"; link.setAttribute("aria-disabled", "true"); link.removeAttribute("href"); });
      proButton.textContent = "专业版已生效"; proButton.disabled = true;
      document.querySelector('[data-plan-card="pro"]')?.classList.add("is-current");
      return;
    }
    if (pending) { proButton.textContent = "申请审核中"; proButton.disabled = true; return; }
    if (approved) { proButton.textContent = "前往工作台激活"; proButton.disabled = false; return; }
    proButton.textContent = user ? "申请专业版" : "登录后申请专业版";
    proButton.disabled = false;
  }

  proButton.disabled = true;
  proButton.textContent = "正在确认账户…";
  proButton.addEventListener("click", () => {
    if (!account.loaded) return;
    if (account.entitlement.applicationStatus === "approved") { location.href = "/app"; return; }
    if (!account.user) { loginForPro(); return; }
    openForm("pro");
  });
  serviceButton.addEventListener("click", () => openForm("service"));
  function handleAccountLoaded(detail) {
    account = { loaded: true, user: detail?.user || null, entitlement: detail?.entitlement || { plan: "free", active: false } };
    renderAccountState();
    const params = new URLSearchParams(location.search);
    if (params.get("intent") === "pro" && account.user && !account.entitlement.active && !account.entitlement.applicationStatus) {
      history.replaceState({}, "", "/lingtest-pricing");
      openForm("pro");
    }
  }
  window.addEventListener("lingtest:account-loaded", (event) => handleAccountLoaded(event.detail));
  if (window.LingTestAccount) handleAccountLoaded(window.LingTestAccount);

  document.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    const label = submit.textContent;
    submit.disabled = true; submit.textContent = "正在提交…"; message.textContent = ""; message.className = "";
    try {
      const payload = Object.fromEntries(new FormData(form));
      if (payload.source === "pro" && !account.user) { loginForPro(); return; }
      const tokenRaw = localStorage.getItem("timelens.pc.token");
      let token = "";
      try { const parsed = JSON.parse(tokenRaw || "null"); token = typeof parsed === "string" ? parsed : parsed?.token || ""; } catch { token = tokenRaw || ""; }
      const response = await fetch(`${API_BASE}/api/lingtest/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}`, "X-Auth-Token": token } : {}) },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.code !== 0) throw new Error(data.message || "提交失败，请稍后重试");
      message.textContent = "申请已收到，我们会尽快联系你。"; message.className = "success";
      proButton.textContent = "申请审核中"; proButton.disabled = true;
      window.va?.("event", { name: "lingtest_lead_submitted", source: payload.source || "pricing" });
      setTimeout(() => dialog.close(), 1800);
    } catch (error) { message.textContent = error.message || "提交失败，请稍后重试"; }
    finally { submit.disabled = false; submit.textContent = label; }
  });
})();
