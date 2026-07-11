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
};

const SAMPLE_PROMPT = [
  "- 登录成功：手机号+密码+验证码正确",
  "- 登录失败：密码错误",
  "- 登录失败：验证码错误超过 5 次触发账户锁定",
  "- 忘记密码：短信验证码校验成功后可重置密码",
].join("\n");

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
  const testCase = state.lastCases.find((item) => item.case_id === caseId);
  if (!testCase) return;
  let target;
  try { target = getExecutionTarget(); } catch (e) { setStatus(e.message, "err"); return; }
  state.runningCases.add(caseId);
  refreshResultsTable();
  setStatus(`正在执行 ${caseId}…`, "");
  try {
    const out = await api("/api/ai/execute_case", {method:"POST", body:JSON.stringify({target_url:target,test_case:testCase})});
    state.executionResults[caseId] = out.result || {status:"failed",log:"服务未返回执行结果"};
    const result = state.executionResults[caseId];
    const resultLabel = {passed:"通过",failed:"失败",blocked:"被网站风控拦截",needs_review:"需要人工确认"}[result.status] || result.status;
    setStatus(`${caseId}：${resultLabel}，耗时 ${formatElapsed(result.duration_ms)}。`, result.status === "passed" ? "ok" : result.status === "needs_review" ? "warn" : "err");
  } catch (e) {
    state.executionResults[caseId] = {status:"failed",duration_ms:0,log:String(e.message || e),error:String(e.message || e)};
    setStatus(`${caseId} 执行失败：${e.message || e}`, "err");
  } finally {
    state.runningCases.delete(caseId);
    refreshResultsTable();
  }
}

async function executeAllCases() {
  try { getExecutionTarget(); } catch (e) { setStatus(e.message, "err"); return; }
  if (!state.lastCases.length) { setStatus("请先生成测试用例。", "err"); return; }
  const btn = el("runAllCases"); btn.disabled = true; btn.textContent = "执行中…";
  for (const item of state.lastCases) await executeCase(item.case_id);
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
}

async function generate() {
  const prompt = el("aiPrompt").value.trim();
  const selectedProvider = (el("aiModel") && el("aiModel").value ? el("aiModel").value : "deepseek").trim();
  if (!prompt) {
    setStatus("请输入需求文本后再生成。", "err");
    return;
  }

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
  el("runAllCases").addEventListener("click", executeAllCases);
  el("closeExecutionDialog").addEventListener("click", () => el("executionDialog").close());
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
  setStatus("就绪。按 Ctrl/Cmd + Enter 可快速生成。", "");
}

main();
