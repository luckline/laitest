(() => {
  const API = "https://timelens.cc/api";
  const TOKEN_KEY = "timelens.pc.token";
  const params = new URLSearchParams(location.search);
  const requestedReturn = params.get("return") || "/mingtest-pricing";
  const safeReturn = requestedReturn.startsWith("/") && !requestedReturn.startsWith("//") ? requestedReturn : "/mingtest-pricing";
  const intent = params.get("intent") === "pro" ? "pro" : "";
  const destination = intent ? `${safeReturn}${safeReturn.includes("?") ? "&" : "?"}intent=${intent}` : safeReturn;
  const form = document.getElementById("loginForm");
  const message = document.getElementById("loginMessage");
  let mode = "login";

  function setMode(next) {
    mode = next;
    const registering = mode === "register";
    document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
    document.getElementById("confirmField").hidden = !registering;
    document.getElementById("registerNote").hidden = !registering;
    form.elements.password.autocomplete = registering ? "new-password" : "current-password";
    form.querySelector("button[type=submit]").textContent = registering ? "注册并继续" : "登录并继续";
    document.getElementById("loginHeading").textContent = registering ? "创建铭测账户" : "登录后继续";
    message.textContent = "";
  }

  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const mobile = String(form.elements.mobile.value || "").trim();
    const password = String(form.elements.password.value || "");
    const confirm = String(form.elements.passwordConfirm.value || "");
    if (!/^1[3-9]\d{9}$/.test(mobile)) { message.textContent = "请输入正确的 11 位手机号"; return; }
    if (mode === "register" && password !== confirm) { message.textContent = "两次输入的密码不一致"; return; }
    const submit = form.querySelector("button[type=submit]");
    const label = submit.textContent;
    submit.disabled = true; submit.textContent = mode === "register" ? "正在注册…" : "正在登录…"; message.textContent = "";
    try {
      const path = mode === "register" ? "/auth/mobile/register" : "/auth/mobile/password-login";
      const response = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mobile, password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || Number(data.code) !== 0) throw new Error(data.message || (mode === "register" ? "注册失败" : "登录失败"));
      const token = data.data?.token || data.token;
      if (!token) throw new Error("账户登录成功，但未获取到登录凭证");
      localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
      location.replace(destination);
    } catch (error) {
      message.textContent = error.message || "操作失败，请稍后重试";
      submit.disabled = false; submit.textContent = label;
    }
  });
})();
