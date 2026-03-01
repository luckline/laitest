from __future__ import annotations

import json
import mimetypes
import os
import threading
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .ai import ai_runtime_status, generate_cases, professional_case_from_suggested
from .db import db_conn, json_loads, row_to_dict, utc_now_iso
from .ids import new_id
from .runner import analyze_failures, run_case, summarize_run


def _static_dir() -> Path:
    pkg_static = Path(__file__).resolve().parent / "static"
    if pkg_static.exists():
        return pkg_static
    # Backward compatible layout: static files placed at repository root.
    return Path(__file__).resolve().parent.parent


def _read_json(req: BaseHTTPRequestHandler) -> dict:
    n = int(req.headers.get("Content-Length", "0") or "0")
    if n <= 0:
        return {}
    raw = req.rfile.read(n)
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def _send_json(req: BaseHTTPRequestHandler, code: int, payload: object) -> None:
    raw = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    req.send_response(code)
    req.send_header("Content-Type", "application/json; charset=utf-8")
    req.send_header("Content-Length", str(len(raw)))
    req.end_headers()
    req.wfile.write(raw)


def _send_text(req: BaseHTTPRequestHandler, code: int, text: str, content_type: str) -> None:
    raw = text.encode("utf-8")
    req.send_response(code)
    req.send_header("Content-Type", content_type)
    req.send_header("Content-Length", str(len(raw)))
    req.end_headers()
    req.wfile.write(raw)


def _send_file(req: BaseHTTPRequestHandler, path: Path) -> None:
    if not path.exists() or not path.is_file():
        _send_text(req, 404, "not found", "text/plain; charset=utf-8")
        return
    data = path.read_bytes()
    ctype, _ = mimetypes.guess_type(str(path))
    if not ctype:
        ctype = "application/octet-stream"
    req.send_response(200)
    req.send_header("Content-Type", f"{ctype}; charset=utf-8" if ctype.startswith("text/") else ctype)
    req.send_header("Content-Length", str(len(data)))
    req.end_headers()
    req.wfile.write(data)


def _require_token(req: BaseHTTPRequestHandler) -> bool:
    token = os.environ.get("LAITEST_TOKEN", "").strip()
    if not token:
        return True
    auth = req.headers.get("Authorization", "")
    return auth == f"Bearer {token}"


class _RunWorker:
    def __init__(self) -> None:
        self._q: list[str] = []
        self._cv = threading.Condition()
        self._t = threading.Thread(target=self._loop, name="laitest-runner", daemon=True)
        self._t.start()

    def enqueue(self, run_id: str) -> None:
        with self._cv:
            self._q.append(run_id)
            self._cv.notify()

    def _loop(self) -> None:
        while True:
            with self._cv:
                while not self._q:
                    self._cv.wait()
                run_id = self._q.pop(0)
            try:
                self._execute(run_id)
            except Exception:
                # Best-effort: mark failed.
                with db_conn() as con:
                    con.execute(
                        "UPDATE runs SET status=?, finished_at=? WHERE id=?",
                        ("failed", utc_now_iso(), run_id),
                    )
                    con.commit()

    def _execute(self, run_id: str) -> None:
        with db_conn() as con:
            run = con.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
            if not run:
                return
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


_RUN_WORKER = _RunWorker()


class Handler(BaseHTTPRequestHandler):
    server_version = "laitest/0.1"

    def log_message(self, fmt: str, *args) -> None:
        # Keep console noise low for the MVP.
        return

    def _err(self, code: int, message: str) -> None:
        _send_json(self, code, {"error": message})

    def do_GET(self) -> None:  # noqa: N802
        try:
            self._do_GET()
        except Exception as e:
            tb = traceback.format_exc(limit=20)
            _send_json(self, 500, {"error": f"{e.__class__.__name__}: {e}", "trace": tb})

    def _do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        sdir = _static_dir()

        if path.startswith("/api/"):
            if not _require_token(self):
                self._err(401, "unauthorized")
                return
            self._api_get(path, parse_qs(parsed.query))
            return

        if path in ("/", "/index.html"):
            _send_file(self, sdir / "index.html")
            return
        if path in ("/app", "/app.html"):
            _send_file(self, sdir / "app.html")
            return
        if path.startswith("/static/"):
            rel = path.removeprefix("/static/").lstrip("/")
            p = (sdir / rel).resolve()
            if sdir not in p.parents and p != sdir:
                _send_text(self, 400, "bad path", "text/plain; charset=utf-8")
                return
            _send_file(self, p)
            return

        # Direct static fallback, e.g. /app.js, /css/styles.css, /favicon.ico
        rel2 = path.lstrip("/")
        if rel2:
            p2 = (sdir / rel2).resolve()
            if sdir in p2.parents and p2.is_file():
                _send_file(self, p2)
                return

        _send_text(self, 404, "not found", "text/plain; charset=utf-8")

    def do_POST(self) -> None:  # noqa: N802
        try:
            self._do_POST()
        except Exception as e:
            tb = traceback.format_exc(limit=20)
            _send_json(self, 500, {"error": f"{e.__class__.__name__}: {e}", "trace": tb})

    def _do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if not path.startswith("/api/"):
            self._err(404, "not found")
            return
        if not _require_token(self):
            self._err(401, "unauthorized")
            return

        body = _read_json(self)
        self._api_post(path, body)

    def do_PUT(self) -> None:  # noqa: N802
        try:
            self._do_PUT()
        except Exception as e:
            tb = traceback.format_exc(limit=20)
            _send_json(self, 500, {"error": f"{e.__class__.__name__}: {e}", "trace": tb})

    def _do_PUT(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if not path.startswith("/api/"):
            self._err(404, "not found")
            return
        if not _require_token(self):
            self._err(401, "unauthorized")
            return

        body = _read_json(self)
        self._api_put(path, body)

    def do_DELETE(self) -> None:  # noqa: N802
        try:
            self._do_DELETE()
        except Exception as e:
            tb = traceback.format_exc(limit=20)
            _send_json(self, 500, {"error": f"{e.__class__.__name__}: {e}", "trace": tb})

    def _do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if not path.startswith("/api/"):
            self._err(404, "not found")
            return
        if not _require_token(self):
            self._err(401, "unauthorized")
            return

        self._api_delete(path)

    def _api_get(self, path: str, q: dict) -> None:
        if path == "/api/health":
            _send_json(self, 200, {"ok": True, "ts": utc_now_iso()})
            return

        with db_conn() as con:
            if path == "/api/projects":
                rows = con.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
                _send_json(self, 200, {"projects": [row_to_dict(r) for r in rows]})
                return

            if path == "/api/suites":
                project_id = (q.get("project_id") or [""])[0]
                if project_id:
                    rows = con.execute(
                        "SELECT * FROM suites WHERE project_id=? ORDER BY created_at DESC",
                        (project_id,),
                    ).fetchall()
                else:
                    rows = con.execute("SELECT * FROM suites ORDER BY created_at DESC").fetchall()
                _send_json(self, 200, {"suites": [row_to_dict(r) for r in rows]})
                return

            if path == "/api/cases":
                project_id = (q.get("project_id") or [""])[0]
                suite_id = (q.get("suite_id") or [""])[0]
                sql = "SELECT * FROM cases WHERE 1=1"
                args: list[str] = []
                if project_id:
                    sql += " AND project_id=?"
                    args.append(project_id)
                if suite_id:
                    sql += " AND suite_id=?"
                    args.append(suite_id)
                sql += " ORDER BY updated_at DESC"
                rows = con.execute(sql, tuple(args)).fetchall()
                out = []
                for r in rows:
                    d = row_to_dict(r)
                    d["tags"] = json_loads(d.get("tags_json") or "[]", [])
                    d["spec"] = json_loads(d.get("spec_json") or "{}", {})
                    out.append(d)
                _send_json(self, 200, {"cases": out})
                return

            if path == "/api/runs":
                project_id = (q.get("project_id") or [""])[0]
                suite_id = (q.get("suite_id") or [""])[0]
                sql = "SELECT * FROM runs WHERE 1=1"
                args2: list[str] = []
                if project_id:
                    sql += " AND project_id=?"
                    args2.append(project_id)
                if suite_id:
                    sql += " AND suite_id=?"
                    args2.append(suite_id)
                sql += " ORDER BY created_at DESC"
                rows = con.execute(sql, tuple(args2)).fetchall()
                out = []
                for r in rows:
                    d = row_to_dict(r)
                    d["summary"] = json_loads(d.get("summary_json") or "{}", {})
                    out.append(d)
                _send_json(self, 200, {"runs": out})
                return

            if path.startswith("/api/run/"):
                run_id = path.removeprefix("/api/run/").strip("/")
                run = con.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
                if not run:
                    self._err(404, "run not found")
                    return
                items = con.execute(
                    "SELECT * FROM run_items WHERE run_id=? ORDER BY id",
                    (run_id,),
                ).fetchall()
                run_d = row_to_dict(run)
                run_d["summary"] = json_loads(run_d.get("summary_json") or "{}", {})
                out_items = []
                for it in items:
                    d = row_to_dict(it)
                    d["data"] = json_loads(d.get("data_json") or "{}", {})
                    out_items.append(d)
                _send_json(self, 200, {"run": run_d, "items": out_items})
                return

        self._err(404, "not found")

    def _api_post(self, path: str, body: dict) -> None:
        with db_conn() as con:
            if path == "/api/projects":
                name = str(body.get("name") or "").strip()
                if not name:
                    self._err(400, "missing name")
                    return
                pid = new_id("prj")
                con.execute(
                    "INSERT INTO projects(id,name,created_at) VALUES(?,?,?)",
                    (pid, name, utc_now_iso()),
                )
                con.commit()
                _send_json(self, 201, {"project": {"id": pid, "name": name}})
                return

            if path == "/api/suites":
                project_id = str(body.get("project_id") or "").strip()
                name = str(body.get("name") or "").strip()
                if not project_id or not name:
                    self._err(400, "missing project_id or name")
                    return
                sid = new_id("sui")
                con.execute(
                    "INSERT INTO suites(id,project_id,name,created_at) VALUES(?,?,?,?)",
                    (sid, project_id, name, utc_now_iso()),
                )
                con.commit()
                _send_json(self, 201, {"suite": {"id": sid, "project_id": project_id, "name": name}})
                return

            if path == "/api/cases":
                project_id = str(body.get("project_id") or "").strip()
                title = str(body.get("title") or "").strip()
                if not project_id or not title:
                    self._err(400, "missing project_id or title")
                    return
                suite_id = str(body.get("suite_id") or "").strip() or None
                description = str(body.get("description") or "")
                tags = body.get("tags") or []
                if not isinstance(tags, list):
                    tags = []
                kind = str(body.get("kind") or "http")
                spec = body.get("spec") or {}
                if not isinstance(spec, dict):
                    spec = {}

                cid = new_id("case")
                now = utc_now_iso()
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
                _send_json(self, 201, {"case": {"id": cid}})
                return

            if path == "/api/runs":
                project_id = str(body.get("project_id") or "").strip()
                if not project_id:
                    self._err(400, "missing project_id")
                    return
                suite_id = str(body.get("suite_id") or "").strip() or None
                name = str(body.get("name") or "Run").strip() or "Run"
                case_ids = body.get("case_ids") or []
                if not isinstance(case_ids, list):
                    case_ids = []
                case_ids = [str(x) for x in case_ids if str(x)]
                if not case_ids:
                    self._err(400, "missing case_ids")
                    return

                rid = new_id("run")
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
                _RUN_WORKER.enqueue(rid)
                _send_json(self, 201, {"run": {"id": rid, "status": "queued"}})
                return

            if path == "/api/ai/generate_cases":
                prompt = str(body.get("prompt") or "")
                model_provider = str(body.get("model_provider") or "").strip().lower() or None
                project_id = str(body.get("project_id") or "").strip()
                suite_id = str(body.get("suite_id") or "").strip() or None

                suggestions, provider, warning = generate_cases(prompt, model_provider=model_provider)
                runtime = ai_runtime_status()
                default_mode = runtime.get("mode")
                runtime["default_mode"] = default_mode
                runtime["mode"] = provider if model_provider else default_mode
                runtime["active_provider"] = provider
                # Option: auto-create in DB when asked.
                create = bool(body.get("create"))
                created_ids: list[str] = []
                if create and project_id:
                    now = utc_now_iso()
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
                _send_json(
                    self,
                    200,
                    {
                        "suggestions": [
                            {
                                "title": s.title,
                                "description": s.description,
                                "tags": s.tags,
                                "kind": s.kind,
                                "spec": s.spec,
                                "test_case": professional_case_from_suggested(s),
                            }
                            for s in suggestions
                        ],
                        "provider": provider,
                        "requested_provider": model_provider,
                        "warning": warning,
                        "runtime": runtime,
                        "created_case_ids": created_ids,
                    },
                )
                return

        self._err(404, "not found")

    def _api_put(self, path: str, body: dict) -> None:
        with db_conn() as con:
            if path.startswith("/api/case/"):
                case_id = path.removeprefix("/api/case/").strip("/")
                row = con.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone()
                if not row:
                    self._err(404, "case not found")
                    return

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
                _send_json(self, 200, {"ok": True})
                return

        self._err(404, "not found")

    def _api_delete(self, path: str) -> None:
        with db_conn() as con:
            if path.startswith("/api/project/"):
                pid = path.removeprefix("/api/project/").strip("/")
                con.execute("DELETE FROM projects WHERE id=?", (pid,))
                con.commit()
                _send_json(self, 200, {"ok": True})
                return

            if path.startswith("/api/suite/"):
                sid = path.removeprefix("/api/suite/").strip("/")
                con.execute("DELETE FROM suites WHERE id=?", (sid,))
                con.commit()
                _send_json(self, 200, {"ok": True})
                return

            if path.startswith("/api/case/"):
                cid = path.removeprefix("/api/case/").strip("/")
                con.execute("DELETE FROM cases WHERE id=?", (cid,))
                con.commit()
                _send_json(self, 200, {"ok": True})
                return

        self._err(404, "not found")


def serve(host: str, port: int) -> None:
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"laitest listening on http://{host}:{port}/")  # noqa: T201
    httpd.serve_forever()
