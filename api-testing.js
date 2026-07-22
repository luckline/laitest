(() => {
  const API_BASE = "https://timelens.cc/api/testing";
  const TOKEN_KEY = "timelens.pc.token";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const state = { projects: [], projectId: "", tab: "environments", resources: { environments: [], cases: [], suites: [], runs: [] }, editing: null };

  function token() {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return "";
    try { const parsed = JSON.parse(raw); return typeof parsed === "string" ? parsed : parsed?.token || ""; } catch (_) { return raw; }
  }

  async function request(path, options = {}) {
    if (!token()) throw new Error("请先登录后使用接口自动化工作台");
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}`, ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.code !== 0) throw new Error(payload.message || `请求失败（${response.status}）`);
    return payload.data;
  }

  function notice(message = "", type = "") {
    const box = $("#apiTestingNotice");
    box.hidden = !message; box.className = `api-testing-notice ${type}`; box.textContent = message;
  }

  function selectedProject() { return state.projects.find(project => project.id === state.projectId); }

  function renderProjects() {
    $("#apiProjectBadge").textContent = state.projects.length;
    $("#apiLoginState").textContent = token() ? `已登录 · ${state.projects.length} 个项目` : "登录后可使用";
    $("#apiProjectList").innerHTML = state.projects.length ? state.projects.map(project => `
      <button type="button" data-project-id="${esc(project.id)}" class="${project.id === state.projectId ? "active" : ""}">
        <span>${esc(project.name.slice(0, 1).toUpperCase())}</span><div><b>${esc(project.name)}</b><small>${Number(project.caseCount || 0)} 用例 · ${Number(project.suiteCount || 0)} 套件</small></div>
      </button>`).join("") : `<div class="api-list-empty"><b>暂无项目</b><span>点击右上角 ＋ 创建</span></div>`;
    const project = selectedProject();
    $("#apiProjectEmpty").hidden = Boolean(project); $("#apiProjectPanel").hidden = !project;
    if (project) { $("#apiProjectName").textContent = project.name; $("#apiProjectDescription").textContent = project.description || "暂无项目说明"; }
  }

  const tabMeta = {
    environments: ["测试环境", "配置基础地址、公共请求头和运行变量", "＋ 新建环境"],
    cases: ["接口用例", "定义请求、断言与响应变量提取", "＋ 新建用例"],
    suites: ["测试套件", "编排用例顺序并批量执行", "＋ 新建套件"],
    runs: ["运行报告", "查看最近 100 次套件执行结果", "刷新报告"],
  };

  function renderResources() {
    const list = state.resources[state.tab] || [], meta = tabMeta[state.tab];
    $("#apiTabTitle").textContent = meta[0]; $("#apiTabHint").textContent = meta[1]; $("#apiPrimaryAction").textContent = meta[2];
    $$("[data-api-tab]").forEach(button => button.classList.toggle("active", button.dataset.apiTab === state.tab));
    if (!list.length) { $("#apiResourceList").innerHTML = `<div class="api-list-empty large"><b>还没有${esc(meta[0])}</b><span>${esc(meta[1])}</span></div>`; return; }
    if (state.tab === "environments") {
      $("#apiResourceList").innerHTML = list.map(item => `<article><div class="api-resource-icon env">ENV</div><div class="api-resource-main"><b>${esc(item.name)}</b><code>${esc(item.base_url)}</code><small>${Object.keys(item.variables || {}).length} 个变量 · ${Object.keys(item.headers || {}).length} 个公共请求头</small></div><div class="api-card-actions"><button data-edit-id="${esc(item.id)}">编辑</button><button class="danger" data-delete-id="${esc(item.id)}">删除</button></div></article>`).join("");
    } else if (state.tab === "cases") {
      $("#apiResourceList").innerHTML = list.map(item => `<article><div class="api-method ${esc(String(item.request?.method || "GET").toLowerCase())}">${esc(item.request?.method || "GET")}</div><div class="api-resource-main"><div><span class="api-priority">${esc(item.priority || "P1")}</span><b>${esc(item.name)}</b></div><code>${esc(item.request?.path || item.request?.url || "未配置请求地址")}</code><small>${(item.assertions || []).length} 条断言 · ${(item.extractors || []).length} 个变量提取</small></div><div class="api-card-actions"><button data-debug-id="${esc(item.id)}">调试</button><button data-edit-id="${esc(item.id)}">编辑</button><button class="danger" data-delete-id="${esc(item.id)}">删除</button></div></article>`).join("");
    } else if (state.tab === "suites") {
      $("#apiResourceList").innerHTML = list.map(item => `<article><div class="api-resource-icon suite">▶</div><div class="api-resource-main"><b>${esc(item.name)}</b><span>${esc(item.description || "暂无说明")}</span><small>${(item.case_ids || []).length} 条用例 · ${item.stop_on_failure ? "失败即停止" : "全部执行"}</small></div><div class="api-card-actions"><button class="primary" data-run-suite="${esc(item.id)}">运行</button><button data-edit-id="${esc(item.id)}">编辑</button><button class="danger" data-delete-id="${esc(item.id)}">删除</button></div></article>`).join("");
    } else {
      $("#apiResourceList").innerHTML = list.map(item => `<article class="api-run-card"><div class="api-run-status ${esc(item.status)}">${item.status === "passed" ? "✓" : "!"}</div><div class="api-resource-main"><b>${esc(item.status === "passed" ? "执行通过" : "执行失败")}</b><span>${esc(new Date(item.startedAt).toLocaleString("zh-CN"))}</span><small>${Number(item.passed || 0)}/${Number(item.total || 0)} 通过 · ${Number(item.durationMs || 0)} ms</small></div><div class="api-card-actions"><button data-run-detail="${esc(item.id)}">查看报告</button></div></article>`).join("");
    }
  }

  async function loadProjects(selectId) {
    if (!token()) { state.projects = []; state.projectId = ""; renderProjects(); notice("需要登录后才能保存和运行接口测试。", "warn"); return; }
    try {
      state.projects = await request("/projects");
      state.projectId = selectId || (state.projects.some(item => item.id === state.projectId) ? state.projectId : state.projects[0]?.id || "");
      renderProjects(); notice(); if (state.projectId) await loadTab();
    } catch (error) { notice(error.message, "error"); }
  }

  async function loadTab() {
    if (!state.projectId) return;
    try { state.resources[state.tab] = await request(`/projects/${encodeURIComponent(state.projectId)}/${state.tab}`); renderResources(); }
    catch (error) { notice(error.message, "error"); }
  }

  function field(label, name, value = "", options = {}) {
    const required = options.required ? "required" : "", full = options.full === false ? "" : "full";
    if (options.type === "textarea") return `<label class="${full}"><span>${esc(label)}</span><textarea name="${esc(name)}" ${required} spellcheck="false" placeholder="${esc(options.placeholder || "")}">${esc(value)}</textarea>${options.hint ? `<small>${esc(options.hint)}</small>` : ""}</label>`;
    if (options.type === "select") return `<label class="${full}"><span>${esc(label)}</span><select name="${esc(name)}">${options.options.map(option => `<option value="${esc(option)}" ${String(option) === String(value) ? "selected" : ""}>${esc(option)}</option>`).join("")}</select></label>`;
    return `<label class="${full}"><span>${esc(label)}</span><input name="${esc(name)}" type="${esc(options.type || "text")}" value="${esc(value)}" ${required} placeholder="${esc(options.placeholder || "")}"></label>`;
  }

  function pretty(value, fallback) { return JSON.stringify(value ?? fallback, null, 2); }
  function parseJson(form, name, fallback) { const raw = form.elements[name]?.value.trim(); if (!raw) return fallback; try { return JSON.parse(raw); } catch (_) { throw new Error(`${name} 不是有效 JSON`); } }

  function openEditor(kind, item = null) {
    state.editing = { kind, item };
    const dialog = $("#apiEditorDialog"), fields = $("#apiEditorFields");
    $("#apiEditorTitle").textContent = `${item ? "编辑" : "新建"}${{ project: "项目", environments: "环境", cases: "用例", suites: "套件" }[kind]}`;
    $("#apiEditorEyebrow").textContent = kind.toUpperCase(); $("#apiEditorMessage").textContent = "";
    if (kind === "project") fields.innerHTML = field("项目名称", "name", item?.name, { required: true }) + field("项目说明", "description", item?.description, { type: "textarea", placeholder: "例如：交易中心核心接口回归" });
    if (kind === "environments") fields.innerHTML = field("环境名称", "name", item?.name, { required: true, full: false }) + field("Base URL", "base_url", item?.base_url, { required: true, full: false, placeholder: "https://api.example.com" }) + field("公共变量（JSON）", "variables", pretty(item?.variables, { token: "" }), { type: "textarea", hint: "用例中可通过 {{token}} 引用" }) + field("公共请求头（JSON）", "headers", pretty(item?.headers, { "Content-Type": "application/json" }), { type: "textarea" });
    if (kind === "cases") fields.innerHTML = field("用例名称", "name", item?.name, { required: true, full: false }) + field("优先级", "priority", item?.priority || "P1", { type: "select", options: ["P0", "P1", "P2"], full: false }) + field("用例说明", "description", item?.description, { type: "textarea" }) + field("请求配置（JSON）", "request", pretty(item?.request, { method: "GET", path: "/api/health", headers: {}, query: {} }), { type: "textarea", required: true, hint: "支持 method、path/url、headers、query、body、timeoutMs" }) + field("断言（JSON 数组）", "assertions", pretty(item?.assertions, [{ type: "status", expected: 200 }, { type: "json_path", path: "$.code", expected: 0 }]), { type: "textarea", hint: "支持 status、response_time、header、contains、json_path、json_equals" }) + field("变量提取（JSON 数组）", "extractors", pretty(item?.extractors, []), { type: "textarea", hint: "例如：[{\"name\":\"token\",\"path\":\"$.data.token\"}]" });
    if (kind === "suites") {
      const selected = new Set(item?.case_ids || []);
      fields.innerHTML = field("套件名称", "name", item?.name, { required: true }) + field("套件说明", "description", item?.description, { type: "textarea" }) + `<fieldset class="full api-case-picker"><legend>选择用例并确定执行顺序</legend>${state.resources.cases.length ? state.resources.cases.map(testCase => `<label><input type="checkbox" name="case_ids" value="${esc(testCase.id)}" ${selected.has(testCase.id) ? "checked" : ""}><span><b>${esc(testCase.name)}</b><small>${esc(testCase.request?.method || "GET")} ${esc(testCase.request?.path || testCase.request?.url || "")}</small></span></label>`).join("") : "<p>请先创建接口用例</p>"}</fieldset><label class="full api-check"><input type="checkbox" name="stop_on_failure" ${item?.stop_on_failure ? "checked" : ""}><span>遇到失败用例时停止后续执行</span></label>`;
    }
    dialog.showModal();
  }

  async function saveEditor(event) {
    event.preventDefault(); const form = event.currentTarget, { kind, item } = state.editing; const submit = form.querySelector('[type="submit"]');
    submit.disabled = true; $("#apiEditorMessage").textContent = "";
    try {
      const data = Object.fromEntries(new FormData(form));
      if (kind === "environments") { data.variables = parseJson(form, "variables", {}); data.headers = parseJson(form, "headers", {}); }
      if (kind === "cases") { data.request = parseJson(form, "request", {}); data.assertions = parseJson(form, "assertions", []); data.extractors = parseJson(form, "extractors", []); }
      if (kind === "suites") { data.case_ids = $$('input[name="case_ids"]:checked', form).map(input => input.value); data.stop_on_failure = Boolean(form.elements.stop_on_failure?.checked); if (!data.case_ids.length) throw new Error("请至少选择一条用例"); }
      let path, method;
      if (kind === "project") { path = item ? `/projects/${item.id}` : "/projects"; method = item ? "PUT" : "POST"; }
      else { path = item ? `/${kind}/${item.id}` : `/projects/${state.projectId}/${kind}`; method = item ? "PUT" : "POST"; }
      const saved = await request(path, { method, body: JSON.stringify(data) }); $("#apiEditorDialog").close();
      if (kind === "project") await loadProjects(item?.id || saved.id); else { await loadTab(); await loadProjects(state.projectId); }
      notice("保存成功。", "success");
    } catch (error) { $("#apiEditorMessage").textContent = error.message; }
    finally { submit.disabled = false; }
  }

  async function removeResource(id) {
    if (!confirm("确认删除这条记录？历史运行报告不会被删除。")) return;
    try { await request(`/${state.tab}/${encodeURIComponent(id)}`, { method: "DELETE" }); await loadTab(); await loadProjects(state.projectId); notice("已删除。", "success"); }
    catch (error) { notice(error.message, "error"); }
  }

  function environmentSelect() {
    return `<label><span>运行环境</span><select name="environmentId" required><option value="">请选择环境</option>${state.resources.environments.map(env => `<option value="${esc(env.id)}">${esc(env.name)} · ${esc(env.base_url)}</option>`).join("")}</select></label>`;
  }

  async function debugCase(testCase) {
    if (!state.resources.environments.length) { notice("请先创建测试环境。", "warn"); return; }
    state.editing = { kind: "debug", item: testCase }; $("#apiEditorTitle").textContent = `调试：${testCase.name}`; $("#apiEditorEyebrow").textContent = "CASE DEBUG";
    $("#apiEditorFields").innerHTML = environmentSelect() + field("临时覆盖变量（JSON）", "variables", "{}", { type: "textarea" }); $("#apiEditorMessage").textContent = ""; $("#apiEditorDialog").showModal();
  }

  async function runSuite(suite) {
    if (!state.resources.environments.length) { notice("请先创建测试环境。", "warn"); return; }
    state.editing = { kind: "run", item: suite }; $("#apiEditorTitle").textContent = `运行：${suite.name}`; $("#apiEditorEyebrow").textContent = "SUITE RUN";
    $("#apiEditorFields").innerHTML = environmentSelect() + field("临时覆盖变量（JSON）", "variables", "{}", { type: "textarea" }); $("#apiEditorMessage").textContent = ""; $("#apiEditorDialog").showModal();
  }

  async function executeAction(event) {
    event.preventDefault(); const form = event.currentTarget, { kind, item } = state.editing; if (!["debug", "run"].includes(kind)) return saveEditor(event);
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true; submit.textContent = kind === "run" ? "执行中…" : "调试中…";
    try {
      const body = { environmentId: form.elements.environmentId.value, variables: parseJson(form, "variables", {}) };
      const data = await request(kind === "run" ? `/suites/${item.id}/run` : `/cases/${item.id}/debug`, { method: "POST", body: JSON.stringify(body) });
      $("#apiEditorDialog").close(); showRun(data, kind === "run" ? item.name : `调试 · ${item.name}`); if (kind === "run") { state.tab = "runs"; await loadTab(); }
    } catch (error) { $("#apiEditorMessage").textContent = error.message; }
    finally { submit.disabled = false; submit.textContent = "保存"; }
  }

  function showRun(data, title = "执行报告") {
    const results = data.results || (data.request ? [{ name: title, ...data }] : data.result || []);
    $("#apiRunTitle").textContent = title;
    $("#apiRunContent").innerHTML = `<div class="api-report-summary"><div><b>${esc(data.status || (data.passed ? "passed" : "failed"))}</b><span>执行状态</span></div><div><b>${Number(data.passed ?? results.filter(item => item.passed).length)}/${Number(data.total ?? results.length)}</b><span>通过用例</span></div><div><b>${Number(data.durationMs || results.reduce((sum, item) => sum + Number(item.durationMs || 0), 0))} ms</b><span>总耗时</span></div></div><div class="api-report-cases">${results.map(result => `<details ${result.passed ? "" : "open"}><summary><span class="${result.passed ? "passed" : "failed"}">${result.passed ? "PASS" : "FAIL"}</span><b>${esc(result.name || "接口用例")}</b><small>${Number(result.durationMs || 0)} ms</small></summary><div><p><strong>${esc(result.request?.method || "")}</strong> <code>${esc(result.request?.url || "")}</code></p>${result.error ? `<p class="api-report-error">${esc(result.error)}</p>` : ""}<ul>${(result.assertions || []).map(assertion => `<li class="${assertion.passed ? "passed" : "failed"}"><b>${assertion.passed ? "✓" : "×"} ${esc(assertion.type)}</b><span>${esc(assertion.message)}</span></li>`).join("")}</ul><details><summary>响应数据</summary><pre>${esc(pretty(result.response?.data, null))}</pre></details></div></details>`).join("")}</div>`;
    $("#apiRunDialog").showModal();
  }

  async function showRunDetail(id) { try { const data = await request(`/runs/${encodeURIComponent(id)}`); showRun(data, `运行报告 · ${id.slice(-8)}`); } catch (error) { notice(error.message, "error"); } }

  async function ensureDependencies() {
    if (!state.projectId) return;
    const needs = [];
    if (!state.resources.environments.length) needs.push(request(`/projects/${state.projectId}/environments`).then(data => { state.resources.environments = data; }));
    if (!state.resources.cases.length) needs.push(request(`/projects/${state.projectId}/cases`).then(data => { state.resources.cases = data; }));
    await Promise.all(needs);
  }

  function bind() {
    $("#apiAddProject").addEventListener("click", () => openEditor("project"));
    $("#apiEditProject").addEventListener("click", () => openEditor("project", selectedProject()));
    $("#apiRefresh").addEventListener("click", () => loadProjects(state.projectId));
    $("#apiProjectList").addEventListener("click", event => { const button = event.target.closest("[data-project-id]"); if (!button) return; state.projectId = button.dataset.projectId; renderProjects(); loadTab(); });
    $$("[data-api-tab]").forEach(button => button.addEventListener("click", async () => { state.tab = button.dataset.apiTab; await loadTab(); }));
    $("#apiPrimaryAction").addEventListener("click", async () => { if (state.tab === "runs") return loadTab(); if (state.tab === "suites") await ensureDependencies(); openEditor(state.tab); });
    $("#apiResourceList").addEventListener("click", async event => {
      const edit = event.target.closest("[data-edit-id]"), remove = event.target.closest("[data-delete-id]"), debug = event.target.closest("[data-debug-id]"), run = event.target.closest("[data-run-suite]"), detail = event.target.closest("[data-run-detail]");
      if (edit) { if (state.tab === "suites") await ensureDependencies(); openEditor(state.tab, state.resources[state.tab].find(item => item.id === edit.dataset.editId)); }
      if (remove) removeResource(remove.dataset.deleteId);
      if (debug) { await ensureDependencies(); debugCase(state.resources.cases.find(item => item.id === debug.dataset.debugId)); }
      if (run) { await ensureDependencies(); runSuite(state.resources.suites.find(item => item.id === run.dataset.runSuite)); }
      if (detail) showRunDetail(detail.dataset.runDetail);
    });
    $("#apiEditorClose").addEventListener("click", () => $("#apiEditorDialog").close()); $("#apiEditorCancel").addEventListener("click", () => $("#apiEditorDialog").close());
    $("#apiEditorForm").addEventListener("submit", executeAction); $("#apiRunClose").addEventListener("click", () => $("#apiRunDialog").close());
    document.querySelector('[data-workspace-mode="api"]').addEventListener("click", () => { history.replaceState(null, "", "#api"); if (!state.projects.length) loadProjects(); });
    window.addEventListener("lingtest:account-loaded", () => loadProjects(state.projectId));
  }

  bind();
  if (location.hash === "#api") loadProjects(); else renderProjects();
})();
