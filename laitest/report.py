from __future__ import annotations

import html
import json
from typing import Any


def _esc(s: object) -> str:
    return html.escape(str(s))


def render_run_report(run: dict[str, Any], items: list[dict[str, Any]]) -> str:
    summary = run.get("summary") or {}
    clusters = summary.get("failed_clusters") or []

    rows = []
    for it in items:
        st = it.get("status", "")
        cls = "ok" if st == "passed" else ("bad" if st == "failed" else "q")
        rows.append(
            "<tr>"
            f"<td><span class='pill {cls}'>{_esc(st)}</span></td>"
            f"<td><code>{_esc(it.get('case_id'))}</code></td>"
            f"<td>{_esc(it.get('duration_ms'))}</td>"
            f"<td><pre>{_esc(it.get('log') or '')}</pre></td>"
            "</tr>"
        )

    crows = []
    for c in clusters:
        crows.append(
            "<tr>"
            f"<td>{_esc(c.get('count'))}</td>"
            f"<td><pre>{_esc(c.get('message'))}</pre></td>"
            f"<td><pre>{_esc(json.dumps(c.get('example') or {}, ensure_ascii=True, indent=2))}</pre></td>"
            "</tr>"
        )

    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>laitest report</title>
    <style>
      :root {{
        --bg: #0b1220;
        --card: #111a2e;
        --muted: #94a3b8;
        --text: #e5e7eb;
        --line: rgba(148, 163, 184, 0.18);
        --danger: #fb7185;
        --ok: #34d399;
        --accent2: #38bdf8;
        --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }}
      * {{ box-sizing: border-box; }}
      body {{
        margin: 0;
        color: var(--text);
        background: linear-gradient(180deg, #070b14, var(--bg));
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        padding: 18px 20px 30px;
      }}
      code, pre {{ font-family: var(--mono); }}
      pre {{ white-space: pre-wrap; word-break: break-word; margin: 0; }}
      .card {{
        border: 1px solid var(--line);
        background: rgba(17, 26, 46, 0.78);
        border-radius: 16px;
        padding: 14px;
        margin: 12px 0;
      }}
      h1 {{ margin: 0 0 6px; font-size: 18px; }}
      .muted {{ color: var(--muted); }}
      table {{ width: 100%; border-collapse: collapse; }}
      th, td {{ border-top: 1px solid var(--line); padding: 10px 8px; vertical-align: top; text-align: left; }}
      th {{ color: var(--muted); font-weight: 700; font-size: 12px; }}
      .pill {{
        font-family: var(--mono);
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid var(--line);
        color: var(--muted);
      }}
      .pill.ok {{ color: var(--ok); border-color: rgba(52,211,153,0.35); }}
      .pill.bad {{ color: var(--danger); border-color: rgba(251,113,133,0.35); }}
      .pill.q {{ color: var(--accent2); border-color: rgba(56,189,248,0.35); }}
    </style>
  </head>
  <body>
    <h1>laitest run report</h1>
    <div class="muted">run_id=<code>{_esc(run.get("id"))}</code> status={_esc(run.get("status"))}</div>
    <div class="card">
      <div><b>Summary</b></div>
      <pre>{_esc(json.dumps(summary, ensure_ascii=True, indent=2))}</pre>
    </div>
    <div class="card">
      <div><b>Failure Clusters</b></div>
      <table>
        <thead>
          <tr><th>Count</th><th>Message</th><th>Example</th></tr>
        </thead>
        <tbody>
          {''.join(crows) if crows else '<tr><td colspan=\"3\" class=\"muted\">-</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="card">
      <div><b>Items</b></div>
      <table>
        <thead>
          <tr><th>Status</th><th>Case</th><th>ms</th><th>Log</th></tr>
        </thead>
        <tbody>
          {''.join(rows) if rows else '<tr><td colspan=\"4\" class=\"muted\">-</td></tr>'}
        </tbody>
      </table>
    </div>
  </body>
</html>
"""

