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
    $("#apiProjectList").innerHTML = state.projects.length ? state.projects.map(project => `
      <button type="button" data-project-id="${esc(project.id)}" class="${project.id === state.projectId ? "active" : ""}">
        <span>${esc(project.name.slice(0, 1).toUpperCase())}</span><div><b>${esc(project.name)}</b><small>${Number(project.caseCount || 0)} 用例 · ${Number(project.suiteCount || 0)} 套件</small></div>
      </button>`).join("") : `<div class="api-list-empty"><b>暂无项目</b><span>点击右上角 ＋ 创建</span></div>`;
    const project = selectedProject();
    $("#apiProjectEmpty").hidden = Boolean(project); $("#apiProjectEmpty").classList.toggle("api-hidden", Boolean(project));
    $("#apiProjectPanel").hidden = !project; $("#apiProjectPanel").classList.toggle("api-hidden", !project);
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
  function assertionRow(item = { type: "status", expected: 200 }) {
    const types = ["status", "response_time", "json_path", "header", "contains", "json_equals"];
    return `<div class="api-rule-row"><select data-rule-field="type">${types.map(type => `<option ${type === item.type ? "selected" : ""}>${type}</option>`).join("")}</select><input data-rule-field="path" value="${esc(item.path || item.name || "")}" placeholder="JSONPath / Header"><input data-rule-field="expected" value="${esc(typeof item.expected === "object" ? pretty(item.expected, null) : item.expected ?? "")}" placeholder="期望值"><button type="button" data-remove-api-rule aria-label="删除规则">×</button></div>`;
  }

  function extractorRow(item = {}) {
    return `<div class="api-rule-row extractor"><input data-rule-field="name" value="${esc(item.name || "")}" placeholder="变量名"><input data-rule-field="path" value="${esc(item.path || "")}" placeholder="$.data.token"><select data-rule-field="scope"><option value="temporary" ${item.scope !== "environment" ? "selected" : ""}>临时变量</option><option value="environment" ${item.scope === "environment" ? "selected" : ""}>环境变量</option></select><button type="button" data-remove-api-rule aria-label="删除规则">×</button></div>`;
  }

  function caseEditor(item) {
    const requestConfig = item?.request || {}, assertions = item?.assertions?.length ? item.assertions : [{ type: "status", expected: 200 }], extractors = item?.extractors || [];
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
    return field("用例名称", "name", item?.name, { required: true, full: false })
      + field("优先级", "priority", item?.priority || "P1", { type: "select", options: ["P0", "P1", "P2"], full: false })
      + field("用例说明", "description", item?.description, { type: "textarea" })
      + `<div class="full api-request-builder"><div class="api-builder-title"><div><b>请求配置</b><span>使用可视化字段配置请求，无需编写完整 JSON</span></div></div><div class="api-request-line"><label><span>Method</span><select name="request_method">${methods.map(method => `<option ${method === (requestConfig.method || "GET").toUpperCase() ? "selected" : ""}>${method}</option>`).join("")}</select></label><label><span>Path / URL</span><input name="request_path" required value="${esc(requestConfig.path || requestConfig.url || "")}" placeholder="/api/users"></label><label><span>超时 ms</span><input name="request_timeout" type="number" min="100" max="120000" value="${Number(requestConfig.timeoutMs || 15000)}"></label></div><div class="api-request-grid">${field("Headers（JSON）", "request_headers", pretty(requestConfig.headers, {}), { type: "textarea" })}${field("Query（JSON）", "request_query", pretty(requestConfig.query, {}), { type: "textarea" })}${field("Body（JSON / 文本）", "request_body", requestConfig.body === undefined ? "" : (typeof requestConfig.body === "string" ? requestConfig.body : pretty(requestConfig.body, {})), { type: "textarea" })}</div></div>`
      + `<div class="full api-rule-builder" data-rule-kind="assertion"><div class="api-builder-title"><div><b>响应断言</b><span>验证状态码、响应时间、字段和值</span></div><button type="button" data-add-api-rule="assertion">＋ 添加断言</button></div><div class="api-rule-list">${assertions.map(assertionRow).join("")}</div></div>`
      + `<div class="full api-rule-builder" data-rule-kind="extractor"><div class="api-builder-title"><div><b>变量提取</b><span>从响应中提取 Token 或业务 ID，供后续步骤使用</span></div><button type="button" data-add-api-rule="extractor">＋ 添加变量</button></div><div class="api-rule-list">${extractors.map(extractorRow).join("") || '<p class="api-rule-empty">暂无变量提取规则</p>'}</div></div>`;
  }

  function typedValue(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    try { return JSON.parse(raw); } catch (_) { return raw; }
  }

  function collectRules(form, kind) {
    return $$(`[data-rule-kind="${kind}"] .api-rule-row`, form).map(row => {
      const result = {};
      $$("[data-rule-field]", row).forEach(input => { const value = input.value.trim(); if (value) result[input.dataset.ruleField] = input.dataset.ruleField === "expected" ? typedValue(value) : value; });
      return result;
    }).filter(item => kind === "assertion" ? item.type : item.name && item.path);
  }

  function openEditor(kind, item = null) {
    state.editing = { kind, item };
    const dialog = $("#apiEditorDialog"), fields = $("#apiEditorFields");
    $("#apiEditorTitle").textContent = `${item ? "编辑" : "新建"}${{ project: "项目", environments: "环境", cases: "用例", suites: "套件" }[kind]}`;
    $("#apiEditorEyebrow").textContent = kind.toUpperCase(); $("#apiEditorMessage").textContent = "";
    if (kind === "project") fields.innerHTML = field("项目名称", "name", item?.name, { required: true }) + field("项目说明", "description", item?.description, { type: "textarea", placeholder: "例如：交易中心核心接口回归" });
    if (kind === "environments") fields.innerHTML = field("环境名称", "name", item?.name, { required: true, full: false }) + field("Base URL", "base_url", item?.base_url, { required: true, full: false, placeholder: "https://api.example.com" }) + field("公共变量（JSON）", "variables", pretty(item?.variables, { token: "" }), { type: "textarea", hint: "用例中可通过 {{token}} 引用" }) + field("公共请求头（JSON）", "headers", pretty(item?.headers, { "Content-Type": "application/json" }), { type: "textarea" });
    if (kind === "cases") fields.innerHTML = caseEditor(item);
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
      if (kind === "cases") {
        data.request = { method: form.elements.request_method.value, path: form.elements.request_path.value.trim(), headers: parseJson(form, "request_headers", {}), query: parseJson(form, "request_query", {}), timeoutMs: Number(form.elements.request_timeout.value || 15000) };
        const body = form.elements.request_body.value.trim(); if (body) data.request.body = typedValue(body);
        data.assertions = collectRules(form, "assertion"); data.extractors = collectRules(form, "extractor");
      }
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

  function shellTokens(source) {
    return [...source.matchAll(/(?:[^\s"'\\]+|\\.|"(?:\\.|[^"])*"|'[^']*')+/g)].map(match => match[0].replace(/^(['"])|(['"])$/g, ""));
  }

  function parseCurl(source) {
    const tokens = shellTokens(source.replace(/\\\r?\n/g, " ")); let method = "GET", url = "", body = ""; const headers = {};
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (["-X", "--request"].includes(token)) method = (tokens[++index] || "GET").toUpperCase();
      else if (["-H", "--header"].includes(token)) { const raw = tokens[++index] || "", cut = raw.indexOf(":"); if (cut > 0) headers[raw.slice(0, cut).trim()] = raw.slice(cut + 1).trim(); }
      else if (["-d", "--data", "--data-raw", "--data-binary"].includes(token)) { body = tokens[++index] || ""; if (method === "GET") method = "POST"; }
      else if (/^https?:\/\//i.test(token)) url = token;
    }
    if (!url) throw new Error("cURL 中没有找到 HTTP URL");
    const parsed = new URL(url), query = Object.fromEntries(parsed.searchParams.entries());
    return { baseUrl: parsed.origin, cases: [{ name: `${method} ${parsed.pathname}`, priority: "P1", request: { method, path: parsed.pathname, headers, query, ...(body ? { body: typedValue(body) } : {}) }, assertions: [{ type: "status", expected: 200 }], extractors: [] }] };
  }

  function parseOpenApi(source) {
    let spec; try { spec = JSON.parse(source); } catch (_) { throw new Error("当前版本请粘贴 OpenAPI JSON；YAML 导入将在下一阶段支持"); }
    if (!spec.paths || typeof spec.paths !== "object") throw new Error("没有识别到 OpenAPI paths");
    const cases = [], methods = new Set(["get", "post", "put", "patch", "delete", "head"]);
    Object.entries(spec.paths).forEach(([path, pathItem]) => Object.entries(pathItem || {}).forEach(([method, operation]) => {
      if (!methods.has(method)) return;
      const parameters = [...(pathItem.parameters || []), ...(operation.parameters || [])], query = {};
      parameters.filter(item => item.in === "query").forEach(item => { query[item.name] = item.example ?? item.schema?.example ?? item.schema?.default ?? ""; });
      const media = operation.requestBody?.content?.["application/json"], body = media?.example ?? media?.schema?.example;
      const successCode = Object.keys(operation.responses || {}).find(code => /^2\d\d$/.test(code)) || "200";
      cases.push({ name: operation.summary || operation.operationId || `${method.toUpperCase()} ${path}`, description: operation.description || "", priority: "P1", request: { method: method.toUpperCase(), path, headers: {}, query, ...(body !== undefined ? { body } : {}) }, assertions: [{ type: "status", expected: Number(successCode) }], extractors: [] });
    }));
    if (!cases.length) throw new Error("OpenAPI 文档中没有可导入的 HTTP 接口");
    return { baseUrl: spec.servers?.[0]?.url || "", title: spec.info?.title || "", cases };
  }

  async function importAssets(event) {
    event.preventDefault(); const form = event.currentTarget, submit = form.querySelector('[type="submit"]'), source = form.elements.source.value.trim();
    submit.disabled = true; $("#apiImportMessage").textContent = "正在解析…";
    try {
      let format = form.elements.format.value; if (format === "auto") format = /^\s*curl\b/i.test(source) ? "curl" : "openapi";
      const parsed = format === "curl" ? parseCurl(source) : parseOpenApi(source);
      if (parsed.baseUrl && !state.resources.environments.some(env => env.base_url === parsed.baseUrl)) {
        await request(`/projects/${state.projectId}/environments`, { method: "POST", body: JSON.stringify({ name: parsed.title ? `${parsed.title} 环境` : "导入环境", base_url: parsed.baseUrl, variables: {}, headers: {} }) });
      }
      for (const testCase of parsed.cases) await request(`/projects/${state.projectId}/cases`, { method: "POST", body: JSON.stringify(testCase) });
      $("#apiImportDialog").close(); form.reset(); state.tab = "cases"; await loadTab(); await loadProjects(state.projectId);
      notice(`导入完成：已创建 ${parsed.cases.length} 条接口用例。`, "success");
    } catch (error) { $("#apiImportMessage").textContent = error.message; }
    finally { submit.disabled = false; }
  }

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
    $("#apiImportAction").addEventListener("click", async () => { if (!state.projectId) return notice("请先选择或创建项目。", "warn"); await ensureDependencies(); $("#apiImportMessage").textContent = ""; $("#apiImportDialog").showModal(); });
    $("#apiResourceList").addEventListener("click", async event => {
      const edit = event.target.closest("[data-edit-id]"), remove = event.target.closest("[data-delete-id]"), debug = event.target.closest("[data-debug-id]"), run = event.target.closest("[data-run-suite]"), detail = event.target.closest("[data-run-detail]");
      if (edit) { if (state.tab === "suites") await ensureDependencies(); openEditor(state.tab, state.resources[state.tab].find(item => item.id === edit.dataset.editId)); }
      if (remove) removeResource(remove.dataset.deleteId);
      if (debug) { await ensureDependencies(); debugCase(state.resources.cases.find(item => item.id === debug.dataset.debugId)); }
      if (run) { await ensureDependencies(); runSuite(state.resources.suites.find(item => item.id === run.dataset.runSuite)); }
      if (detail) showRunDetail(detail.dataset.runDetail);
    });
    $("#apiEditorClose").addEventListener("click", () => $("#apiEditorDialog").close()); $("#apiEditorCancel").addEventListener("click", () => $("#apiEditorDialog").close());
    $("#apiEditorFields").addEventListener("click", event => {
      const add = event.target.closest("[data-add-api-rule]"), remove = event.target.closest("[data-remove-api-rule]");
      if (add) { const builder = add.closest(".api-rule-builder"), empty = builder.querySelector(".api-rule-empty"); empty?.remove(); builder.querySelector(".api-rule-list").insertAdjacentHTML("beforeend", add.dataset.addApiRule === "assertion" ? assertionRow() : extractorRow()); }
      if (remove) { const list = remove.closest(".api-rule-list"); remove.closest(".api-rule-row").remove(); if (!list.querySelector(".api-rule-row")) list.innerHTML = '<p class="api-rule-empty">暂无规则</p>'; }
    });
    $("#apiImportClose").addEventListener("click", () => $("#apiImportDialog").close()); $("#apiImportCancel").addEventListener("click", () => $("#apiImportDialog").close()); $("#apiImportForm").addEventListener("submit", importAssets);
    $("#apiEditorForm").addEventListener("submit", executeAction); $("#apiRunClose").addEventListener("click", () => $("#apiRunDialog").close());
    document.querySelector('[data-workspace-mode="api"]').addEventListener("click", () => { if (!state.projects.length) loadProjects(); });
    window.addEventListener("lingtest:account-loaded", () => loadProjects(state.projectId));
  }

  bind();
  if (location.hash === "#api") loadProjects(); else renderProjects();
})();
