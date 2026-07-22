function el(id) {
  return document.getElementById(id);
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", "X-Browser-Id": browserId(), ...(accountToken()?{"X-Account-Token":accountToken()}:{}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || ("HTTP " + res.status));
  }
  return data;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const state = {
  busy: false,
  showRaw: false,
  lastOutput: null,
  lastRows: [],
  lastCases: [],
  executionResults: {},
  runningCases: new Set(),
  entitlement: { plan: "free", active: false },
  accountLoggedIn: false,
  remoteUsage: null,
  workspaceMode: "design",
  selectedPipelineStage: "spec",
  pipelineSkillOutputs: {},
};

const STORAGE_CASES = "lingtest:last-cases:v1";
const STORAGE_HISTORY = "lingtest:run-history:v1";
const STORAGE_QUOTA = "lingtest:daily-quota:v1";
const STORAGE_BROWSER_ID = "lingtest:browser-id:v1";
const FREE_LIMITS = { generation: 5, execution: 3 };
const LOGGED_LIMITS = { generation: 10, execution: 6 };
const PRO_LIMITS = { generation: { daily: 50, monthly: 1000 }, execution: { daily: 80, monthly: 1500 } };
const ENTITLEMENT_API = "https://timelens.cc/api/lingtest/licenses";
const GENERATION_API = "https://timelens.cc/api/lingtest/generations";
const ACCOUNT_TOKEN_KEY = "timelens.pc.token";
const DEMOS = {
  content: { target:"https://example.com/", case:{case_id:"DEMO-CONTENT-001",module:"页面内容",title:"验证示例页面核心内容",priority:"P1",preconditions:["示例页面可访问"],steps:[{step_no:1,action:"打开页面并读取主要内容",test_data:"",expected_result:"页面显示 Example Domain"}],expected_result:"页面显示 Example Domain",assertions:[{type:"text",value:"Example Domain"}]}},
  search: { target:"https://www.wikipedia.org/", case:{case_id:"DEMO-SEARCH-001",module:"站内搜索",title:"搜索 Playwright 并进入结果页",priority:"P1",preconditions:["Wikipedia 可访问"],steps:[{step_no:1,action:"在搜索框中输入关键词",test_data:"关键词: Playwright",expected_result:"输入成功"},{step_no:2,action:"点击搜索按钮",test_data:"",expected_result:"进入搜索结果"}],expected_result:"结果页标题包含 Playwright",assertions:[{type:"title_contains",value:"Playwright"}]}},
  login: { target:"https://www.saucedemo.com/", case:{case_id:"DEMO-LOGIN-001",module:"登录",title:"使用标准账号正常登录",priority:"P0",preconditions:["演示站点可访问"],steps:[{step_no:1,action:"填写用户名和密码",test_data:"用户名: standard_user, 密码: secret_sauce",expected_result:"字段填写成功"},{step_no:2,action:"点击登录按钮",test_data:"",expected_result:"进入商品页面"}],expected_result:"页面显示 Products",assertions:[{type:"text",value:"Products"}]}}
};

const SAMPLE_PROMPT = [
  "- 登录成功：手机号+密码+验证码正确",
  "- 登录失败：密码错误",
  "- 登录失败：验证码错误超过 5 次触发账户锁定",
  "- 忘记密码：短信验证码校验成功后可重置密码",
].join("\n");
const PIPELINE_SKILLS = [
  {key:"spec",name:"需求验证",method:"完整性、一致性、歧义性与可测试性审查",input:"需求文档 / SDD",output:"问题清单与需求质量评分"},
  {key:"risk",name:"风险计划",method:"测试左移、风险分级与 Diff 影响面分析",input:"已验证需求与代码变更",output:"范围、风险分布与测试深度"},
  {key:"split",name:"需求拆分",method:"按 server / UI-B / UI-C / 实验灰度分类",input:"需求与风险计划",output:"独立可测需求单元"},
  {key:"dimensions",name:"覆盖设计",method:"等价类、边界值、判定表、状态迁移、场景、因果图、错误推测",input:"需求单元与风险等级",output:"模块化测试覆盖维度"},
  {key:"cases",name:"详细用例",method:"从覆盖维度展开可直接执行的结构化用例",input:"覆盖维度与测试数据",output:"P0/P1/P2 用例与自动化断言"},
  {key:"delivery",name:"交付闭环",method:"追溯矩阵、差异标记与 Case Home 格式转换",input:"结构化测试用例",output:"追溯矩阵与平台 JSON"},
];
let pipelineProgressTimer = null;

function quotaToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}

function browserId() {
  let id=localStorage.getItem(STORAGE_BROWSER_ID);
  if(!id){id=crypto.randomUUID();localStorage.setItem(STORAGE_BROWSER_ID,id)}
  return id;
}

function accountToken() {
  const raw=localStorage.getItem(ACCOUNT_TOKEN_KEY);
  if(!raw)return "";
  try{const parsed=JSON.parse(raw);return typeof parsed==="string"?parsed:parsed?.token||""}catch{return raw}
}

function accountHeaders() {
  const token=accountToken();
  return token?{Authorization:`Bearer ${token}`,"X-Auth-Token":token}:{};
}

async function refreshEntitlement() {
  try {
    const response=await fetch(`${ENTITLEMENT_API}/status?browserId=${encodeURIComponent(browserId())}`,{headers:accountHeaders()});
    const data=await response.json();
    if(response.ok&&data.code===0)state.entitlement=data.data||{plan:"free",active:false};
  } catch (_) { state.entitlement={plan:"free",active:false}; }
  renderQuota();
}

async function refreshUsage() {
  try {
    const response=await fetch(`${ENTITLEMENT_API.replace('/licenses','')}/usage/status?browserId=${encodeURIComponent(browserId())}`,{headers:accountHeaders()});
    const data=await response.json();
    if(response.ok&&data.code===0)state.remoteUsage=data.data||null;
  } catch (_) { state.remoteUsage=null; }
  renderQuota();
}

function readQuota() {
  const stored = safeRead(STORAGE_QUOTA, {});
  return stored.date === quotaToday() ? { date: stored.date, generation: Number(stored.generation||0), execution: Number(stored.execution||0) } : { date: quotaToday(), generation: 0, execution: 0 };
}

function activeFreeLimits() {
  if(state.remoteUsage?.limits)return state.remoteUsage.limits;
  if(state.entitlement.active&&state.entitlement.plan==="pro")return PRO_LIMITS;
  const source=state.accountLoggedIn?LOGGED_LIMITS:FREE_LIMITS;
  return {generation:{daily:source.generation,monthly:state.accountLoggedIn?30:15},execution:{daily:source.execution,monthly:state.accountLoggedIn?20:10}};
}

function renderQuota() {
  const limits=activeFreeLimits(),localQuota=readQuota(),usage=state.remoteUsage?.usage||{daily:localQuota,monthly:localQuota};
  const generationLeft=Math.max(0,Number(limits.generation.daily)-Number(usage.daily.generation||0)),executionLeft=Math.max(0,Number(limits.execution.daily)-Number(usage.daily.execution||0));
  const generationMonthLeft=Math.max(0,Number(limits.generation.monthly)-Number(usage.monthly.generation||0)),executionMonthLeft=Math.max(0,Number(limits.execution.monthly)-Number(usage.monthly.execution||0));
  const pro=state.entitlement.active&&state.entitlement.plan==="pro",strip=document.querySelector(".usage-strip");
  strip?.classList.toggle("pro",pro);
  el("planLabel").textContent=pro?"PRO PLAN":"FREE PLAN";
  if(pro){el("generationQuota").textContent=`生成 今日 ${generationLeft} · 本月 ${generationMonthLeft}`;el("executionQuota").textContent=`执行 今日 ${executionLeft} · 本月 ${executionMonthLeft}`;el("quotaSummary").textContent="专业版权益已生效";el("quotaNote").textContent=state.entitlement.expiresAt?`有效期至 ${new Date(state.entitlement.expiresAt).toLocaleDateString()} · 用量按账户统计`:"用量按当前账户统计";el("openActivation").hidden=true;el("accountLoginPrompt").hidden=true;return}
  el("openActivation").hidden=false;el("accountLoginPrompt").hidden=state.accountLoggedIn;
  el("quotaNote").textContent=state.accountLoggedIn?"已登录，免费体验次数已翻倍":"游客每天可生成 5 次、执行 3 次；登录后次数翻倍";
  el("generationQuota").textContent = `生成 今日 ${generationLeft} · 本月 ${generationMonthLeft}`;
  el("executionQuota").textContent = `执行 今日 ${executionLeft} · 本月 ${executionMonthLeft}`;
  el("quotaSummary").textContent = generationLeft || executionLeft ? (state.accountLoggedIn?"登录用户双倍体验额度":"先免费验证真实需求") : "今日免费额度已用完";
}

function hasQuota(kind) {
  const limits=activeFreeLimits();
  const local=readQuota(),usage=state.remoteUsage?.usage||{daily:local,monthly:local};
  if (Number(usage.daily[kind]||0)<limits[kind].daily&&Number(usage.monthly[kind]||0)<limits[kind].monthly) return true;
  const pro=state.entitlement.active&&state.entitlement.plan==="pro";
  setStatus(`${pro?"专业版":"免费"}${kind === "generation" ? "生成" : "执行"}额度已用完，${pro?"可下月继续使用或联系升级":"登录后可获得更多体验次数"}。`, "warn");
  document.querySelector(".usage-strip")?.scrollIntoView({behavior:"smooth",block:"center"});
  return false;
}

function consumeQuota(kind) {
  if(state.remoteUsage)return;
  const quota = readQuota(); quota[kind] += 1; safeWrite(STORAGE_QUOTA, quota); renderQuota();
}

function setStatus(text, kind) {
  const node = el("aiStatus");
  node.textContent = text;
  node.className = "ai-status" + (kind ? " " + kind : "");
  const executionNode = el("executionStatus");
  if (executionNode) {
    executionNode.textContent = text;
    executionNode.className = "ai-status" + (kind ? " " + kind : "");
  }
}

function setBusy(busy) {
  state.busy = busy;
  ["aiGo", "runCurrentSkill", "fillSample", "clearPrompt", "copyJson", "toggleRaw", "downloadExcel", "downloadCaseHome", "aiModel"].forEach((id) => {
    const node = el(id);
    if (node) {
      node.disabled = busy;
    }
  });
  el("aiGo").textContent = busy ? "正在运行完整流程..." : "一键运行完整流程 →";
}

function startPipelineProgress() {
  let index = 0;
  state.selectedPipelineStage = PIPELINE_SKILLS[index].key;
  updatePipelineStepState(PIPELINE_SKILLS[index].key);
  renderSelectedPipelineSkill();
  setStatus(`正在执行 1/6：${PIPELINE_SKILLS[index].name}…`, "");
  clearInterval(pipelineProgressTimer);
  pipelineProgressTimer = setInterval(() => {
    if (index >= PIPELINE_SKILLS.length - 1) return;
    index += 1;
    state.selectedPipelineStage = PIPELINE_SKILLS[index].key;
    updatePipelineStepState(PIPELINE_SKILLS[index].key);
    renderSelectedPipelineSkill();
    setStatus(`正在执行 ${index + 1}/6：${PIPELINE_SKILLS[index].name}…`, "");
  }, 4000);
}

function stopPipelineProgress() {
  clearInterval(pipelineProgressTimer);
  pipelineProgressTimer = null;
  updatePipelineStepState();
}

function baseProviderName(name) {
  const raw = String(name || "").trim().toLowerCase();
  if (!raw) {
    return "";
  }
  if (raw.endsWith("-fallback")) {
    return raw.slice(0, -"-fallback".length);
  }
  return raw;
}

function formatElapsed(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) {
    return "";
  }
  if (n >= 1000) {
    const sec = n / 1000;
    return sec >= 10 ? `${sec.toFixed(1)}s` : `${sec.toFixed(2)}s`;
  }
  return `${Math.round(n)}ms`;
}

function renderSummary(out) {
  const provider = out.provider || "unknown";
  const requestedProviderRaw = out.requested_provider || "";
  const requestedProvider = requestedProviderRaw || "auto";
  const warning = out.warning || "";
  const count = Array.isArray(out.suggestions) ? out.suggestions.length : 0;
  const runtime = out.runtime && typeof out.runtime === "object" ? out.runtime : {};
  const mode = runtime.mode || "unknown";
  const defaultMode = runtime.default_mode || mode;
  const deepseekKeyConfigured = runtime.deepseek_api_key_configured;
  const qianwenKeyConfigured = runtime.qianwen_api_key_configured;
  const geminiKeyConfigured = runtime.gemini_api_key_configured;
  const activeKeyProvider = baseProviderName(requestedProviderRaw || provider || mode);
  let activeKeyConfigured = null;
  if (activeKeyProvider === "deepseek") {
    activeKeyConfigured = deepseekKeyConfigured;
  } else if (activeKeyProvider === "qianwen") {
    activeKeyConfigured = qianwenKeyConfigured;
  } else if (activeKeyProvider === "gemini") {
    activeKeyConfigured = geminiKeyConfigured;
  }
  const elapsedLabel = formatElapsed(out.elapsed_ms || out.client_elapsed_ms || 0);

  const bits = [
    `<span><b>${count}</b> 条用例</span>`,
    `<span>provider: <code>${escapeHtml(provider)}</code></span>`,
    `<span>mode: <code>${escapeHtml(mode)}</code></span>`,
  ];
  if (activeKeyProvider && activeKeyConfigured !== null) {
    bits.push(`<span>${escapeHtml(activeKeyProvider)}_key: <code>${escapeHtml(String(Boolean(activeKeyConfigured)))}</code></span>`);
  }
  if (elapsedLabel) {
    bits.push(`<span>耗时: <code>${escapeHtml(elapsedLabel)}</code></span>`);
  }
  if (warning) {
    bits.push(`<span class="warn">warning: ${escapeHtml(warning)}</span>`);
  }
  el("aiSummary").innerHTML = bits.join('<span class="dot">•</span>');
}

function normalizeLegacySteps(spec) {
  if (!spec || typeof spec !== "object") {
    return [];
  }
  const rows = spec.steps;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .filter((x) => x && typeof x === "object")
    .map((x, i) => ({
      step_no: i + 1,
      action: String(x.message || x.type || "step"),
      test_data: "",
      expected_result: "",
    }));
}

function normalizeTestCase(item, idx) {
  const tc = item && typeof item.test_case === "object" ? item.test_case : {};
  const steps = Array.isArray(tc.steps)
    ? tc.steps
        .filter((x) => x && typeof x === "object")
        .map((x, i) => ({
          step_no: Number(x.step_no || i + 1),
          action: String(x.action || "").trim(),
          test_data: String(x.test_data || "").trim(),
          expected_result: String(x.expected_result || "").trim(),
        }))
        .filter((x) => x.action)
    : [];

  const fallbackSteps = normalizeLegacySteps(item.spec);

  return {
    case_id: String(tc.case_id || `TC-GEN-${idx + 1}`),
    title: String(tc.title || item.title || `用例 ${idx + 1}`),
    module: String(tc.module || "通用模块"),
    priority: String(tc.priority || "P1"),
    type: String(tc.type || "functional"),
    preconditions: Array.isArray(tc.preconditions)
      ? tc.preconditions.map((x) => String(x)).filter(Boolean)
      : [],
    steps: steps.length ? steps : fallbackSteps,
    expected_result: String(tc.expected_result || ""),
    assertions: Array.isArray(tc.assertions) ? tc.assertions : (Array.isArray(item.assertions) ? item.assertions : []),
    automation_candidate: Boolean(tc.automation_candidate),
    description: String(item.description || ""),
    tags: Array.isArray(item.tags) ? item.tags.map((x) => String(x)).filter(Boolean) : [],
    kind: String(item.kind || "demo"),
  };
}

function renderLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return "无";
  }
  return lines.map((line) => String(line)).join("\n");
}

function renderStepLines(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return "无";
  }
  return steps
    .map((step) => {
      const parts = [`${step.step_no}. ${step.action}`];
      if (step.test_data) {
        parts.push(`测试数据: ${step.test_data}`);
      }
      if (step.expected_result) {
        parts.push(`预期: ${step.expected_result}`);
      }
      return parts.join(" | ");
    })
    .join("\n");
}

function renderSuggestions(list) {
  const box = el("aiCards");
  const executionBox = el("executionCases");
  if (!Array.isArray(list) || list.length === 0) {
    state.lastCases = [];
    state.lastRows = [];
    box.innerHTML = '<div class="ai-empty">未生成到可展示用例，请调整需求描述后重试。</div>';
    if (executionBox) executionBox.innerHTML = '<div class="workspace-empty"><span>▷</span><b>等待测试用例</b><p>生成用例后会自动同步到这里，无需重复导入。</p></div>';
    renderExecutionSummary();
    return;
  }

  state.lastCases = list.map((item, idx) => item && item.case_id ? item : normalizeTestCase(item, idx));
  const rows = state.lastCases
    .map((tc) => {
      return `
      <tr data-case-id="${escapeHtml(tc.case_id)}">
        <td><div class="ai-cell-lines">${escapeHtml(tc.case_id)}</div></td>
        <td><div class="ai-cell-lines">${escapeHtml(tc.module)}</div></td>
        <td><div class="ai-cell-lines">${escapeHtml(tc.title)}</div></td>
        <td><div class="ai-cell-lines">${escapeHtml(tc.priority)}</div></td>
        <td><div class="ai-cell-lines">${escapeHtml(renderLines(tc.preconditions)).replaceAll("\n", "<br />")}</div></td>
        <td><div class="ai-cell-lines">${escapeHtml(renderStepLines(tc.steps)).replaceAll("\n", "<br />")}</div></td>
        <td><div class="ai-cell-lines">${escapeHtml(tc.expected_result || "无")}</div></td>
      </tr>`;
    })
    .join("");

  state.lastRows = state.lastCases.map((tc) => {
    return {
      id: tc.case_id,
      module: tc.module,
      title: tc.title,
      priority: tc.priority,
      precondition: renderLines(tc.preconditions),
      steps: renderStepLines(tc.steps),
      expectedResult: tc.expected_result || "无",
    };
  });

  box.innerHTML = `
    <div class="ai-table-wrap">
      <table class="ai-result-table">
        <thead>
          <tr>
            <th>用例ID</th>
            <th>模块</th>
            <th>标题</th>
            <th>优先级</th>
            <th>前置条件</th>
            <th>执行步骤</th>
            <th>预期结果</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  renderExecutionCases();
}

function automationCandidate(testCase) {
  return testCase.automation_candidate !== false;
}

function renderExecutionSummary() {
  const total = state.lastCases.length;
  const runnable = state.lastCases.filter(automationCandidate).length;
  const results = Object.values(state.executionResults);
  const passed = results.filter((item) => item?.status === "passed").length;
  const failed = results.filter((item) => item && item.status !== "passed").length;
  if (el("executionCaseBadge")) el("executionCaseBadge").textContent = String(total);
  if (!el("executionSummary")) return;
  el("executionSummary").innerHTML = total
    ? `<span><b>${total}</b> 条已同步</span><span><b>${runnable}</b> 条可自动化</span><span class="passed"><b>${passed}</b> 条通过</span><span class="failed"><b>${failed}</b> 条需处理</span>`
    : "尚未载入用例，请先在“AI 用例设计”中生成或恢复用例。";
}

function renderExecutionCases() {
  const box = el("executionCases");
  if (!box) return;
  renderExecutionSummary();
  if (!state.lastCases.length) {
    box.innerHTML = '<div class="workspace-empty"><span>▷</span><b>等待测试用例</b><p>生成用例后会自动同步到这里，无需重复导入。</p></div>';
    return;
  }
  box.innerHTML = `<div class="execution-case-list">${state.lastCases.map((tc) => {
    const result = state.executionResults[tc.case_id];
    const running = state.runningCases.has(tc.case_id);
    const candidate = automationCandidate(tc);
    const status = running ? "running" : result ? result.status : candidate ? "idle" : "manual";
    const statusText = {running:"执行中",passed:"通过",failed:"失败",blocked:"被拦截",needs_review:"需确认",idle:"待执行",manual:"人工验证"}[status] || status;
    return `<article data-case-id="${escapeHtml(tc.case_id)}"><div class="execution-case-main"><span>${escapeHtml(tc.case_id)} · ${escapeHtml(tc.priority)}</span><b>${escapeHtml(tc.title)}</b><small>${escapeHtml(tc.module)} · ${candidate ? "可自动化" : "建议人工验证"}</small></div><div class="execution-case-actions"><span class="run-status ${escapeHtml(status)}">${escapeHtml(statusText)}</span>${candidate ? `<button class="case-run-btn" data-run-case="${escapeHtml(tc.case_id)}" type="button" ${running ? "disabled" : ""}>${running ? "执行中…" : result ? "重新执行" : "执行"}</button>` : ""}${result ? `<button class="case-detail-btn" data-show-result="${escapeHtml(tc.case_id)}" type="button">日志与截图</button>` : ""}</div></article>`;
  }).join("")}</div>`;
}

function switchWorkspace(mode, options = {}) {
  const next = ["design", "execution", "api", "tools"].includes(mode) ? mode : "design";
  state.workspaceMode = next;
  document.querySelectorAll("[data-workspace-panel]").forEach((panel) => {
    panel.hidden = false;
    panel.classList.toggle("workspace-panel-hidden", panel.dataset.workspacePanel !== next);
  });
  document.querySelectorAll("[data-workspace-mode]").forEach((button) => {
    const active = button.dataset.workspaceMode === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  if (next === "tools") {
    const frame = el("toolsWorkspaceFrame");
    if (frame && !frame.getAttribute("src")) frame.src = frame.dataset.src;
  }
  if (options.updateHash !== false) history.replaceState(null, "", next === "tools" ? "#tools" : next === "api" ? "#api" : next === "execution" ? "#web" : location.pathname + location.search);
  if (options.scroll !== false) document.querySelector(".usage-strip")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getExecutionTarget() {
  const target = el("executionTarget").value.trim();
  if (!target) throw new Error("请先填写测试环境地址");
  try { new URL(target); } catch (_) { throw new Error("请输入完整的 http/https 地址"); }
  if (!/^https?:\/\//i.test(target)) throw new Error("测试地址仅支持 http/https");
  return target;
}

function refreshResultsTable() {
  renderSuggestions(state.lastCases);
}

async function executeCase(caseId) {
  if (state.runningCases.has(caseId)) return;
  if (!hasQuota("execution")) return false;
  const testCase = state.lastCases.find((item) => item.case_id === caseId);
  if (!testCase) return;
  let target;
  try { target = getExecutionTarget(); } catch (e) { setStatus(e.message, "err"); return; }
  state.runningCases.add(caseId);
  refreshResultsTable();
  setStatus(`正在执行 ${caseId}…`, "");
  try {
    const out = await api("/api/ai/execute_case", {method:"POST", body:JSON.stringify({target_url:target,test_case:testCase})});
    if(out.quota)state.remoteUsage=out.quota;
    consumeQuota("execution");
    state.executionResults[caseId] = out.result || {status:"failed",log:"服务未返回执行结果"};
    const result = state.executionResults[caseId];
    addHistory(testCase, result, target);
    const resultLabel = {passed:"通过",failed:"失败",blocked:"被网站风控拦截",needs_review:"需要人工确认"}[result.status] || result.status;
    setStatus(`${caseId}：${resultLabel}，耗时 ${formatElapsed(result.duration_ms)}。`, result.status === "passed" ? "ok" : result.status === "needs_review" ? "warn" : "err");
  } catch (e) {
    state.executionResults[caseId] = {status:"failed",duration_ms:0,log:String(e.message || e),error:String(e.message || e)};
    setStatus(`${caseId} 执行失败：${e.message || e}`, "err");
  } finally {
    state.runningCases.delete(caseId);
    refreshResultsTable();
  }
  return true;
}

async function executeAllCases() {
  try { getExecutionTarget(); } catch (e) { setStatus(e.message, "err"); return; }
  if (!state.lastCases.length) { setStatus("请先生成测试用例。", "err"); return; }
  const runnableCases = state.lastCases.filter(automationCandidate);
  if (!runnableCases.length) { setStatus("当前用例均建议人工验证，暂无可自动执行项。", "warn"); return; }
  const btn = el("runAllCases"); btn.disabled = true; btn.textContent = "执行中…";
  try { for (const item of runnableCases) { if (!(await executeCase(item.case_id))) break; } }
  finally { btn.disabled = false; btn.textContent = "执行全部可自动化用例"; }
}

function showExecutionResult(caseId) {
  const result = state.executionResults[caseId];
  const testCase = state.lastCases.find((item) => item.case_id === caseId);
  if (!result) return;
  el("executionCaseId").textContent = caseId;
  el("executionTitle").textContent = testCase ? testCase.title : "执行详情";
  const resultLabel = {passed:"通过",failed:"失败",blocked:"被拦截",needs_review:"需确认"}[result.status] || result.status;
  el("executionMeta").innerHTML = `<span class="run-status ${escapeHtml(result.status)}">${escapeHtml(resultLabel)}</span>${result.summary ? `<b>${escapeHtml(result.summary)}</b>` : ""}<span>耗时 ${escapeHtml(formatElapsed(result.duration_ms))}</span>${result.final_url ? `<span>${escapeHtml(result.final_url)}</span>` : ""}`;
  el("executionLog").textContent = result.log || "暂无日志";
  const hasShot = Boolean(result.screenshot_base64);
  el("executionShotWrap").hidden = !hasShot;
  el("executionScreenshot").src = hasShot ? `data:${result.screenshot_mime || "image/png"};base64,${result.screenshot_base64}` : "";
  el("executionDialog").showModal();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildCsv(rows) {
  const headers = ["用例ID", "模块", "标题", "优先级", "前置条件", "执行步骤", "预期结果"];
  const esc = (v) => {
    const s = String(v == null ? "" : v).replaceAll('"', '""');
    if (s.includes(",") || s.includes("\n") || s.includes("\r") || s.includes('"')) {
      return `"${s}"`;
    }
    return s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.id,
        row.module,
        row.title,
        row.priority,
        row.precondition,
        row.steps,
        row.expectedResult,
      ]
        .map(esc)
        .join(",")
    ),
  ];
  return lines.join("\r\n");
}

function downloadExcel() {
  if (!Array.isArray(state.lastRows) || state.lastRows.length === 0) {
    setStatus("暂无可下载结果，请先生成用例。", "err");
    return;
  }

  const ts = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
  if (window.XLSX && window.XLSX.utils && window.XLSX.write) {
    const sheetData = [
      ["用例ID", "模块", "标题", "优先级", "前置条件", "执行步骤", "预期结果"],
      ...state.lastRows.map((row) => [
        row.id,
        row.module,
        row.title,
        row.priority,
        row.precondition,
        row.steps,
        row.expectedResult,
      ]),
    ];
    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.aoa_to_sheet(sheetData);
    ws["!cols"] = [{ wch: 18 }, { wch: 14 }, { wch: 24 }, { wch: 10 }, { wch: 30 }, { wch: 46 }, { wch: 30 }];
    window.XLSX.utils.book_append_sheet(wb, ws, "测试用例");
    const arrayBuf = window.XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([arrayBuf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    downloadBlob(blob, `ai_test_cases_${ts}.xlsx`);
    setStatus("Excel 已下载。", "ok");
    return;
  }

  const csv = buildCsv(state.lastRows);
  const csvBlob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(csvBlob, `ai_test_cases_${ts}.csv`);
  setStatus("未加载 Excel 引擎，已下载 CSV。", "warn");
}

function downloadCaseHome() {
  const delivery = state.lastOutput?.pipeline?.case_home;
  if (!delivery || !Array.isArray(delivery.records) || !delivery.records.length) {
    setStatus("暂无 Case Home 交付数据，请先完成生成。", "err");
    return;
  }
  const blob = new Blob([JSON.stringify(delivery, null, 2)], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, `case_home_ai_${new Date().toISOString().slice(0, 10)}.json`);
  setStatus(`已导出 ${delivery.total} 条 Case Home JSON。`, "ok");
}

function pipelineArtifact(pipeline, key) {
  if (!pipeline) return null;
  const artifacts = {
    spec: pipeline.spec_review,
    risk: pipeline.risk_plan,
    split: { units: pipeline.requirement_units || [] },
    dimensions: pipeline.coverage,
    cases: { total: state.lastCases.length, records: state.lastCases },
    delivery: { traceability: pipeline.traceability || [], case_home: pipeline.case_home || {} },
  };
  return artifacts[key] || null;
}

function syncPipelineSkillOutputs(pipeline) {
  if (!pipeline) return;
  for (const skill of PIPELINE_SKILLS) {
    const artifact = pipelineArtifact(pipeline, skill.key);
    if (artifact) state.pipelineSkillOutputs[skill.key] = artifact;
  }
  updatePipelineStepState();
}

function skillEmpty(message) {
  return `<div class="skill-empty">${escapeHtml(message)}</div>`;
}

function renderSkillArtifact(skill, artifact) {
  if (!artifact) return skillEmpty("点击“运行当前技能”查看该节点的中间产物。");
  if (skill.key === "spec") {
    const issues = Array.isArray(artifact.issues) ? artifact.issues : [];
    return `<div class="skill-score"><strong>${escapeHtml(String(artifact.score ?? "--"))}</strong><span>需求质量分</span><em class="${issues.length ? "attention" : "passed"}">${issues.length ? `${issues.length} 项待澄清` : "可进入下一步"}</em></div>
      <div class="skill-list">${issues.length ? issues.map((item, index) => `<article><span class="skill-index">${String(index + 1).padStart(2, "0")}</span><div><small>${escapeHtml(item.category || "待澄清")} · ${item.severity === "high" ? "高优先级" : "中优先级"}</small><b>${escapeHtml(item.detail || "")}</b><p>${escapeHtml(item.suggestion || "")}</p></div></article>`).join("") : `<article class="passed"><div><b>未发现阻断项</b><p>需求具备继续分析的基本条件。</p></div></article>`}</div>
      <details class="skill-source"><summary>查看已审查需求</summary><pre>${escapeHtml(artifact.clarified_requirement || "")}</pre></details>`;
  }
  if (skill.key === "risk") {
    const risks = Array.isArray(artifact.risks) ? artifact.risks : [];
    return `<div class="skill-summary-row"><span><small>测试策略</small><b>${escapeHtml(artifact.strategy || "风险驱动")}</b></span><span><small>影响端</small><b>${escapeHtml((artifact.scope || []).join(" · ") || "待识别")}</b></span><span><small>代码 Diff</small><b>${artifact.code_diff_included ? "已纳入" : "未提供"}</b></span></div><div class="skill-list">${risks.map((item, index) => `<article><span class="risk-level ${escapeHtml(item.level || "medium")}">${item.level === "high" ? "高" : "中"}</span><div><b>${escapeHtml(item.risk || "")}</b><p>${escapeHtml(item.impact || "")} · ${escapeHtml(item.strategy || "")}</p></div></article>`).join("") || skillEmpty("暂未识别到明确风险。")}</div>`;
  }
  if (skill.key === "split") {
    const units = Array.isArray(artifact.units) ? artifact.units : [];
    return `<div class="skill-card-grid">${units.map((item) => `<article><small>${escapeHtml(item.id || "")} · ${escapeHtml(item.end || "")}</small><b>${escapeHtml(item.title || "")}</b><p>${escapeHtml(item.scope || item.methodology || "")}</p><em>${escapeHtml(item.methodology || "")}</em></article>`).join("") || skillEmpty("暂无可拆分需求单元。")}</div>`;
  }
  if (skill.key === "dimensions") {
    const rows = Array.isArray(artifact.dimensions) ? artifact.dimensions : [];
    return `<div class="skill-list coverage-list">${rows.map((item, index) => `<article><span class="skill-index">${String(index + 1).padStart(2, "0")}</span><div><small>${escapeHtml(item.method || "测试设计")}</small><b>${escapeHtml(item.module || "覆盖维度")}</b><p>${escapeHtml((item.checks || []).join(" · "))}</p></div></article>`).join("") || skillEmpty("请先完成需求分析以生成覆盖维度。")}</div>`;
  }
  if (skill.key === "cases") {
    const records = Array.isArray(artifact.records) ? artifact.records : [];
    return `<div class="skill-score compact"><strong>${escapeHtml(String(artifact.total ?? records.length))}</strong><span>条可执行用例</span><em class="passed">已同步到下方用例表</em></div><div class="skill-case-preview">${records.slice(0, 5).map((item) => `<span><b>${escapeHtml(item.case_id || "")}</b>${escapeHtml(item.title || "")}</span>`).join("")}</div>`;
  }
  const traceability = Array.isArray(artifact.traceability) ? artifact.traceability : [];
  const caseHome = artifact.case_home || {};
  return `<div class="skill-summary-row"><span><small>追溯关系</small><b>${traceability.length} 组</b></span><span><small>交付格式</small><b>${escapeHtml(caseHome.format || "Case Home JSON")}</b></span><span><small>可交付用例</small><b>${escapeHtml(String(caseHome.total || 0))} 条</b></span></div><p class="skill-delivery-note">交付数据已就绪，可在结果区导出 Case Home JSON 或 Excel。</p>`;
}

function renderSelectedPipelineSkill() {
  const index = PIPELINE_SKILLS.findIndex((item) => item.key === state.selectedPipelineStage);
  const skill = PIPELINE_SKILLS[index] || PIPELINE_SKILLS[0];
  const artifact = state.pipelineSkillOutputs[skill.key];
  el("currentSkillName").textContent = `${String(index + 1).padStart(2, "0")} · ${skill.name}`;
  el("currentSkillMethod").textContent = skill.method;
  const panel = el("pipelineSkillPanel");
  panel.hidden = false;
  const nextSkill = PIPELINE_SKILLS[index + 1];
  panel.innerHTML = `<div class="pipeline-skill-head"><b>${escapeHtml(skill.name)} Skill</b><span>${artifact ? "已完成，可继续调试" : "等待运行"}</span></div><div class="pipeline-skill-contract"><div><small>方法</small><strong>${escapeHtml(skill.method)}</strong></div><div><small>输入</small><strong>${escapeHtml(skill.input)}</strong></div><div><small>输出</small><strong>${escapeHtml(skill.output)}</strong></div></div><div class="pipeline-skill-output">${renderSkillArtifact(skill, artifact)}</div>${artifact && nextSkill ? `<div class="skill-next"><span>当前产物会作为下一节点的输入</span><button type="button" data-next-pipeline="${escapeHtml(nextSkill.key)}">继续：${escapeHtml(nextSkill.name)} →</button></div>` : ""}`;
}

function updatePipelineStepState(runningKey = "") {
  document.querySelectorAll("[data-pipeline-stage]").forEach((button) => {
    const key = button.dataset.pipelineStage;
    button.classList.toggle("active", key === state.selectedPipelineStage);
    button.classList.toggle("completed", Boolean(state.pipelineSkillOutputs[key]));
    button.classList.toggle("running", key === runningKey);
  });
}

function generationContext() {
  const generationMode = document.querySelector('input[name="generationMode"]:checked')?.value || "sketch";
  const sddSpec = el("sddSpec").value.trim();
  const prompt = generationMode === "standard"
    ? `请基于上传的需求文档“${el("sddSpec").dataset.fileName || "需求文档"}”完成完整测试分析并生成可执行用例。`
    : el("aiPrompt").value.trim();
  return { prompt, generationMode, sddSpec, codeDiff: el("codeDiff").value.trim() };
}

async function runCurrentPipelineSkill() {
  const skill = PIPELINE_SKILLS.find((item) => item.key === state.selectedPipelineStage) || PIPELINE_SKILLS[0];
  const context = generationContext();
  if (context.generationMode === "sketch" && !context.prompt) return setStatus("请先输入需求文本。", "err");
  if (context.generationMode === "standard" && !context.sddSpec) return setStatus("请先上传需求或 SDD 文档。", "err");
  if (skill.key === "cases") {
    const out = await generate();
    if (out) { state.selectedPipelineStage = "cases"; renderSelectedPipelineSkill(); }
    return;
  }
  if (skill.key === "delivery" && !state.lastCases.length) return setStatus("交付闭环需要先运行“详细用例”节点。", "err");
  updatePipelineStepState(skill.key);
  el("runCurrentSkill").disabled = true;
  setStatus(`正在运行 ${skill.name} Skill…`, "");
  try {
    const result = await api("/api/ai/pipeline_stage", {method:"POST", body:JSON.stringify({stage:skill.key,prompt:context.prompt,generation_mode:context.generationMode,sdd_spec:context.sddSpec,code_diff:context.codeDiff,cases:state.lastCases})});
    state.pipelineSkillOutputs[skill.key] = result.artifact || {};
    setStatus(`${skill.name}已完成，可检查输出后继续下一步。`, "ok");
    renderSelectedPipelineSkill();
  } catch (error) { setStatus(`${skill.name}运行失败：${error.message || error}`, "err"); }
  finally { el("runCurrentSkill").disabled = false; updatePipelineStepState(); }
}

function renderPipeline(pipeline) {
  const box = el("pipelineResult");
  if (!box) return;
  if (!pipeline || !Array.isArray(pipeline.stages)) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const issues = pipeline.spec_review?.issues || [];
  const risk = pipeline.risk_plan?.risk_distribution || {};
  const ends = pipeline.requirement_units?.map((item) => item.end).join(" · ") || "待识别";
  box.hidden = false;
  box.innerHTML = `
    <div class="pipeline-result-head"><div><span>GENERATION PIPELINE · ${escapeHtml(pipeline.version || "2.0")}</span><b>${escapeHtml(pipeline.mode_label || pipeline.mode)}</b></div><em>需求质量 ${escapeHtml(pipeline.spec_review?.score ?? "--")} / 100</em></div>
    <div class="pipeline-stage-grid">${pipeline.stages.map((stage, index) => `<article class="pipeline-stage ${escapeHtml(stage.status || "")}"><small>0${index + 1}</small><b>${escapeHtml(stage.name)}</b><span>${escapeHtml(stage.summary)}</span></article>`).join("")}</div>
    <div class="pipeline-insights">
      <article class="${issues.length ? "attention" : ""}"><small>Spec 待澄清</small><b>${issues.length ? `${issues.length} 项 · ${issues.slice(0, 2).map((x) => x.category).join(" / ")}` : "未发现阻断项"}</b></article>
      <article><small>风险分布</small><b>高 ${risk.high || 0} · 中 ${risk.medium || 0} · 低 ${risk.low || 0}</b></article>
      <article><small>端归属与追溯</small><b>${escapeHtml(ends)} · ${pipeline.traceability?.length || 0} 组映射</b></article>
    </div>`;
}

function renderOutput(out) {
  state.lastOutput = out;
  state.executionResults = {};
  state.runningCases.clear();
  renderSummary(out);
  renderPipeline(out.pipeline);
  renderSuggestions(out.suggestions || []);
  syncPipelineSkillOutputs(out.pipeline);
  renderSelectedPipelineSkill();
  el("aiOut").textContent = JSON.stringify(out, null, 2);
  persistCases();
}

function safeRead(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } }
function safeWrite(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} }
function persistCases() {
  if (state.lastCases.length) safeWrite(STORAGE_CASES, {target:el("executionTarget").value.trim(),cases:state.lastCases,savedAt:new Date().toISOString()});
}
function loadDemo(name) {
  const demo=DEMOS[name]; if (!demo) return;
  el("executionTarget").value=demo.target; el("aiPrompt").value=`已载入可运行示例：${demo.case.title}`;
  state.executionResults={}; state.lastOutput={suggestions:[demo.case],provider:"demo"};
  renderSuggestions([demo.case]); renderSummary({suggestions:[demo.case],provider:"demo",runtime:{mode:"demo"}}); persistCases();
  setStatus(`已载入“${demo.case.title}”，已同步到自动化执行模块。`,"ok"); switchWorkspace("execution");
}
function addHistory(testCase,result,target) {
  const rows=safeRead(STORAGE_HISTORY,[]); rows.unshift({id:`${Date.now()}-${testCase.case_id}`,caseId:testCase.case_id,title:testCase.title,target,status:result.status,summary:result.summary||"",durationMs:result.duration_ms||0,createdAt:new Date().toISOString()});
  safeWrite(STORAGE_HISTORY,rows.slice(0,12)); renderHistory();
}
function renderHistory() {
  const rows=safeRead(STORAGE_HISTORY,[]),box=el("historyList"); if(!rows.length){box.innerHTML="<p>还没有执行记录</p>";return;}
  const labels={passed:"通过",failed:"失败",blocked:"被拦截",needs_review:"需确认"};
  box.innerHTML=rows.map(row=>`<article><span class="run-status ${escapeHtml(row.status)}">${escapeHtml(labels[row.status]||row.status)}</span><div><b>${escapeHtml(row.title)}</b><small>${escapeHtml(row.target)} · ${new Date(row.createdAt).toLocaleString()}</small></div><em>${escapeHtml(formatElapsed(row.durationMs))}</em></article>`).join("");
}

function formatHistoryTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { hour12: false });
}

function renderGenerationHistory(records) {
  const box = el("generationHistoryList");
  if (!box) return;
  if (!Array.isArray(records) || !records.length) {
    box.innerHTML = "<p>还没有云端生成记录，完成下一次生成后会自动保存。</p>";
    return;
  }
  box.innerHTML = records.map((row) => `
    <article data-generation-id="${escapeHtml(row.id)}">
      <div><b>${escapeHtml(row.title || "未命名测试需求")}</b><small>${escapeHtml(formatHistoryTime(row.createdAt))}</small><span class="generation-history-meta"><span>${row.generationMode === "standard" ? "文档驱动" : "快速生成"}</span><span>${escapeHtml(row.modelProvider || "unknown")}</span><span>${escapeHtml(String(row.caseCount || 0))} 条用例</span><span>质量 ${escapeHtml(String(row.specScore ?? "--"))}</span></span></div>
      <span class="generation-history-actions"><button type="button" data-open-generation="${escapeHtml(row.id)}">恢复到工作台</button><button type="button" data-delete-generation="${escapeHtml(row.id)}">删除</button></span>
    </article>`).join("");
}

function setSddDocument(content = "", fileName = "", fileSize = 0) {
  el("sddSpec").value = content;
  el("sddSpec").dataset.fileName = fileName;
  const hasContent = Boolean(content.trim());
  el("sddFileMeta").textContent = hasContent
    ? `${fileName || "已保存的需求文档"}${fileSize ? ` · ${Math.max(1, Math.round(fileSize / 1024))} KB` : ""} · 已读取 ${content.length.toLocaleString("zh-CN")} 字`
    : "尚未选择文件";
  el("removeSddFile").hidden = !hasContent;
}

async function loadSddDocument(file) {
  const supported = /\.(txt|md|markdown|json|ya?ml|csv|log)$/i;
  if (!file) return;
  if (!supported.test(file.name)) {
    el("sddSpecFile").value = "";
    setStatus("暂不支持该文件格式，请上传 TXT、Markdown、JSON、YAML 或 CSV。", "err");
    return;
  }
  if (file.size > 256 * 1024) {
    el("sddSpecFile").value = "";
    setStatus("需求文档不能超过 256 KB，请精简后重新上传。", "err");
    return;
  }
  try {
    const content = (await file.text()).replace(/^\uFEFF/, "").trim();
    if (!content) throw new Error("文件内容为空");
    if (content.length > 30000) throw new Error("文档内容超过 30,000 字，请精简后上传");
    setSddDocument(content, file.name, file.size);
    setStatus(`已读取需求文档：${file.name}`, "ok");
  } catch (error) {
    el("sddSpecFile").value = "";
    setSddDocument();
    setStatus(`文档读取失败：${error.message || error}`, "err");
  }
}

async function loadGenerationHistory() {
  const section = el("generationHistorySection");
  if (!section) return;
  const token = accountToken();
  section.hidden = !token;
  if (!token) return;
  el("generationHistoryList").innerHTML = "<p>正在加载生成记录…</p>";
  try {
    const response = await fetch(`${GENERATION_API}?limit=20`, { headers: accountHeaders() });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) { section.hidden = true; return; }
    if (!response.ok || payload.code !== 0) throw new Error(payload.message || "生成记录加载失败");
    renderGenerationHistory(payload.data?.records || []);
    el("generationHistoryNote").textContent = `已保存 ${Number(payload.data?.total || 0)} 次生成，点击记录可恢复需求、分析和完整用例。`;
  } catch (error) {
    el("generationHistoryList").innerHTML = `<p class="history-error">${escapeHtml(error.message || "生成记录加载失败")}</p>`;
  }
}

async function saveGeneratedAsset({ out, prompt, generationMode, sddSpec, codeDiff }) {
  if (!accountToken()) return "local";
  try {
    const response = await fetch(GENERATION_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...accountHeaders() },
      body: JSON.stringify({
        title: prompt.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 200) || "未命名测试需求",
        requirement: prompt,
        generationMode,
        modelProvider: out.provider || "unknown",
        sddSpec,
        codeDiff,
        pipeline: out.pipeline || {},
        cases: out.suggestions || [],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.code !== 0) throw new Error(payload.message || "云端保存失败");
    await loadGenerationHistory();
    return "saved";
  } catch (error) {
    el("generationHistoryNote").textContent = `本次生成成功，但云端保存失败：${error.message || "请稍后重试"}`;
    return "failed";
  }
}

async function restoreGeneration(id) {
  try {
    setStatus("正在恢复云端生成记录…", "");
    const response = await fetch(`${GENERATION_API}/${encodeURIComponent(id)}`, { headers: accountHeaders() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.code !== 0) throw new Error(payload.message || "生成详情加载失败");
    const data = payload.data || {};
    el("aiPrompt").value = data.requirement || "";
    setSddDocument(data.sddSpec || "", data.sddSpec ? "历史记录中的需求文档" : "");
    el("codeDiff").value = data.codeDiff || "";
    const mode = data.generationMode === "standard" ? "standard" : "sketch";
    const radio = document.querySelector(`input[name="generationMode"][value="${mode}"]`);
    if (radio) radio.checked = true;
    syncGenerationMode();
    renderOutput({ suggestions: data.cases || [], pipeline: data.pipeline || {}, provider: data.modelProvider || "cloud-history", runtime: { mode: "cloud-history" } });
    setStatus(`已恢复“${data.title || "生成记录"}”的 ${Number(data.caseCount || 0)} 条用例。`, "ok");
    el("pipelineResult").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) { setStatus(`恢复失败：${error.message || error}`, "err"); }
}

async function deleteGeneration(id) {
  if (!window.confirm("确认删除这条生成记录？删除后无法恢复。")) return;
  try {
    const response = await fetch(`${GENERATION_API}/${encodeURIComponent(id)}`, { method: "DELETE", headers: accountHeaders() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.code !== 0) throw new Error(payload.message || "删除失败");
    await loadGenerationHistory();
    setStatus("生成记录已删除。", "ok");
  } catch (error) { setStatus(`删除失败：${error.message || error}`, "err"); }
}
function restoreWorkspace() {
  const saved=safeRead(STORAGE_CASES,null); if(!saved||!Array.isArray(saved.cases)||!saved.cases.length)return;
  state.lastCases=saved.cases; el("executionTarget").value=saved.target||""; renderSuggestions(saved.cases); renderSummary({suggestions:saved.cases,provider:"local",runtime:{mode:"local-history"}}); setStatus("已恢复上次的测试用例。","");
}

async function generate() {
  const selectedProvider = (el("aiModel") && el("aiModel").value ? el("aiModel").value : "deepseek").trim();
  const {prompt, generationMode, sddSpec: documentContent, codeDiff} = generationContext();
  if (generationMode === "sketch" && !prompt) {
    setStatus("请输入需求文本后再生成。", "err");
    return;
  }
  if (generationMode === "standard" && !documentContent) {
    setStatus("文档驱动模式需要先上传需求或 SDD 文档。", "err");
    return;
  }
  if (!hasQuota("generation")) return;

  setBusy(true);
  startPipelineProgress();
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const out = await api("/api/ai/generate_cases", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        model_provider: selectedProvider,
        generation_mode: generationMode,
        sdd_spec: generationMode === "standard" ? el("sddSpec").value.trim() : "",
        code_diff: codeDiff,
        create: false,
      }),
    });
    if(out.quota)state.remoteUsage=out.quota;
    consumeQuota("generation");
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    out.client_elapsed_ms = Math.max(0, Math.round(t1 - t0));
    renderOutput(out);
    const cloudState = await saveGeneratedAsset({
      out,
      prompt,
      generationMode,
      sddSpec: generationMode === "standard" ? el("sddSpec").value.trim() : "",
      codeDiff,
    });
    const count = Array.isArray(out.suggestions) ? out.suggestions.length : 0;
    const elapsedLabel = formatElapsed(out.elapsed_ms || out.client_elapsed_ms || 0);
    setStatus(
      `${elapsedLabel ? `生成完成：${count} 条用例，耗时 ${elapsedLabel}` : `生成完成：${count} 条用例`}${cloudState === "saved" ? "，已保存到账号" : cloudState === "failed" ? "，云端保存失败" : "，登录后可云端保存"}。`,
      out.warning || cloudState === "failed" ? "warn" : "ok"
    );
    return out;
  } catch (e) {
    setStatus("生成失败：" + String(e && e.message ? e.message : e), "err");
    return null;
  } finally {
    stopPipelineProgress();
    setBusy(false);
  }
}

async function copyJson() {
  if (!state.lastOutput) {
    setStatus("暂无结果可复制。", "err");
    return;
  }
  const text = JSON.stringify(state.lastOutput, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    setStatus("已复制 JSON 到剪贴板。", "ok");
  } catch (_) {
    setStatus("复制失败，请手动复制。", "warn");
  }
}

function toggleRaw() {
  state.showRaw = !state.showRaw;
  const pre = el("aiOut");
  const btn = el("toggleRaw");
  pre.hidden = !state.showRaw;
  btn.textContent = state.showRaw ? "隐藏原始 JSON" : "显示原始 JSON";
}

function fillSample() {
  const quickMode = document.querySelector('input[name="generationMode"][value="sketch"]');
  if (quickMode) quickMode.checked = true;
  syncGenerationMode();
  el("aiPrompt").value = SAMPLE_PROMPT;
  setStatus("已填充示例需求。", "");
}

function clearPrompt() {
  el("aiPrompt").value = "";
  if (el("sddSpecFile")) el("sddSpecFile").value = "";
  setSddDocument();
  if (el("codeDiff")) el("codeDiff").value = "";
  state.pipelineSkillOutputs = {};
  state.selectedPipelineStage = "spec";
  updatePipelineStepState();
  renderSelectedPipelineSkill();
  setStatus("已清空输入。", "");
}

function syncGenerationMode() {
  const mode = document.querySelector('input[name="generationMode"]:checked')?.value || "sketch";
  el("standardFields").hidden = mode !== "standard";
  el("aiPrompt").hidden = mode === "standard";
  el("aiPrompt").placeholder = mode === "standard"
    ? "补充本次测试目标、范围和特别关注的风险；完整需求请通过下方上传文档。"
    : "描述功能目标、业务规则、成功条件、异常限制和关键测试数据。";
}

function bindEvents() {
  el("aiGo").addEventListener("click", generate);
  el("downloadExcel").addEventListener("click", downloadExcel);
  el("downloadCaseHome").addEventListener("click", downloadCaseHome);
  el("copyJson").addEventListener("click", copyJson);
  el("toggleRaw").addEventListener("click", toggleRaw);
  el("fillSample").addEventListener("click", fillSample);
  el("clearPrompt").addEventListener("click", clearPrompt);
  el("sddSpecFile").addEventListener("change", (event) => loadSddDocument(event.target.files?.[0]));
  el("removeSddFile").addEventListener("click", () => { el("sddSpecFile").value = ""; setSddDocument(); setStatus("需求文档已移除。", ""); });
  el("runCurrentSkill").addEventListener("click", runCurrentPipelineSkill);
  el("pipelineSteps").addEventListener("click", (event) => {
    const button = event.target.closest("[data-pipeline-stage]");
    if (!button) return;
    state.selectedPipelineStage = button.dataset.pipelineStage;
    updatePipelineStepState();
    renderSelectedPipelineSkill();
  });
  el("pipelineSkillPanel").addEventListener("click", (event) => {
    const button = event.target.closest("[data-next-pipeline]");
    if (!button) return;
    state.selectedPipelineStage = button.dataset.nextPipeline;
    updatePipelineStepState();
    renderSelectedPipelineSkill();
    el("pipelineSkillPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  document.querySelectorAll("[data-workspace-mode]").forEach((button) => button.addEventListener("click", () => switchWorkspace(button.dataset.workspaceMode)));
  el("openExecutionWorkspace").addEventListener("click", () => {
    if (!state.lastCases.length) { setStatus("请先生成或恢复测试用例，再进入自动化执行。", "warn"); return; }
    switchWorkspace("execution");
  });
  el("backToDesign").addEventListener("click", () => switchWorkspace("design"));
  document.querySelectorAll('input[name="generationMode"]').forEach((radio) => radio.addEventListener("change", syncGenerationMode));
  document.querySelectorAll("[data-demo]").forEach((button) => button.addEventListener("click", () => loadDemo(button.dataset.demo)));
  el("clearHistory").addEventListener("click", () => { localStorage.removeItem(STORAGE_HISTORY); renderHistory(); setStatus("本地执行记录已清空。", ""); });
  el("refreshGenerationHistory").addEventListener("click", loadGenerationHistory);
  el("generationHistoryList").addEventListener("click", (event) => {
    const open = event.target.closest("[data-open-generation]");
    const remove = event.target.closest("[data-delete-generation]");
    if (open) restoreGeneration(open.dataset.openGeneration);
    if (remove) deleteGeneration(remove.dataset.deleteGeneration);
  });
  el("executionTarget").addEventListener("change", persistCases);
  el("runAllCases").addEventListener("click", executeAllCases);
  el("closeExecutionDialog").addEventListener("click", () => el("executionDialog").close());
  el("openActivation").addEventListener("click",()=>{el("activationMessage").textContent="";el("activationDialog").showModal()});
  el("closeActivation").addEventListener("click",()=>el("activationDialog").close());
  el("activationForm").addEventListener("submit",async event=>{event.preventDefault();const button=event.submitter,label=button.textContent,message=el("activationMessage");button.disabled=true;button.textContent="正在激活…";message.textContent="";message.className="";try{const response=await fetch(`${ENTITLEMENT_API}/activate`,{method:"POST",headers:{"Content-Type":"application/json",...accountHeaders()},body:JSON.stringify({activationCode:el("activationCodeInput").value,browserId:browserId()})});const data=await response.json().catch(()=>({}));if(!response.ok||data.code!==0)throw new Error(data.message||"激活失败");state.entitlement=data.data;message.textContent="专业版已激活";message.className="success";renderQuota();setTimeout(()=>el("activationDialog").close(),1200)}catch(error){message.textContent=error.message||"激活失败"}finally{button.disabled=false;button.textContent=label}});
  el("executionCases").addEventListener("click", (event) => {
    const runButton = event.target.closest("[data-run-case]");
    const detailButton = event.target.closest("[data-show-result]");
    if (runButton) executeCase(runButton.dataset.runCase);
    if (detailButton) showExecutionResult(detailButton.dataset.showResult);
  });

  el("aiPrompt").addEventListener("keydown", (evt) => {
    if ((evt.metaKey || evt.ctrlKey) && evt.key === "Enter") {
      evt.preventDefault();
      if (!state.busy) {
        generate();
      }
    }
  });
}

function main() {
  bindEvents();
  syncGenerationMode();
  renderSelectedPipelineSkill();
  restoreWorkspace();
  renderHistory();
  renderQuota();
  refreshEntitlement();
  refreshUsage();
  loadGenerationHistory();
  switchWorkspace(["#execution", "#web"].includes(location.hash) ? "execution" : location.hash === "#api" ? "api" : location.hash === "#tools" ? "tools" : "design", { scroll: false, updateHash: false });
  if (!state.lastCases.length) {
    setStatus("就绪。按 Ctrl/Cmd + Enter 可快速生成。", "");
    el("executionStatus").textContent = "准备执行：请先生成或恢复测试用例。";
  }
}

function syncAccountState(detail) {
  state.accountLoggedIn=Boolean(detail?.user?.id);
  if(detail?.entitlement)state.entitlement=detail.entitlement;
  renderQuota();
  if (state.accountLoggedIn) loadGenerationHistory();
  else if (el("generationHistorySection")) el("generationHistorySection").hidden = true;
}

window.addEventListener("lingtest:account-loaded",event=>syncAccountState(event.detail));
if(window.LingTestAccount)syncAccountState(window.LingTestAccount);

main();
