from __future__ import annotations

import argparse
import json
from typing import Any

from .ai import generate_cases
from .db import db_conn, json_loads, row_to_dict, utc_now_iso
from .ids import new_id
from .report import render_run_report
from .runner import analyze_failures, run_case, summarize_run


def _pp(obj: object) -> None:
    print(json.dumps(obj, ensure_ascii=True, indent=2))  # noqa: T201


def _get_run(con, run_id: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    run = con.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
    if not run:
        raise SystemExit(f"run not found: {run_id}")
    items = con.execute("SELECT * FROM run_items WHERE run_id=? ORDER BY id", (run_id,)).fetchall()
    run_d = row_to_dict(run)
    run_d["summary"] = json_loads(run_d.get("summary_json") or "{}", {})
    out_items = []
    for it in items:
        d = row_to_dict(it)
        d["data"] = json_loads(d.get("data_json") or "{}", {})
        out_items.append(d)
    return run_d, out_items


def run_cli(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="python3 -m laitest cli")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("health", help="Check DB health (no server)")

    sp = sub.add_parser("project-create", help="Create project")
    sp.add_argument("name")

    sub.add_parser("projects", help="List projects")

    ss = sub.add_parser("suite-create", help="Create suite")
    ss.add_argument("project_id")
    ss.add_argument("name")

    s2 = sub.add_parser("suites", help="List suites")
    s2.add_argument("--project-id", default="")

    cp = sub.add_parser("case-create", help="Create a demo case")
    cp.add_argument("project_id")
    cp.add_argument("--suite-id", default="")
    cp.add_argument("--title", default="demo pass")
    cp.add_argument("--kind", default="http")
    cp.add_argument(
        "--spec",
        default='{"steps":[{"type":"pass","message":"demo pass"}]}',
        help="JSON string",
    )

    c2 = sub.add_parser("cases", help="List cases")
    c2.add_argument("--project-id", default="")
    c2.add_argument("--suite-id", default="")

    rp = sub.add_parser("run-create", help="Create + execute a run synchronously (CLI)")
    rp.add_argument("project_id")
    rp.add_argument("--suite-id", default="")
    rp.add_argument("--name", default="cli run")
    rp.add_argument("--case-id", action="append", default=[])

    r2 = sub.add_parser("runs", help="List runs")
    r2.add_argument("--project-id", default="")

    rv = sub.add_parser("run-show", help="Show run and items")
    rv.add_argument("run_id")

    rr = sub.add_parser("run-report", help="Write HTML report to file")
    rr.add_argument("run_id")
    rr.add_argument("--out", default="run_report.html")

    ai = sub.add_parser("ai-generate", help="Generate suggested cases from prompt (offline heuristic)")
    ai.add_argument("--prompt", required=True)

    args = ap.parse_args(argv)

    if args.cmd == "health":
        with db_conn() as con:
            con.execute("SELECT 1")
        _pp({"ok": True, "ts": utc_now_iso()})
        return 0

    if args.cmd == "project-create":
        with db_conn() as con:
            pid = new_id("prj")
            con.execute(
                "INSERT INTO projects(id,name,created_at) VALUES(?,?,?)",
                (pid, args.name, utc_now_iso()),
            )
            con.commit()
        _pp({"project_id": pid})
        return 0

    if args.cmd == "projects":
        with db_conn() as con:
            rows = con.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
        _pp({"projects": [row_to_dict(r) for r in rows]})
        return 0

    if args.cmd == "suite-create":
        with db_conn() as con:
            sid = new_id("sui")
            con.execute(
                "INSERT INTO suites(id,project_id,name,created_at) VALUES(?,?,?,?)",
                (sid, args.project_id, args.name, utc_now_iso()),
            )
            con.commit()
        _pp({"suite_id": sid})
        return 0

    if args.cmd == "suites":
        with db_conn() as con:
            if args.project_id:
                rows = con.execute(
                    "SELECT * FROM suites WHERE project_id=? ORDER BY created_at DESC",
                    (args.project_id,),
                ).fetchall()
            else:
                rows = con.execute("SELECT * FROM suites ORDER BY created_at DESC").fetchall()
        _pp({"suites": [row_to_dict(r) for r in rows]})
        return 0

    if args.cmd == "case-create":
        spec = json.loads(args.spec)
        with db_conn() as con:
            cid = new_id("case")
            now = utc_now_iso()
            con.execute(
                """
                INSERT INTO cases(id,project_id,suite_id,title,description,tags_json,kind,spec_json,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    cid,
                    args.project_id,
                    (args.suite_id or None) if args.suite_id else None,
                    args.title,
                    "",
                    "[]",
                    args.kind,
                    json.dumps(spec, ensure_ascii=True),
                    now,
                    now,
                ),
            )
            con.commit()
        _pp({"case_id": cid})
        return 0

    if args.cmd == "cases":
        with db_conn() as con:
            sql = "SELECT * FROM cases WHERE 1=1"
            xs: list[str] = []
            if args.project_id:
                sql += " AND project_id=?"
                xs.append(args.project_id)
            if args.suite_id:
                sql += " AND suite_id=?"
                xs.append(args.suite_id)
            sql += " ORDER BY updated_at DESC"
            rows = con.execute(sql, tuple(xs)).fetchall()
        out = []
        for r in rows:
            d = row_to_dict(r)
            d["tags"] = json_loads(d.get("tags_json") or "[]", [])
            d["spec"] = json_loads(d.get("spec_json") or "{}", {})
            out.append(d)
        _pp({"cases": out})
        return 0

    if args.cmd == "run-create":
        case_ids = [str(x) for x in (args.case_id or []) if str(x)]
        if not case_ids:
            raise SystemExit("missing --case-id (repeatable)")

        with db_conn() as con:
            rid = new_id("run")
            con.execute(
                """
                INSERT INTO runs(id,project_id,suite_id,name,status,created_at,started_at,finished_at,summary_json)
                VALUES(?,?,?,?,?,?,?,?,?)
                """,
                (
                    rid,
                    args.project_id,
                    (args.suite_id or None) if args.suite_id else None,
                    args.name,
                    "running",
                    utc_now_iso(),
                    utc_now_iso(),
                    None,
                    "{}",
                ),
            )
            for cid in case_ids:
                itid = new_id("ritem")
                con.execute(
                    "INSERT INTO run_items(id,run_id,case_id,status,duration_ms,log,data_json) VALUES(?,?,?,?,?,?,?)",
                    (itid, rid, cid, "queued", 0, "", "{}"),
                )
            con.commit()

            items = con.execute("SELECT * FROM run_items WHERE run_id=? ORDER BY id", (rid,)).fetchall()
            for it in items:
                case = con.execute("SELECT * FROM cases WHERE id=?", (it["case_id"],)).fetchone()
                if not case:
                    con.execute(
                        "UPDATE run_items SET status=?, log=? WHERE id=?",
                        ("failed", "case not found", it["id"]),
                    )
                    con.commit()
                    continue
                kind = str(case["kind"])
                spec = json_loads(str(case["spec_json"]), {})
                ok, msg, data, dur_ms = run_case(kind=kind, spec=spec)
                status = "passed" if ok else "failed"
                con.execute(
                    "UPDATE run_items SET status=?, duration_ms=?, log=?, data_json=? WHERE id=?",
                    (status, int(dur_ms), msg, json.dumps(data, ensure_ascii=True), it["id"]),
                )
                con.commit()

            items2 = [row_to_dict(r) for r in con.execute("SELECT * FROM run_items WHERE run_id=?", (rid,))]
            summary = summarize_run(items2)
            analysis = analyze_failures(items2)
            con.execute(
                "UPDATE runs SET status=?, finished_at=?, summary_json=? WHERE id=?",
                ("finished", utc_now_iso(), json.dumps({**summary, **analysis}, ensure_ascii=True), rid),
            )
            con.commit()

        _pp({"run_id": rid})
        return 0

    if args.cmd == "runs":
        with db_conn() as con:
            if args.project_id:
                rows = con.execute(
                    "SELECT * FROM runs WHERE project_id=? ORDER BY created_at DESC",
                    (args.project_id,),
                ).fetchall()
            else:
                rows = con.execute("SELECT * FROM runs ORDER BY created_at DESC").fetchall()
        out = []
        for r in rows:
            d = row_to_dict(r)
            d["summary"] = json_loads(d.get("summary_json") or "{}", {})
            out.append(d)
        _pp({"runs": out})
        return 0

    if args.cmd == "run-show":
        with db_conn() as con:
            run_d, items_d = _get_run(con, args.run_id)
        _pp({"run": run_d, "items": items_d})
        return 0

    if args.cmd == "run-report":
        with db_conn() as con:
            run_d, items_d = _get_run(con, args.run_id)
        html = render_run_report(run_d, items_d)
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(html)
        _pp({"ok": True, "out": args.out})
        return 0

    if args.cmd == "ai-generate":
        ss, provider, warning = generate_cases(args.prompt)
        _pp(
            {
                "provider": provider,
                "warning": warning,
                "suggestions": [
                    {"title": s.title, "description": s.description, "tags": s.tags, "kind": s.kind, "spec": s.spec}
                    for s in ss
                ]
            }
        )
        return 0

    raise SystemExit("unknown command")
