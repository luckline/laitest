from __future__ import annotations

import json
import os
import traceback
from typing import Any

from flask import Flask, jsonify, request

from laitest.ai import generate_cases
from laitest.db import db_conn, json_loads, row_to_dict, utc_now_iso
from laitest.ids import new_id
from laitest.runner import analyze_failures, run_case, summarize_run

app = Flask(__name__)


def _require_token() -> tuple[bool, tuple[Any, int] | None]:
    token = os.environ.get("LAITEST_TOKEN", "").strip()
    if not token:
        return True, None
    auth = request.headers.get("Authorization", "")
    if auth == f"Bearer {token}":
        return True, None
    return False, (jsonify({"error": "unauthorized"}), 401)


def _body() -> dict[str, Any]:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _execute_run(run_id: str) -> str:
    try:
        with db_conn() as con:
            run = con.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
            if not run:
                return "failed"

            con.execute(
                "UPDATE runs SET status=?, started_at=? WHERE id=?",
                ("running", utc_now_iso(), run_id),
            )
            con.commit()

            items = con.execute("SELECT * FROM run_items WHERE run_id=?", (run_id,)).fetchall()
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

            items2 = [row_to_dict(r) for r in con.execute("SELECT * FROM run_items WHERE run_id=?", (run_id,))]
            summary = summarize_run(items2)
            analysis = analyze_failures(items2)
            con.execute(
                "UPDATE runs SET status=?, finished_at=?, summary_json=? WHERE id=?",
                ("finished", utc_now_iso(), json.dumps({**summary, **analysis}, ensure_ascii=True), run_id),
            )
            con.commit()
            return "finished"
    except Exception:
        with db_conn() as con:
            con.execute(
                "UPDATE runs SET status=?, finished_at=? WHERE id=?",
                ("failed", utc_now_iso(), run_id),
            )
            con.commit()
        return "failed"


@app.before_request
def _auth_guard() -> tuple[Any, int] | None:
    if not request.path.startswith("/api/"):
        return None
    ok, err = _require_token()
    if ok:
        return None
    return err


@app.get("/api/")
def api_home() -> Any:
    return jsonify({"ok": True, "name": "laitest api"})


@app.get("/api/health")
def health() -> Any:
    return jsonify({"ok": True, "ts": utc_now_iso()})


@app.get("/api/projects")
def get_projects() -> Any:
    with db_conn() as con:
        rows = con.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
        return jsonify({"projects": [row_to_dict(r) for r in rows]})


@app.post("/api/projects")
def post_projects() -> tuple[Any, int] | Any:
    body = _body()
    name = str(body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "missing name"}), 400

    pid = new_id("prj")
    with db_conn() as con:
        con.execute(
            "INSERT INTO projects(id,name,created_at) VALUES(?,?,?)",
            (pid, name, utc_now_iso()),
        )
        con.commit()
    return jsonify({"project": {"id": pid, "name": name}}), 201


@app.delete("/api/project/<project_id>")
def del_project(project_id: str) -> Any:
    with db_conn() as con:
        con.execute("DELETE FROM projects WHERE id=?", (project_id,))
        con.commit()
    return jsonify({"ok": True})


@app.get("/api/suites")
def get_suites() -> Any:
    project_id = request.args.get("project_id", "").strip()
    with db_conn() as con:
        if project_id:
            rows = con.execute(
                "SELECT * FROM suites WHERE project_id=? ORDER BY created_at DESC",
                (project_id,),
            ).fetchall()
        else:
            rows = con.execute("SELECT * FROM suites ORDER BY created_at DESC").fetchall()
    return jsonify({"suites": [row_to_dict(r) for r in rows]})


@app.post("/api/suites")
def post_suites() -> tuple[Any, int] | Any:
    body = _body()
    project_id = str(body.get("project_id") or "").strip()
    name = str(body.get("name") or "").strip()
    if not project_id or not name:
        return jsonify({"error": "missing project_id or name"}), 400

    sid = new_id("sui")
    with db_conn() as con:
        con.execute(
            "INSERT INTO suites(id,project_id,name,created_at) VALUES(?,?,?,?)",
            (sid, project_id, name, utc_now_iso()),
        )
        con.commit()
    return jsonify({"suite": {"id": sid, "project_id": project_id, "name": name}}), 201


@app.delete("/api/suite/<suite_id>")
def del_suite(suite_id: str) -> Any:
    with db_conn() as con:
        con.execute("DELETE FROM suites WHERE id=?", (suite_id,))
        con.commit()
    return jsonify({"ok": True})


@app.get("/api/cases")
def get_cases() -> Any:
    project_id = request.args.get("project_id", "").strip()
    suite_id = request.args.get("suite_id", "").strip()
    sql = "SELECT * FROM cases WHERE 1=1"
    args: list[str] = []
    if project_id:
        sql += " AND project_id=?"
        args.append(project_id)
    if suite_id:
        sql += " AND suite_id=?"
        args.append(suite_id)
    sql += " ORDER BY updated_at DESC"

    with db_conn() as con:
        rows = con.execute(sql, tuple(args)).fetchall()

    out = []
    for r in rows:
        d = row_to_dict(r)
        d["tags"] = json_loads(d.get("tags_json") or "[]", [])
        d["spec"] = json_loads(d.get("spec_json") or "{}", {})
        out.append(d)
    return jsonify({"cases": out})


@app.post("/api/cases")
def post_cases() -> tuple[Any, int] | Any:
    body = _body()
    project_id = str(body.get("project_id") or "").strip()
    title = str(body.get("title") or "").strip()
    if not project_id or not title:
        return jsonify({"error": "missing project_id or title"}), 400

    suite_id = str(body.get("suite_id") or "").strip() or None
    description = str(body.get("description") or "")
    tags = body.get("tags") if isinstance(body.get("tags"), list) else []
    kind = str(body.get("kind") or "http")
    spec = body.get("spec") if isinstance(body.get("spec"), dict) else {}

    cid = new_id("case")
    now = utc_now_iso()
    with db_conn() as con:
        con.execute(
            """
            INSERT INTO cases(id,project_id,suite_id,title,description,tags_json,kind,spec_json,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)
            """,
            (
                cid,
                project_id,
                suite_id,
                title,
                description,
                json.dumps(tags, ensure_ascii=True),
                kind,
                json.dumps(spec, ensure_ascii=True),
                now,
                now,
            ),
        )
        con.commit()
    return jsonify({"case": {"id": cid}}), 201


@app.put("/api/case/<case_id>")
def put_case(case_id: str) -> Any:
    body = _body()
    with db_conn() as con:
        row = con.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone()
        if not row:
            return jsonify({"error": "case not found"}), 404

        title = str(body.get("title") or row["title"]).strip()
        description = str(body.get("description") or row["description"])
        tags = body.get("tags")
        if tags is None:
            tags = json_loads(str(row["tags_json"]), [])
        if not isinstance(tags, list):
            tags = []
        kind = str(body.get("kind") or row["kind"])
        spec = body.get("spec")
        if spec is None:
            spec = json_loads(str(row["spec_json"]), {})
        if not isinstance(spec, dict):
            spec = {}
        suite_id = body.get("suite_id")
        if suite_id is None:
            suite_id = row["suite_id"]
        suite_id = (str(suite_id).strip() if suite_id is not None else None) or None

        con.execute(
            """
            UPDATE cases
            SET suite_id=?, title=?, description=?, tags_json=?, kind=?, spec_json=?, updated_at=?
            WHERE id=?
            """,
            (
                suite_id,
                title,
                description,
                json.dumps(tags, ensure_ascii=True),
                kind,
                json.dumps(spec, ensure_ascii=True),
                utc_now_iso(),
                case_id,
            ),
        )
        con.commit()
    return jsonify({"ok": True})


@app.delete("/api/case/<case_id>")
def del_case(case_id: str) -> Any:
    with db_conn() as con:
        con.execute("DELETE FROM cases WHERE id=?", (case_id,))
        con.commit()
    return jsonify({"ok": True})


@app.get("/api/runs")
def get_runs() -> Any:
    project_id = request.args.get("project_id", "").strip()
    suite_id = request.args.get("suite_id", "").strip()
    sql = "SELECT * FROM runs WHERE 1=1"
    args: list[str] = []
    if project_id:
        sql += " AND project_id=?"
        args.append(project_id)
    if suite_id:
        sql += " AND suite_id=?"
        args.append(suite_id)
    sql += " ORDER BY created_at DESC"

    with db_conn() as con:
        rows = con.execute(sql, tuple(args)).fetchall()

    out = []
    for r in rows:
        d = row_to_dict(r)
        d["summary"] = json_loads(d.get("summary_json") or "{}", {})
        out.append(d)
    return jsonify({"runs": out})


@app.get("/api/run/<run_id>")
def get_run(run_id: str) -> tuple[Any, int] | Any:
    with db_conn() as con:
        run = con.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        if not run:
            return jsonify({"error": "run not found"}), 404
        items = con.execute("SELECT * FROM run_items WHERE run_id=? ORDER BY id", (run_id,)).fetchall()

    run_d = row_to_dict(run)
    run_d["summary"] = json_loads(run_d.get("summary_json") or "{}", {})
    out_items = []
    for it in items:
        d = row_to_dict(it)
        d["data"] = json_loads(d.get("data_json") or "{}", {})
        out_items.append(d)
    return jsonify({"run": run_d, "items": out_items})


@app.post("/api/runs")
def post_runs() -> tuple[Any, int] | Any:
    body = _body()
    project_id = str(body.get("project_id") or "").strip()
    if not project_id:
        return jsonify({"error": "missing project_id"}), 400

    suite_id = str(body.get("suite_id") or "").strip() or None
    name = str(body.get("name") or "Run").strip() or "Run"
    raw_case_ids = body.get("case_ids") if isinstance(body.get("case_ids"), list) else []
    case_ids = [str(x) for x in raw_case_ids if str(x)]
    if not case_ids:
        return jsonify({"error": "missing case_ids"}), 400

    rid = new_id("run")
    with db_conn() as con:
        con.execute(
            """
            INSERT INTO runs(id,project_id,suite_id,name,status,created_at,started_at,finished_at,summary_json)
            VALUES(?,?,?,?,?,?,?,?,?)
            """,
            (rid, project_id, suite_id, name, "queued", utc_now_iso(), None, None, "{}"),
        )
        for cid in case_ids:
            itid = new_id("ritem")
            con.execute(
                """
                INSERT INTO run_items(id,run_id,case_id,status,duration_ms,log,data_json)
                VALUES(?,?,?,?,?,?,?)
                """,
                (itid, rid, cid, "queued", 0, "", "{}"),
            )
        con.commit()

    final_status = _execute_run(rid)
    return jsonify({"run": {"id": rid, "status": final_status}}), 201


@app.post("/api/ai/generate_cases")
def post_ai_generate_cases() -> Any:
    body = _body()
    prompt = str(body.get("prompt") or "")
    project_id = str(body.get("project_id") or "").strip()
    suite_id = str(body.get("suite_id") or "").strip() or None
    create = bool(body.get("create"))

    suggestions, provider, warning = generate_cases(prompt)
    created_ids: list[str] = []
    if create and project_id:
        now = utc_now_iso()
        with db_conn() as con:
            for s in suggestions[:30]:
                cid = new_id("case")
                con.execute(
                    """
                    INSERT INTO cases(id,project_id,suite_id,title,description,tags_json,kind,spec_json,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        cid,
                        project_id,
                        suite_id,
                        s.title,
                        s.description,
                        json.dumps(s.tags, ensure_ascii=True),
                        s.kind,
                        json.dumps(s.spec, ensure_ascii=True),
                        now,
                        now,
                    ),
                )
                created_ids.append(cid)
            con.commit()

    return jsonify(
        {
            "suggestions": [
                {
                    "title": s.title,
                    "description": s.description,
                    "tags": s.tags,
                    "kind": s.kind,
                    "spec": s.spec,
                }
                for s in suggestions
            ],
            "provider": provider,
            "warning": warning,
            "created_case_ids": created_ids,
        }
    )


@app.get("/api/test")
def test() -> Any:
    return jsonify({"status": "success", "message": "Flask is running on laitest.tech"})


@app.errorhandler(404)
def _not_found(_: Exception) -> tuple[Any, int]:
    if request.path.startswith("/api/"):
        return jsonify({"error": "not found"}), 404
    return jsonify({"error": "not found"}), 404


@app.errorhandler(Exception)
def _handle_error(e: Exception) -> tuple[Any, int]:
    tb = traceback.format_exc(limit=20)
    return jsonify({"error": f"{e.__class__.__name__}: {e}", "trace": tb}), 500
