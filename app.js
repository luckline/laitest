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
  el("aiGo").textContent = busy ? "生成中..." : "生成结构化用例";
}

function renderSummary(out) {
  const provider = out.provider || "unknown";
  const requestedProvider = out.requested_provider || "deepseek";
  const warning = out.warning || "";
  const count = Array.isArray(out.suggestions) ? out.suggestions.length : 0;
  const runtime = out.runtime && typeof out.runtime === "object" ? out.runtime : {};
  const mode = runtime.mode || "unknown";
  const deepseekKeyConfigured = runtime.deepseek_api_key_configured;
  const qianwenKeyConfigured = runtime.qianwen_api_key_configured;
  const geminiKeyConfigured = runtime.gemini_api_key_configured;

  const bits = [
    `<span><b>${count}</b> 条用例</span>`,
    `<span>requested: <code>${escapeHtml(requestedProvider)}</code></span>`,
    `<span>provider: <code>${escapeHtml(provider)}</code></span>`,
    `<span>mode: <code>${escapeHtml(mode)}</code></span>`,
    `<span>deepseek_key: <code>${escapeHtml(String(Boolean(deepseekKeyConfigured)))}</code></span>`,
    `<span>qianwen_key: <code>${escapeHtml(String(Boolean(qianwenKeyConfigured)))}</code></span>`,
    `<span>gemini_key: <code>${escapeHtml(String(Boolean(geminiKeyConfigured)))}</code></span>`,
    `<span>structure: <code>professional</code></span>`,
  ];
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

  const rows = list
    .map((item, idx) => {
      const tc = normalizeTestCase(item, idx);
      return `
      <tr>
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

  state.lastRows = list.map((item, idx) => {
    const tc = normalizeTestCase(item, idx);
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
  try {
    const out = await api("/api/ai/generate_cases", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        model_provider: selectedProvider,
        create: false,
      }),
    });
    renderOutput(out);
    const count = Array.isArray(out.suggestions) ? out.suggestions.length : 0;
    setStatus(`生成完成：${count} 条用例。`, out.warning ? "warn" : "ok");
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
