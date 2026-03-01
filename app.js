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
  ["aiGo", "fillSample", "clearPrompt", "copyJson", "toggleRaw"].forEach((id) => {
    const node = el(id);
    if (node) {
      node.disabled = busy;
    }
  });
  el("aiGo").textContent = busy ? "生成中..." : "生成结构化用例";
}

function renderSummary(out) {
  const provider = out.provider || "unknown";
  const warning = out.warning || "";
  const count = Array.isArray(out.suggestions) ? out.suggestions.length : 0;

  const bits = [
    `<span><b>${count}</b> 条用例</span>`,
    `<span>provider: <code>${escapeHtml(provider)}</code></span>`,
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
    module: String(tc.module || "general"),
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
  return lines.map((line) => escapeHtml(line)).join("<br />");
}

function renderStepLines(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return "无";
  }
  return steps
    .map((step) => {
      const parts = [`${step.step_no}. ${step.action}`];
      if (step.test_data) {
        parts.push(`data: ${step.test_data}`);
      }
      if (step.expected_result) {
        parts.push(`expect: ${step.expected_result}`);
      }
      return escapeHtml(parts.join(" | "));
    })
    .join("<br />");
}

function renderSuggestions(list) {
  const box = el("aiCards");
  if (!Array.isArray(list) || list.length === 0) {
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
        <td><div class="ai-cell-lines">${renderLines(tc.preconditions)}</div></td>
        <td><div class="ai-cell-lines">${renderStepLines(tc.steps)}</div></td>
        <td><div class="ai-cell-lines">${escapeHtml(tc.expected_result || "无")}</div></td>
      </tr>`;
    })
    .join("");

  box.innerHTML = `
    <div class="ai-table-wrap">
      <table class="ai-result-table">
        <thead>
          <tr>
            <th>id</th>
            <th>module</th>
            <th>title</th>
            <th>priority</th>
            <th>precondition</th>
            <th>steps</th>
            <th>expectedResult</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderOutput(out) {
  state.lastOutput = out;
  renderSummary(out);
  renderSuggestions(out.suggestions || []);
  el("aiOut").textContent = JSON.stringify(out, null, 2);
}

async function generate() {
  const prompt = el("aiPrompt").value.trim();
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
