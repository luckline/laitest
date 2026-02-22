from __future__ import annotations

import json
import time
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass
class StepResult:
    ok: bool
    message: str
    data: dict[str, Any]


def _http_get(url: str, timeout_s: float) -> tuple[int, bytes]:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:  # nosec - MVP
        return int(resp.status), resp.read()


def run_case(kind: str, spec: dict[str, Any]) -> tuple[bool, str, dict[str, Any], int]:
    started = time.time()
    steps = spec.get("steps", [])
    if not isinstance(steps, list):
        steps = []

    if kind not in ("http", "demo"):
        return False, f"unsupported kind: {kind}", {}, int((time.time() - started) * 1000)

    logs: list[str] = []
    meta: dict[str, Any] = {"steps": []}

    for i, step in enumerate(steps):
        if not isinstance(step, dict):
            meta["steps"].append({"i": i, "ok": False, "message": "invalid step"})
            return False, "invalid step", meta, int((time.time() - started) * 1000)

        stype = step.get("type")
        if stype == "pass":
            msg = str(step.get("message") or "pass")
            meta["steps"].append({"i": i, "ok": True, "type": stype, "message": msg})
            continue

        if stype == "sleep":
            try:
                sec = float(step.get("seconds", 0.0))
            except Exception:
                sec = 0.0
            if sec < 0:
                sec = 0.0
            time.sleep(sec)
            meta["steps"].append({"i": i, "ok": True, "type": stype, "seconds": sec})
            continue

        if stype == "http_get":
            if kind != "http":
                msg = "http_get step requires kind=http"
                meta["steps"].append({"i": i, "ok": False, "type": stype, "message": msg})
                return False, msg, meta, int((time.time() - started) * 1000)

            url = str(step.get("url", ""))
            expect_status = int(step.get("expect_status", 200))
            expect_contains = step.get("expect_contains")
            timeout_s = float(step.get("timeout_s", 10))

            if not url:
                meta["steps"].append({"i": i, "ok": False, "message": "missing url"})
                return False, "missing url", meta, int((time.time() - started) * 1000)

            try:
                status, body = _http_get(url, timeout_s=timeout_s)
            except Exception as e:
                msg = f"http_get failed: {e.__class__.__name__}: {e}"
                logs.append(msg)
                meta["steps"].append({"i": i, "ok": False, "type": stype, "url": url, "message": msg})
                return False, msg, meta, int((time.time() - started) * 1000)

            if status != expect_status:
                msg = f"expected status {expect_status}, got {status}"
                logs.append(msg)
                meta["steps"].append(
                    {
                        "i": i,
                        "ok": False,
                        "type": stype,
                        "url": url,
                        "status": status,
                        "expect_status": expect_status,
                        "message": msg,
                    }
                )
                return False, msg, meta, int((time.time() - started) * 1000)

            if expect_contains is not None:
                try:
                    text = body.decode("utf-8", errors="replace")
                except Exception:
                    text = ""
                if str(expect_contains) not in text:
                    msg = "response body missing expected substring"
                    logs.append(msg)
                    meta["steps"].append(
                        {
                            "i": i,
                            "ok": False,
                            "type": stype,
                            "url": url,
                            "status": status,
                            "expect_contains": str(expect_contains),
                            "message": msg,
                        }
                    )
                    return False, msg, meta, int((time.time() - started) * 1000)

            meta["steps"].append({"i": i, "ok": True, "type": stype, "url": url, "status": status})
            continue

        msg = f"unsupported step type: {stype}"
        logs.append(msg)
        meta["steps"].append({"i": i, "ok": False, "type": stype, "message": msg})
        return False, msg, meta, int((time.time() - started) * 1000)

    duration_ms = int((time.time() - started) * 1000)
    return True, "ok", meta, duration_ms


def summarize_run(items: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(items)
    passed = sum(1 for it in items if it.get("status") == "passed")
    failed = sum(1 for it in items if it.get("status") == "failed")
    return {"total": total, "passed": passed, "failed": failed}


def analyze_failures(items: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Offline "smart" analysis: cluster by top-level error messages.
    """
    buckets: dict[str, int] = {}
    examples: dict[str, dict[str, Any]] = {}

    for it in items:
        if it.get("status") != "failed":
            continue
        log = str(it.get("log") or "")
        key = log.strip().splitlines()[0] if log.strip() else "unknown"
        buckets[key] = buckets.get(key, 0) + 1
        if key not in examples:
            examples[key] = {"case_id": it.get("case_id"), "log": log[:4000]}

    top = sorted(buckets.items(), key=lambda kv: kv[1], reverse=True)[:10]
    return {
        "failed_clusters": [
            {"message": msg, "count": cnt, "example": examples.get(msg, {})} for msg, cnt in top
        ]
    }
