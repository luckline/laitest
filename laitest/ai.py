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

_GEMINI_MODEL_CACHE: dict[str, str] = {}
_GEMINI_API_VERSION_CACHE: dict[str, str] = {}


def _env_first(*keys: str) -> str:
    for k in keys:
        v = os.environ.get(k, "").strip()
        if v:
            return v
    return ""


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
    raw = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash").strip() or "gemini-2.0-flash"
    if raw.startswith("models/"):
        raw = raw.removeprefix("models/")
    return raw


def _deepseek_model() -> str:
    raw = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat").strip() or "deepseek-chat"
    if raw.startswith("models/"):
        raw = raw.removeprefix("models/")
    return raw


def _deepseek_base_url() -> str:
    return (os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip() or "https://api.deepseek.com").rstrip("/")


def _deepseek_chat_url() -> str:
    base = _deepseek_base_url()
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def _extract_json_object_from_text(text: str) -> Any:
    s = (text or "").strip()
    if not s:
        raise RuntimeError("empty model content")
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
        s = re.sub(r"\s*```$", "", s)
        s = s.strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass

    start = s.find("{")
    end = s.rfind("}")
    if start >= 0 and end > start:
        return json.loads(s[start : end + 1])
    raise RuntimeError("model content did not contain valid json object")


def _deepseek_api_key() -> str:
    return _env_first("DEEPSEEK_API_KEY", "DeepSeek_API_KEY", "DEEPSEEK_KEY")


def _gemini_prompt_text(prompt: str) -> str:
    return (
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


def _gemini_generate_raw(
    api_key: str,
    model: str,
    prompt: str,
    timeout_s: float,
    api_version: str = "v1beta",
) -> str:
    url = f"https://generativelanguage.googleapis.com/{api_version}/models/{model}:generateContent?key={api_key}"
    user_prompt = _gemini_prompt_text(prompt)
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

    with request.urlopen(req, timeout=timeout_s) as resp:  # nosec - fixed upstream endpoint
        return resp.read().decode("utf-8", errors="replace")


def _parse_http_error(e: error.HTTPError) -> tuple[int, str]:
    detail = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else str(e)
    message = ""
    try:
        payload = json.loads(detail)
        if isinstance(payload, dict):
            err = payload.get("error")
            if isinstance(err, dict):
                message = str(err.get("message") or "").strip()
    except Exception:
        message = ""
    if not message:
        message = detail.strip()[:500]
    return int(e.code), message[:500]


def _model_family(model: str) -> str:
    if not model:
        return ""
    m = model.removeprefix("models/")
    parts = m.split("-")
    if len(parts) >= 3 and parts[0] == "gemini":
        return "-".join(parts[:3])
    return m


def _candidate_model_aliases(requested: str) -> list[str]:
    req = requested.removeprefix("models/")
    out: list[str] = [req]
    if req.endswith("-latest"):
        out.append(req.removesuffix("-latest"))
    else:
        out.append(f"{req}-latest")
    if not req.endswith("-001"):
        out.append(f"{req}-001")
    # dedupe while preserving order
    dedup: list[str] = []
    for m in out:
        if m and m not in dedup:
            dedup.append(m)
    return dedup


def _list_generate_models(api_key: str, timeout_s: float, api_version: str = "v1beta") -> list[str]:
    url = f"https://generativelanguage.googleapis.com/{api_version}/models?key={api_key}"
    req = request.Request(url, method="GET")
    with request.urlopen(req, timeout=timeout_s) as resp:  # nosec - fixed upstream endpoint
        raw = resp.read().decode("utf-8", errors="replace")
    payload = json.loads(raw)
    models = payload.get("models") if isinstance(payload, dict) else []
    if not isinstance(models, list):
        return []

    out: list[str] = []
    for m in models:
        if not isinstance(m, dict):
            continue
        supported = m.get("supportedGenerationMethods")
        if not isinstance(supported, list) or "generateContent" not in supported:
            continue
        name = str(m.get("name") or "")
        if name.startswith("models/"):
            name = name.removeprefix("models/")
        if name:
            out.append(name)
    return out


def _pick_fallback_model(requested: str, available: list[str]) -> str | None:
    if not available:
        return None
    if requested in available:
        return requested

    # 1) strict preference: same family first (e.g. gemini-1.5-*)
    req_family = _model_family(requested)
    same_family = [m for m in available if _model_family(m) == req_family]
    if same_family:
        aliases = _candidate_model_aliases(requested)
        for alias in aliases:
            if alias in same_family:
                return alias
        prefixed = [m for m in same_family if m.startswith(requested + "-")]
        if prefixed:
            return prefixed[0]
        return same_family[0]

    # If user explicitly asks for 1.5 family, do not jump to 2.x automatically.
    if req_family.startswith("gemini-1.5"):
        return None

    preferred_order = [
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-2.5-flash",
    ]
    for p in preferred_order:
        if p in available:
            return p

    for m in available:
        if "flash" in m:
            return m
    return available[0]


def _extract_content_text(data: str) -> str:
    payload = json.loads(data)
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
    return text


def _gemini_generate_cases(prompt: str) -> list[SuggestedCase]:
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("missing GEMINI_API_KEY")

    requested_model = _gemini_model()
    cached_model = _GEMINI_MODEL_CACHE.get(requested_model, requested_model)
    # Do not reuse cache when it crosses model family (e.g. 1.5 -> 2.5).
    if _model_family(cached_model) != _model_family(requested_model):
        cached_model = requested_model
    model = cached_model
    api_version = _GEMINI_API_VERSION_CACHE.get(requested_model, "v1beta")
    timeout_s = float(os.environ.get("GEMINI_TIMEOUT_S", "25"))

    data = ""
    try:
        data = _gemini_generate_raw(
            api_key=api_key,
            model=model,
            prompt=prompt,
            timeout_s=timeout_s,
            api_version=api_version,
        )
    except error.HTTPError as e:
        code, msg = _parse_http_error(e)
        if code == 429:
            raise RuntimeError(
                "gemini quota exceeded (429): check plan/billing or wait for quota reset"
            ) from e

        # Auto-recover from stale/unsupported model aliases by probing model list once.
        if code == 404 and "not found" in msg.lower() and "models/" in msg:
            try:
                # First try requested model aliases (same family) and version permutations.
                alt_versions = [v for v in ("v1", "v1beta") if v != api_version]
                aliases = _candidate_model_aliases(requested_model)
                tried = set()
                for alias in aliases:
                    for ver in (api_version, *alt_versions):
                        key = f"{alias}@{ver}"
                        if key in tried:
                            continue
                        tried.add(key)
                        try:
                            data = _gemini_generate_raw(
                                api_key=api_key,
                                model=alias,
                                prompt=prompt,
                                timeout_s=timeout_s,
                                api_version=ver,
                            )
                            model = alias
                            api_version = ver
                            _GEMINI_MODEL_CACHE[requested_model] = model
                            _GEMINI_API_VERSION_CACHE[requested_model] = api_version
                            break
                        except error.HTTPError:
                            continue
                    if data:
                        break
                if data:
                    pass
                else:
                    available: list[str] = []
                    list_errors: list[str] = []
                    for ver in (api_version, *alt_versions):
                        try:
                            available = _list_generate_models(
                                api_key=api_key, timeout_s=timeout_s, api_version=ver
                            )
                            if available:
                                api_version = ver
                                break
                        except Exception as list_err:
                            list_errors.append(str(list_err))
                            continue

                    fallback = _pick_fallback_model(requested=model, available=available)
                    if fallback:
                        data = _gemini_generate_raw(
                            api_key=api_key,
                            model=fallback,
                            prompt=prompt,
                            timeout_s=timeout_s,
                            api_version=api_version,
                        )
                        model = fallback
                        _GEMINI_MODEL_CACHE[requested_model] = fallback
                        _GEMINI_API_VERSION_CACHE[requested_model] = api_version
                    else:
                        sample = ", ".join(available[:6]) if available else "(empty)"
                        if list_errors:
                            raise RuntimeError(
                                f"gemini model not found (404): requested={requested_model}; "
                                f"available={sample}; list-errors={'; '.join(list_errors)[:280]}"
                            ) from e
                        raise RuntimeError(
                            f"gemini model not found (404): requested={requested_model}; available={sample}"
                        ) from e
            except RuntimeError:
                raise
            except Exception as list_err:
                raise RuntimeError(
                    f"gemini model not found (404) and fallback failed: {list_err}"
                ) from e
        else:
            raise RuntimeError(f"gemini http error: {code} {msg}") from e
    except Exception as e:  # pragma: no cover - environment/network dependent
        raise RuntimeError(f"gemini request failed: {e}") from e

    # Persist current version for the requested model if we reached success path.
    if data:
        _GEMINI_MODEL_CACHE[requested_model] = model
        _GEMINI_API_VERSION_CACHE[requested_model] = api_version

    try:
        text = _extract_content_text(data)
    except json.JSONDecodeError as e:
        raise RuntimeError("gemini returned non-json response") from e

    if not text.strip():
        raise RuntimeError("gemini response missing content text")

    try:
        normalized = _normalize_cases_payload(json.loads(text))
    except json.JSONDecodeError as e:
        raise RuntimeError("gemini text payload was not valid json") from e

    if not normalized:
        raise RuntimeError("gemini returned empty/invalid cases")
    return normalized


def _deepseek_generate_cases(prompt: str) -> list[SuggestedCase]:
    api_key = _deepseek_api_key()
    if not api_key:
        raise RuntimeError("missing DEEPSEEK_API_KEY (or DeepSeek_API_KEY)")

    model = _deepseek_model()
    timeout_s = float(os.environ.get("DEEPSEEK_TIMEOUT_S", "25"))
    url = _deepseek_chat_url()
    req_body = {
        "model": model,
        "messages": [
            {"role": "user", "content": _gemini_prompt_text(prompt)},
        ],
        "temperature": 0.2,
        "stream": False,
    }
    raw = json.dumps(req_body, ensure_ascii=True).encode("utf-8")
    req = request.Request(
        url,
        data=raw,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )

    try:
        with request.urlopen(req, timeout=timeout_s) as resp:  # nosec - fixed upstream endpoint
            data = resp.read().decode("utf-8", errors="replace")
    except error.HTTPError as e:
        code, msg = _parse_http_error(e)
        if code == 429:
            raise RuntimeError(
                "deepseek quota/rate limit exceeded (429): check plan/billing or wait for reset"
            ) from e
        raise RuntimeError(f"deepseek http error: {code} {msg}") from e
    except Exception as e:  # pragma: no cover - environment/network dependent
        raise RuntimeError(f"deepseek request failed: {e}") from e

    try:
        payload = json.loads(data)
    except json.JSONDecodeError as e:
        raise RuntimeError("deepseek returned non-json response") from e

    choices = payload.get("choices") if isinstance(payload, dict) else None
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("deepseek response missing choices")

    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, dict):
        raw_obj = content
    else:
        raw_obj = _extract_json_object_from_text(str(content or ""))

    normalized = _normalize_cases_payload(raw_obj)
    if not normalized:
        raise RuntimeError("deepseek returned empty/invalid cases")
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


def ai_runtime_status() -> dict[str, Any]:
    has_deepseek = bool(_deepseek_api_key())
    has_gemini = bool(os.environ.get("GEMINI_API_KEY", "").strip())
    configured = _gemini_model()
    effective = _GEMINI_MODEL_CACHE.get(configured, configured)
    if _model_family(effective) != _model_family(configured):
        effective = configured
    api_version = _GEMINI_API_VERSION_CACHE.get(configured, "v1beta")
    if has_deepseek:
        mode = "deepseek"
    elif has_gemini:
        mode = "gemini"
    else:
        mode = "local"
    return {
        "deepseek_api_key_configured": has_deepseek,
        "deepseek_model": _deepseek_model(),
        "deepseek_base_url": _deepseek_base_url(),
        "gemini_api_key_configured": has_gemini,
        "gemini_model": configured,
        "gemini_effective_model": effective,
        "gemini_api_version": api_version,
        "provider_order": ["deepseek", "gemini", "local"],
        "mode": mode,
    }


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

    has_deepseek = bool(_deepseek_api_key())
    has_gemini = bool(os.environ.get("GEMINI_API_KEY", "").strip())

    if has_deepseek:
        try:
            return _deepseek_generate_cases(text), "deepseek", None
        except Exception as deep_err:
            if has_gemini:
                try:
                    return (
                        _gemini_generate_cases(text),
                        "gemini-fallback",
                        f"deepseek failed: {deep_err}",
                    )
                except Exception as gem_err:
                    local = generate_cases_local(text)
                    return (
                        local,
                        "local-fallback",
                        f"deepseek failed: {deep_err}; gemini failed: {gem_err}",
                    )
            local = generate_cases_local(text)
            return local, "local-fallback", f"deepseek failed: {deep_err}"

    if has_gemini:
        try:
            return _gemini_generate_cases(text), "gemini", None
        except Exception as e:
            local = generate_cases_local(text)
            return local, "local-fallback", str(e)

    return (
        generate_cases_local(text),
        "local",
        "DEEPSEEK_API_KEY/DeepSeek_API_KEY and GEMINI_API_KEY are not configured; using local generator",
    )
