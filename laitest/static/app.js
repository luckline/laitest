/* Minimal no-framework UI for the MVP. */

function el(id) { return document.getElementById(id); }

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
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function pill(text, cls) {
  return `<span class="pill ${cls || ""}">${escapeHtml(text)}</span>`;
}

function renderProjects(ps) {
  const box = el("projects");
  box.innerHTML = ps.map(p => {
    return `<div class="item">
      <div class="title"><b>${escapeHtml(p.name)}</b>${pill(p.id, "q")}</div>
      <div class="meta">created_at=${escapeHtml(p.created_at || "")}</div>
      <div class="actions">
        <button class="small" data-del-project="${escapeHtml(p.id)}">Delete</button>
      </div>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-del-project]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del-project");
      if (!confirm("Delete project " + id + " ?")) return;
      await api("/api/project/" + id, { method: "DELETE" });
      await refreshAll();
    });
  });
}

function setOptions(sel, items, getLabel) {
  const v = sel.value;
  sel.innerHTML = items.map(it => `<option value="${escapeHtml(it.id)}">${escapeHtml(getLabel(it))}</option>`).join("");
  if (v && items.some(it => it.id === v)) sel.value = v;
}

function renderSuites(ss) {
  const box = el("suites");
  box.innerHTML = ss.map(s => {
    return `<div class="item">
      <div class="title"><b>${escapeHtml(s.name)}</b>${pill(s.id, "q")}</div>
      <div class="meta">project=${escapeHtml(s.project_id)}</div>
      <div class="actions">
        <button class="small" data-del-suite="${escapeHtml(s.id)}">Delete</button>
      </div>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-del-suite]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del-suite");
      if (!confirm("Delete suite " + id + " ?")) return;
      await api("/api/suite/" + id, { method: "DELETE" });
      await refreshAll();
    });
  });
}

let selectedCaseIds = new Set();

function renderCases(cs) {
  const box = el("cases");
  box.innerHTML = cs.map(c => {
    const tags = (c.tags || []).slice(0, 6).map(t => pill(t, "")).join(" ");
    const checked = selectedCaseIds.has(c.id) ? "checked" : "";
    return `<div class="item">
      <div class="title">
        <b>${escapeHtml(c.title)}</b>
        <label class="check"><input type="checkbox" data-pick-case="${escapeHtml(c.id)}" ${checked} /> pick</label>
      </div>
      <div class="meta">id=${escapeHtml(c.id)} kind=${escapeHtml(c.kind)} suite=${escapeHtml(c.suite_id || "")}</div>
      <div class="meta">tags=${tags || "-"}</div>
      <details style="margin-top:8px">
        <summary class="hint">edit spec</summary>
        <textarea data-edit-spec="${escapeHtml(c.id)}">${escapeHtml(JSON.stringify(c.spec || {}, null, 2))}</textarea>
        <div class="actions">
          <button class="small" data-save-case="${escapeHtml(c.id)}">Save</button>
          <button class="small" data-del-case="${escapeHtml(c.id)}">Delete</button>
        </div>
      </details>
    </div>`;
  }).join("");

  box.querySelectorAll("[data-pick-case]").forEach(chk => {
    chk.addEventListener("change", () => {
      const id = chk.getAttribute("data-pick-case");
      if (chk.checked) selectedCaseIds.add(id);
      else selectedCaseIds.delete(id);
    });
  });

  box.querySelectorAll("[data-save-case]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-save-case");
      const ta = box.querySelector(`[data-edit-spec="${CSS.escape(id)}"]`);
      let spec = {};
      try { spec = JSON.parse(ta.value || "{}"); }
      catch (e) { alert("Invalid JSON spec"); return; }
      await api("/api/case/" + id, { method: "PUT", body: JSON.stringify({ spec }) });
      await refreshAll();
    });
  });

  box.querySelectorAll("[data-del-case]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del-case");
      if (!confirm("Delete case " + id + " ?")) return;
      await api("/api/case/" + id, { method: "DELETE" });
      selectedCaseIds.delete(id);
      await refreshAll();
    });
  });
}

function renderRuns(rs) {
  const box = el("runs");
  box.innerHTML = rs.map(r => {
    const st = r.status || "";
    const cls = st === "finished" ? "ok" : (st === "failed" ? "bad" : "q");
    const sum = r.summary || {};
    const sumText = sum.total ? `total=${sum.total} passed=${sum.passed} failed=${sum.failed}` : "-";
    return `<div class="item">
      <div class="title"><b>${escapeHtml(r.name)}</b>${pill(st, cls)}</div>
      <div class="meta">id=${escapeHtml(r.id)} created_at=${escapeHtml(r.created_at || "")}</div>
      <div class="meta">summary=${escapeHtml(sumText)}</div>
      <div class="actions">
        <button class="small" data-view-run="${escapeHtml(r.id)}">View</button>
      </div>
    </div>`;
  }).join("");

  box.querySelectorAll("[data-view-run]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-view-run");
      const data = await api("/api/run/" + id);
      const run = data.run || {};
      const items = data.items || [];
      const lines = [];
      lines.push("run=" + JSON.stringify(run, null, 2));
      lines.push("items=" + JSON.stringify(items, null, 2));
      alert(lines.join("\n\n").slice(0, 6000));
    });
  });
}

async function refreshAll() {
  const health = await api("/api/health");
  el("health").textContent = "health ok @ " + (health.ts || "");

  const ps = (await api("/api/projects")).projects || [];
  renderProjects(ps);
  [el("suiteProject"), el("caseProject"), el("runProject"), el("aiProject")].forEach(sel => {
    setOptions(sel, ps, p => p.name);
  });

  const projectId = el("caseProject").value || "";
  const ss = (await api("/api/suites?project_id=" + encodeURIComponent(projectId))).suites || [];
  renderSuites(ss);

  [el("caseSuite"), el("runSuite"), el("aiSuite")].forEach(sel => {
    const opts = [{ id: "", name: "(no suite)" }, ...ss];
    const v = sel.value;
    sel.innerHTML = opts.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("");
    if (v && opts.some(o => o.id === v)) sel.value = v;
  });

  const suiteId = el("caseSuite").value || "";
  const cs = (await api("/api/cases?project_id=" + encodeURIComponent(projectId) + "&suite_id=" + encodeURIComponent(suiteId))).cases || [];
  renderCases(cs);

  const rs = (await api("/api/runs?project_id=" + encodeURIComponent(projectId))).runs || [];
  renderRuns(rs);
}

async function main() {
  el("createProject").addEventListener("click", async () => {
    const name = el("projectName").value.trim();
    if (!name) return;
    await api("/api/projects", { method: "POST", body: JSON.stringify({ name }) });
    el("projectName").value = "";
    await refreshAll();
  });

  el("createSuite").addEventListener("click", async () => {
    const project_id = el("suiteProject").value;
    const name = el("suiteName").value.trim();
    if (!project_id || !name) return;
    await api("/api/suites", { method: "POST", body: JSON.stringify({ project_id, name }) });
    el("suiteName").value = "";
    await refreshAll();
  });

  el("createCase").addEventListener("click", async () => {
    const project_id = el("caseProject").value;
    const suite_id = el("caseSuite").value || null;
    const title = el("caseTitle").value.trim();
    if (!project_id || !title) return;
    const spec = { steps: [{ type: "pass", message: "demo pass (edit spec to add http_get etc.)" }] };
    await api("/api/cases", { method: "POST", body: JSON.stringify({ project_id, suite_id, title, kind: "demo", spec }) });
    el("caseTitle").value = "";
    await refreshAll();
  });

  el("caseProject").addEventListener("change", async () => {
    selectedCaseIds = new Set();
    await refreshAll();
  });
  el("caseSuite").addEventListener("change", refreshAll);

  el("createRun").addEventListener("click", async () => {
    const project_id = el("runProject").value;
    const suite_id = el("runSuite").value || null;
    const name = el("runName").value.trim() || "Run";
    const case_ids = Array.from(selectedCaseIds);
    if (!project_id || case_ids.length === 0) {
      alert("Pick cases first");
      return;
    }
    await api("/api/runs", { method: "POST", body: JSON.stringify({ project_id, suite_id, name, case_ids }) });
    await refreshAll();
  });

  el("aiGo").addEventListener("click", async () => {
    const project_id = el("aiProject").value;
    const suite_id = el("aiSuite").value || null;
    const prompt = el("aiPrompt").value;
    const create = el("aiCreate").checked;
    const out = await api("/api/ai/generate_cases", { method: "POST", body: JSON.stringify({ project_id, suite_id, prompt, create }) });
    el("aiOut").textContent = JSON.stringify(out, null, 2);
    await refreshAll();
  });

  await refreshAll();
  setInterval(refreshAll, 2500);
}

main().catch(e => {
  el("health").textContent = "error: " + String(e && e.message ? e.message : e);
});
