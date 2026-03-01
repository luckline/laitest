from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from typing import Any
from urllib import error, request


@dataclass(frozen=True)
class SuggestedCase:
    title: str
    description: str
    tags: list[str]
    kind: str
    spec: dict[str, Any]


_ALLOWED_PRIORITIES = {"P0", "P1", "P2", "P3"}
_ALLOWED_TYPES = {
    "functional",
    "boundary",
    "negative",
    "security",
    "performance",
    "compatibility",
    "api",
}


def _clean_text(value: Any, default: str = "", max_len: int = 300) -> str:
    s = str(value or "").strip()
    if not s:
        return default
    return s[:max_len]


def _clean_list_str(value: Any, default: list[str] | None = None, max_items: int = 20) -> list[str]:
    if not isinstance(value, list):
        return list(default or [])
    out: list[str] = []
    for row in value[:max_items]:
        text = _clean_text(row, "")
        if text:
            out.append(text)
    return out or list(default or [])


def _normalize_priority(value: Any) -> str:
    p = _clean_text(value, "P1", 8).upper()
    if p in _ALLOWED_PRIORITIES:
        return p
    return "P1"


def _normalize_case_type(value: Any) -> str:
    t = _clean_text(value, "functional", 40).lower()
    if t in _ALLOWED_TYPES:
        return t
    return "functional"


def _slug_token(text: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").upper()
    return slug or "CASE"


def _make_case_id(title: str) -> str:
    token = _slug_token(title)[:20]
    digest = hashlib.sha1(title.encode("utf-8", errors="ignore")).hexdigest()[:6].upper()
    return f"TC-{token}-{digest}"


def _normalize_professional_steps(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []

    out: list[dict[str, Any]] = []
    for i, row in enumerate(raw[:20]):
        if isinstance(row, dict):
            action = _clean_text(row.get("action") or row.get("step") or row.get("description"), "")
            test_data = _clean_text(row.get("test_data") or row.get("data"), "")
            expected = _clean_text(row.get("expected_result") or row.get("expected"), "")
            try:
                step_no = int(row.get("step_no") or row.get("no") or (i + 1))
            except Exception:
                step_no = i + 1
        else:
            action = _clean_text(row, "")
            test_data = ""
            expected = ""
            step_no = i + 1

        if not action:
            continue

        out.append(
            {
                "step_no": step_no,
                "action": action,
                "test_data": test_data,
                "expected_result": expected,
            }
        )

    return out


def _fallback_professional_steps(title: str, expected_result: str) -> list[dict[str, Any]]:
    return [
        {
            "step_no": 1,
            "action": "Prepare test data and preconditions",
            "test_data": "According to requirement",
            "expected_result": "Environment and test data are ready",
        },
        {
            "step_no": 2,
            "action": title,
            "test_data": "Input based on requirement",
            "expected_result": "System processes request",
        },
        {
            "step_no": 3,
            "action": "Observe response and state changes",
            "test_data": "N/A",
            "expected_result": expected_result,
        },
    ]


def _to_execution_steps(pro_case: dict[str, Any]) -> list[dict[str, Any]]:
    steps = pro_case.get("steps")
    if not isinstance(steps, list):
        steps = []

    out: list[dict[str, Any]] = []
    for row in steps[:10]:
        if not isinstance(row, dict):
            continue
        no = row.get("step_no")
        action = _clean_text(row.get("action"), "")
        expected = _clean_text(row.get("expected_result"), "")
        if not action:
            continue
        msg = f"step {no}: {action}" if no is not None else action
        if expected:
            msg += f" | expect: {expected}"
        out.append({"type": "pass", "message": msg[:240]})

    if out:
        return out
    return [{"type": "pass", "message": "generated from requirement"}]


def _normalize_professional_case(obj: dict[str, Any], title: str, tags: list[str]) -> dict[str, Any]:
    module = _clean_text(obj.get("module"), "general", 80)
    priority = _normalize_priority(obj.get("priority"))
    case_type = _normalize_case_type(obj.get("type"))
    preconditions = _clean_list_str(
        obj.get("preconditions"),
        default=["System under test is reachable", "Required test account/data is available"],
        max_items=10,
    )

    expected_result = _clean_text(
        obj.get("expected_result"),
        default="System behavior matches expected outcome.",
        max_len=400,
    )

    steps = _normalize_professional_steps(obj.get("steps"))
    if not steps:
        steps = _fallback_professional_steps(title=title, expected_result=expected_result)

    case_id = _clean_text(obj.get("case_id"), "", 80)
    if not case_id:
        case_id = _make_case_id(title)

    automation_candidate = bool(obj.get("automation_candidate", True))

    return {
        "case_id": case_id,
        "module": module,
        "title": title,
        "priority": priority,
        "type": case_type,
        "preconditions": preconditions,
        "steps": steps,
        "expected_result": expected_result,
        "tags": tags,
        "automation_candidate": automation_candidate,
    }


def _normalize_case(obj: dict[str, Any]) -> SuggestedCase | None:
    title = _clean_text(obj.get("title"), "")
    if not title:
        return None

    description = _clean_text(obj.get("description"), "(auto) generated from prompt", 500)
    tags = _clean_list_str(obj.get("tags"), default=[], max_items=12)

    automation = obj.get("automation")
    raw_spec: Any = None
    kind = "demo"
    if isinstance(automation, dict):
        kind = _clean_text(automation.get("kind"), "demo", 20).lower()
        raw_spec = automation.get("spec")
    else:
        kind = _clean_text(obj.get("kind"), "demo", 20).lower()
        raw_spec = obj.get("spec")
    if kind not in ("http", "demo"):
        kind = "demo"

    if not isinstance(raw_spec, dict):
        raw_spec = {}

    merged_case: dict[str, Any] = {}
    test_case_obj = obj.get("test_case")
    if isinstance(test_case_obj, dict):
        merged_case.update(test_case_obj)
    for key in (
        "case_id",
        "module",
        "priority",
        "type",
        "preconditions",
        "steps",
        "expected_result",
        "automation_candidate",
    ):
        if key in obj and obj.get(key) not in (None, ""):
            merged_case[key] = obj.get(key)

    pro_from_spec = raw_spec.get("professional_case")
    if isinstance(pro_from_spec, dict):
        merged_case = {**pro_from_spec, **merged_case}

    pro_case = _normalize_professional_case(merged_case, title=title, tags=tags)

    steps = raw_spec.get("steps")
    if not isinstance(steps, list):
        steps = _to_execution_steps(pro_case)
    raw_spec["steps"] = steps
    raw_spec["professional_case"] = pro_case

    if any(isinstance(s, dict) and s.get("type") == "http_get" for s in steps):
        kind = "http"

    return SuggestedCase(title=title, description=description, tags=tags, kind=kind, spec=raw_spec)


def _normalize_cases_payload(payload: Any) -> list[SuggestedCase]:
    rows: list[Any]
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        raw = payload.get("cases")
        if not isinstance(raw, list):
            raw = payload.get("suggestions")
        rows = raw if isinstance(raw, list) else []
    else:
        rows = []

    out: list[SuggestedCase] = []
    for row in rows[:50]:
        if not isinstance(row, dict):
            continue
        s = _normalize_case(row)
        if s is not None:
            out.append(s)
    return out


def _gemini_model() -> str:
    return os.environ.get("GEMINI_MODEL", "gemini-2.0-flash").strip() or "gemini-2.0-flash"


def _gemini_generate_cases(prompt: str) -> list[SuggestedCase]:
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("missing GEMINI_API_KEY")

    model = _gemini_model()
    timeout_s = float(os.environ.get("GEMINI_TIMEOUT_S", "25"))
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

    user_prompt = (
        "You are a senior QA engineer generating high-quality software test cases.\n"
        "Return ONLY valid JSON, no markdown.\n"
        "Schema:\n"
        "{\"cases\":[{"
        "\"case_id\":\"string\","
        "\"module\":\"string\","
        "\"title\":\"string\","
        "\"priority\":\"P0|P1|P2|P3\","
        "\"type\":\"functional|boundary|negative|security|performance|compatibility|api\","
        "\"preconditions\":[\"string\"],"
        "\"steps\":[{\"step_no\":1,\"action\":\"string\",\"test_data\":\"string\",\"expected_result\":\"string\"}],"
        "\"expected_result\":\"string\","
        "\"tags\":[\"string\"],"
        "\"automation\":{\"kind\":\"demo|http\",\"spec\":{\"steps\":[{\"type\":\"pass\",\"message\":\"string\"}]}},"
        "\"description\":\"string\""
        "}]}\n"
        "Rules:\n"
        "- steps must be specific and executable.\n"
        "- expected_result must be precise and testable.\n"
        "- include positive, boundary and negative scenarios when possible.\n"
        f"Requirement text:\n{prompt}"
    )
    req_body = {
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }
    raw = json.dumps(req_body, ensure_ascii=True).encode("utf-8")
    req = request.Request(
        url,
        data=raw,
        method="POST",
        headers={"Content-Type": "application/json"},
    )

    try:
        with request.urlopen(req, timeout=timeout_s) as resp:  # nosec - fixed upstream endpoint
            data = resp.read().decode("utf-8", errors="replace")
    except error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else str(e)
        raise RuntimeError(f"gemini http error: {e.code} {detail[:240]}") from e
    except Exception as e:  # pragma: no cover - environment/network dependent
        raise RuntimeError(f"gemini request failed: {e}") from e

    try:
        payload = json.loads(data)
    except json.JSONDecodeError as e:
        raise RuntimeError("gemini returned non-json response") from e

    parts = (
        ((payload.get("candidates") or [{}])[0].get("content") or {}).get("parts")
        if isinstance(payload, dict)
        else None
    )
    text = ""
    if isinstance(parts, list):
        for part in parts:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                text += part["text"]

    if not text.strip():
        raise RuntimeError("gemini response missing content text")

    try:
        normalized = _normalize_cases_payload(json.loads(text))
    except json.JSONDecodeError as e:
        raise RuntimeError("gemini text payload was not valid json") from e

    if not normalized:
        raise RuntimeError("gemini returned empty/invalid cases")
    return normalized


def _infer_local_profile(line: str) -> tuple[str, str, str, list[str], str]:
    low = line.lower()
    module = "general"
    case_type = "functional"
    priority = "P1"
    tags: list[str] = []
    expected = "System behavior matches expected business outcome."

    if any(k in low for k in ["login", "sign in", "auth"]) or any(k in line for k in ["登录", "鉴权", "认证"]):
        module = "auth"
        tags.append("auth")
    if any(k in low for k in ["payment", "checkout", "refund"]) or any(k in line for k in ["支付", "结算", "退款"]):
        module = "payment"
        tags.append("payment")
    if "api" in low or "接口" in line:
        module = "api"
        tags.append("api")
        case_type = "api"

    if any(k in low for k in ["error", "fail", "invalid", "forbidden", "denied"]) or any(
        k in line for k in ["失败", "错误", "异常", "非法", "拒绝"]
    ):
        case_type = "negative"
        expected = "System rejects invalid input and returns clear error information."

    if any(k in low for k in ["boundary", "limit", "max", "min", "empty", "null"]) or any(
        k in line for k in ["边界", "上限", "下限", "为空", "空值", "长度"]
    ):
        case_type = "boundary"
        expected = "System handles boundary input correctly without breaking constraints."

    if any(k in low for k in ["security", "permission", "csrf", "xss", "sql injection"]) or any(
        k in line for k in ["安全", "权限", "注入", "越权", "风控"]
    ):
        case_type = "security"
        priority = "P0"
        expected = "Security controls block risky behavior and produce auditable result."

    if any(k in low for k in ["performance", "load", "stress", "latency"]) or any(
        k in line for k in ["性能", "并发", "压测", "延迟"]
    ):
        case_type = "performance"
        priority = "P1"
        expected = "Response time and throughput satisfy defined performance targets."

    return module, case_type, priority, sorted(set(tags)), expected


def generate_cases_local(prompt: str) -> list[SuggestedCase]:
    """
    Offline heuristic generator that emits professional test-case fields.
    """
    text = (prompt or "").strip()
    if not text:
        return []

    lines = [ln.strip(" \t-•*") for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]

    out: list[SuggestedCase] = []
    for ln in lines[:50]:
        module, case_type, priority, tags, expected = _infer_local_profile(ln)
        steps = [
            {
                "step_no": 1,
                "action": "Prepare test preconditions and input",
                "test_data": "As required by scenario",
                "expected_result": "Preconditions are satisfied",
            },
            {
                "step_no": 2,
                "action": ln,
                "test_data": "Scenario-specific input",
                "expected_result": "System accepts and processes request",
            },
            {
                "step_no": 3,
                "action": "Verify response and side effects",
                "test_data": "N/A",
                "expected_result": expected,
            },
        ]
        row = {
            "title": ln,
            "description": "generated from requirement text",
            "module": module,
            "priority": priority,
            "type": case_type,
            "preconditions": [
                "System under test is reachable",
                "Test account and test data are ready",
            ],
            "steps": steps,
            "expected_result": expected,
            "tags": tags,
            "automation": {
                "kind": "demo",
                "spec": {
                    "steps": [
                        {
                            "type": "pass",
                            "message": f"execute scenario: {ln}",
                        }
                    ]
                },
            },
        }
        normalized = _normalize_case(row)
        if normalized is not None:
            out.append(normalized)
    return out


def professional_case_from_suggested(s: SuggestedCase) -> dict[str, Any]:
    spec = s.spec if isinstance(s.spec, dict) else {}
    pro = spec.get("professional_case")
    if isinstance(pro, dict):
        return _normalize_professional_case(pro, title=s.title, tags=s.tags)
    return _normalize_professional_case({}, title=s.title, tags=s.tags)


def generate_cases(prompt: str) -> tuple[list[SuggestedCase], str, str | None]:
    """
    Preferred generator.
    - Uses Gemini when GEMINI_API_KEY is configured.
    - Falls back to local heuristic on failures.
    Returns: (suggestions, provider, warning)
    """
    text = (prompt or "").strip()
    if not text:
        return [], "none", None

    if os.environ.get("GEMINI_API_KEY", "").strip():
        try:
            return _gemini_generate_cases(text), "gemini", None
        except Exception as e:
            local = generate_cases_local(text)
            return local, "local-fallback", str(e)

    return generate_cases_local(text), "local", None
