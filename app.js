function el(id) {
  return document.getElementById(id);
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
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
};

const STORAGE_CASES = "lingtest:last-cases:v1";
const STORAGE_HISTORY = "lingtest:run-history:v1";
const STORAGE_QUOTA = "lingtest:daily-quota:v1";
const STORAGE_BROWSER_ID = "lingtest:browser-id:v1";
const FREE_LIMITS = { generation: 5, execution: 3 };
const ENTITLEMENT_API = "https://timelens.cc/api/lingtest/licenses";
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

function readQuota() {
  const stored = safeRead(STORAGE_QUOTA, {});
  return stored.date === quotaToday() ? { date: stored.date, generation: Number(stored.generation||0), execution: Number(stored.execution||0) } : { date: quotaToday(), generation: 0, execution: 0 };
}

function renderQuota() {
  const quota = readQuota(), generationLeft = Math.max(0, FREE_LIMITS.generation-quota.generation), executionLeft = Math.max(0, FREE_LIMITS.execution-quota.execution);
  const pro=state.entitlement.active&&state.entitlement.plan==="pro",strip=document.querySelector(".usage-strip");
  strip?.classList.toggle("pro",pro);
  el("planLabel").textContent=pro?"PRO PLAN":"FREE PLAN";
  if(pro){el("generationQuota").textContent="生成额度 已解锁";el("executionQuota").textContent="执行额度 已解锁";el("quotaSummary").textContent="专业版权益已生效";el("quotaNote").textContent=state.entitlement.expiresAt?`有效期至 ${new Date(state.entitlement.expiresAt).toLocaleDateString()}`:"当前账户已授权";el("openActivation").hidden=true;return}
  el("openActivation").hidden=false;el("quotaNote").textContent="额度按当前浏览器自然日计算";
  el("generationQuota").textContent = `生成剩余 ${generationLeft}/${FREE_LIMITS.generation}`;
  el("executionQuota").textContent = `执行剩余 ${executionLeft}/${FREE_LIMITS.execution}`;
  el("quotaSummary").textContent = generationLeft || executionLeft ? "先免费验证真实需求" : "今日免费额度已用完";
}

function hasQuota(kind) {
  if(state.entitlement.active&&state.entitlement.plan==="pro")return true;
  const quota = readQuota();
  if (quota[kind] < FREE_LIMITS[kind]) return true;
  setStatus(`今日免费${kind === "generation" ? "生成" : "执行"}额度已用完，可明天继续或申请专业版。`, "warn");
  document.querySelector(".usage-strip")?.scrollIntoView({behavior:"smooth",block:"center"});
  return false;
}

function consumeQuota(kind) {
  if(state.entitlement.active&&state.entitlement.plan==="pro")return;
  const quota = readQuota(); quota[kind] += 1; safeWrite(STORAGE_QUOTA, quota); renderQuota();
}

function setStatus(text, kind) {
  const node = el("aiStatus");
  node.textContent = text;
  node.className = "ai-status" + (kind ? " " + kind : "");
}

function setBusy(busy) {
  state.busy = busy;
  ["aiGo", "fillSample", "clearPrompt", "copyJson", "toggleRaw", "downloadExcel", "aiModel"].forEach((id) => {
    const node = el(id);
    if (node) {
      node.disabled = busy;
    }
  });
  el("aiGo").textContent = busy ? "正在生成测试资产..." : "生成测试用例 →";
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
  if (!Array.isArray(list) || list.length === 0) {
    state.lastRows = [];
    box.innerHTML = '<div class="ai-empty">未生成到可展示用例，请调整需求描述后重试。</div>';
    return;
  }

  state.lastCases = list.map((item, idx) => item && item.case_id ? item : normalizeTestCase(item, idx));
  const rows = state.lastCases
    .map((tc) => {
      const result = state.executionResults[tc.case_id];
      const running = state.runningCases.has(tc.case_id);
      const status = running ? "running" : result ? result.status : "idle";
      const statusText = {running:"执行中",passed:"通过",failed:"失败",blocked:"被拦截",needs_review:"需确认",idle:"未执行"}[status] || status;
      return `
      <tr data-case-id="${escapeHtml(tc.case_id)}">
        <td><div class="ai-cell-lines">${escapeHtml(tc.case_id)}</div></td>
        <td><div class="ai-cell-lines">${escapeHtml(tc.module)}</div></td>
        <td><div class="ai-cell-lines">${escapeHtml(tc.title)}</div></td>
        <td><div class="ai-cell-lines">${escapeHtml(tc.priority)}</div></td>
        <td><div class="ai-cell-lines">${escapeHtml(renderLines(tc.preconditions)).replaceAll("\n", "<br />")}</div></td>
        <td><div class="ai-cell-lines">${escapeHtml(renderStepLines(tc.steps)).replaceAll("\n", "<br />")}</div></td>
        <td><div class="ai-cell-lines">${escapeHtml(tc.expected_result || "无")}</div></td>
        <td class="execution-cell"><span class="run-status ${escapeHtml(status)}">${escapeHtml(statusText)}</span><button class="case-run-btn" data-run-case="${escapeHtml(tc.case_id)}" type="button" ${running ? "disabled" : ""}>${running ? "执行中…" : "执行"}</button>${result ? `<button class="case-detail-btn" data-show-result="${escapeHtml(tc.case_id)}" type="button">查看详情</button>` : ""}</td>
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
            <th class="execution-head">自动执行</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
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
  const btn = el("runAllCases"); btn.disabled = true; btn.textContent = "执行中…";
  for (const item of state.lastCases) { if (!(await executeCase(item.case_id))) break; }
  btn.disabled = false; btn.textContent = "执行全部";
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

function renderOutput(out) {
  state.lastOutput = out;
  state.executionResults = {};
  state.runningCases.clear();
  renderSummary(out);
  renderSuggestions(out.suggestions || []);
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
  setStatus(`已载入“${demo.case.title}”，可直接点击执行。`,"ok"); el("aiCards").scrollIntoView({behavior:"smooth",block:"start"});
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
function restoreWorkspace() {
  const saved=safeRead(STORAGE_CASES,null); if(!saved||!Array.isArray(saved.cases)||!saved.cases.length)return;
  state.lastCases=saved.cases; el("executionTarget").value=saved.target||""; renderSuggestions(saved.cases); renderSummary({suggestions:saved.cases,provider:"local",runtime:{mode:"local-history"}}); setStatus("已恢复上次的测试用例。","");
}

async function generate() {
  const prompt = el("aiPrompt").value.trim();
  const selectedProvider = (el("aiModel") && el("aiModel").value ? el("aiModel").value : "deepseek").trim();
  if (!prompt) {
    setStatus("请输入需求文本后再生成。", "err");
    return;
  }
  if (!hasQuota("generation")) return;

  setBusy(true);
  setStatus("正在调用 AI 生成...", "");
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const out = await api("/api/ai/generate_cases", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        model_provider: selectedProvider,
        create: false,
      }),
    });
    consumeQuota("generation");
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    out.client_elapsed_ms = Math.max(0, Math.round(t1 - t0));
    renderOutput(out);
    const count = Array.isArray(out.suggestions) ? out.suggestions.length : 0;
    const elapsedLabel = formatElapsed(out.elapsed_ms || out.client_elapsed_ms || 0);
    setStatus(
      elapsedLabel ? `生成完成：${count} 条用例，耗时 ${elapsedLabel}。` : `生成完成：${count} 条用例。`,
      out.warning ? "warn" : "ok"
    );
  } catch (e) {
    setStatus("生成失败：" + String(e && e.message ? e.message : e), "err");
  } finally {
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
  el("aiPrompt").value = SAMPLE_PROMPT;
  setStatus("已填充示例需求。", "");
}

function clearPrompt() {
  el("aiPrompt").value = "";
  setStatus("已清空输入。", "");
}

function bindEvents() {
  el("aiGo").addEventListener("click", generate);
  el("downloadExcel").addEventListener("click", downloadExcel);
  el("copyJson").addEventListener("click", copyJson);
  el("toggleRaw").addEventListener("click", toggleRaw);
  el("fillSample").addEventListener("click", fillSample);
  el("clearPrompt").addEventListener("click", clearPrompt);
  document.querySelectorAll("[data-demo]").forEach((button) => button.addEventListener("click", () => loadDemo(button.dataset.demo)));
  el("clearHistory").addEventListener("click", () => { localStorage.removeItem(STORAGE_HISTORY); renderHistory(); setStatus("本地执行记录已清空。", ""); });
  el("executionTarget").addEventListener("change", persistCases);
  el("runAllCases").addEventListener("click", executeAllCases);
  el("closeExecutionDialog").addEventListener("click", () => el("executionDialog").close());
  el("openActivation").addEventListener("click",()=>{el("activationMessage").textContent="";el("activationDialog").showModal()});
  el("closeActivation").addEventListener("click",()=>el("activationDialog").close());
  el("activationForm").addEventListener("submit",async event=>{event.preventDefault();const button=event.submitter,label=button.textContent,message=el("activationMessage");button.disabled=true;button.textContent="正在激活…";message.textContent="";message.className="";try{const response=await fetch(`${ENTITLEMENT_API}/activate`,{method:"POST",headers:{"Content-Type":"application/json",...accountHeaders()},body:JSON.stringify({activationCode:el("activationCodeInput").value,browserId:browserId()})});const data=await response.json().catch(()=>({}));if(!response.ok||data.code!==0)throw new Error(data.message||"激活失败");state.entitlement=data.data;message.textContent="专业版已激活";message.className="success";renderQuota();setTimeout(()=>el("activationDialog").close(),1200)}catch(error){message.textContent=error.message||"激活失败"}finally{button.disabled=false;button.textContent=label}});
  el("aiCards").addEventListener("click", (event) => {
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
  restoreWorkspace();
  renderHistory();
  renderQuota();
  refreshEntitlement();
  if (!state.lastCases.length) setStatus("就绪。按 Ctrl/Cmd + Enter 可快速生成。", "");
}

main();
