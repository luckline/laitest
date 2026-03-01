from __future__ import annotations

import hashlib
import json
import os
import re
import socket
import time
from dataclasses import dataclass
from http.client import IncompleteRead, RemoteDisconnected
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
_CJK_RE = re.compile(r"[\u3400-\u9FFF]")

_EN_TEXT_EXACT_MAP: dict[str, str] = {
    "prepare test data and preconditions": "准备测试前置条件与测试数据",
    "according to requirement": "按需求准备",
    "environment and test data are ready": "环境与测试数据准备完成",
    "input based on requirement": "按需求输入",
    "system processes request": "系统完成请求处理",
    "observe response and state changes": "观察响应与状态变化",
    "n/a": "无",
    "generated from requirement": "根据需求生成",
    "system under test is reachable": "系统可访问",
    "required test account/data is available": "测试账号与测试数据已准备好",
    "test account and test data are ready": "测试账号和测试数据已准备好",
    "system behavior matches expected outcome.": "系统行为符合预期结果。",
    "system behavior matches expected business outcome.": "系统行为符合预期业务结果。",
    "system rejects invalid input and returns clear error information.": "系统拒绝非法输入并返回明确错误信息。",
    "system handles boundary input correctly without breaking constraints.": "系统可正确处理边界输入，且不破坏约束。",
    "security controls block risky behavior and produce auditable result.": "安全控制有效拦截风险行为，并产生可审计结果。",
    "response time and throughput satisfy defined performance targets.": "响应时间与吞吐量满足既定性能目标。",
    "prepare test preconditions and input": "准备前置条件和输入数据",
    "as required by scenario": "按场景要求准备",
    "preconditions are satisfied": "前置条件满足",
    "scenario-specific input": "场景对应输入",
    "system accepts and processes request": "系统接收并处理请求",
    "verify response and side effects": "校验响应和副作用",
    "generated from requirement text": "根据需求文本生成",
}

_EN_TOKEN_REPLACEMENTS: list[tuple[str, str]] = [
    (r"\bverification code\b|\botp\b|\bcaptcha\b", "验证码"),
    (r"\blogin\b|\bsign in\b|\bauthentication\b|\bauthenticate\b|\bauth\b", "登录"),
    (r"\bpassword\b", "密码"),
    (r"\busername\b", "用户名"),
    (r"\bphone number\b|\bmobile\b", "手机号"),
    (r"\buser\b", "用户"),
    (r"\baccount\b", "账号"),
    (r"\bsuccessful\b|\bsuccess\b", "成功"),
    (r"\bfailed\b|\bfailure\b|\bfail\b", "失败"),
    (r"\binvalid\b", "无效"),
    (r"\berror\b", "错误"),
    (r"\brequest\b", "请求"),
    (r"\bresponse\b", "响应"),
    (r"\bexpected result\b", "预期结果"),
    (r"\bpreconditions?\b", "前置条件"),
    (r"\bsteps?\b", "步骤"),
    (r"\bmodule\b", "模块"),
    (r"\bsystem\b", "系统"),
    (r"\bboundary\b", "边界"),
    (r"\bsecurity\b", "安全"),
    (r"\bperformance\b", "性能"),
    (r"\bapi\b", "接口"),
    (r"\bverify\b", "校验"),
    (r"\bprepare\b", "准备"),
    (r"\binput\b", "输入"),
    (r"\boutput\b", "输出"),
    (r"\breset\b", "重置"),
    (r"\btest data\b", "测试数据"),
    (r"\bscenario\b", "场景"),
    (r"\bexecute\b", "执行"),
    (r"\bobserve\b", "观察"),
    (r"\bstate changes?\b", "状态变化"),
    (r"\bprocess(es|ed)?\b", "处理"),
    (r"\breject(s|ed)?\b", "拒绝"),
]


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


def _contains_cjk(value: Any) -> bool:
    return bool(_CJK_RE.search(str(value or "")))


def _has_heavy_latin(value: Any) -> bool:
    s = str(value or "")
    latin = len(re.findall(r"[A-Za-z]", s))
    cjk = len(re.findall(r"[\u3400-\u9FFF]", s))
    return latin >= 4 and latin > max(cjk // 2, 1)


def _prompt_requests_english(prompt: str) -> bool:
    low = (prompt or "").lower()
    markers = [
        "output in english",
        "return in english",
        "respond in english",
        "use english",
        "english only",
        "in english",
        "英文输出",
        "输出英文",
        "英语输出",
        "用英文",
    ]
    return any(m in low for m in markers)


def _to_zh_text(
    value: Any,
    default: str = "",
    max_len: int = 400,
    force_default_on_non_cjk: bool = False,
) -> str:
    s = _clean_text(value, default, max_len)
    if not s:
        return default
    if _contains_cjk(s):
        return s

    mapped = _EN_TEXT_EXACT_MAP.get(s.strip().lower())
    if mapped:
        return mapped[:max_len]

    out = s
    for pat, repl in _EN_TOKEN_REPLACEMENTS:
        out = re.sub(pat, repl, out, flags=re.IGNORECASE)
    out = out.replace("N/A", "无").replace("n/a", "无")

    if _contains_cjk(out):
        if force_default_on_non_cjk and default and _has_heavy_latin(out):
            return _clean_text(default, default, max_len)
        return out[:max_len]
    if force_default_on_non_cjk and default:
        return _clean_text(default, default, max_len)
    return s


def _to_zh_module(value: Any) -> str:
    raw = _clean_text(value, "", 80)
    if not raw:
        return "通用模块"
    if _contains_cjk(raw):
        return raw

    low = raw.lower()
    if any(k in low for k in ["login", "sign in", "auth"]):
        return "登录认证"
    if any(k in low for k in ["payment", "checkout", "refund"]):
        return "支付结算"
    if "api" in low:
        return "接口"
    if low in {"general", "common", "default", "misc"}:
        return "通用模块"

    converted = _to_zh_text(raw, "", 80)
    if _contains_cjk(converted):
        return converted
    return "通用模块"


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
            "action": "准备测试前置条件与测试数据",
            "test_data": "按需求准备",
            "expected_result": "环境与测试数据准备完成",
        },
        {
            "step_no": 2,
            "action": title,
            "test_data": "按需求输入",
            "expected_result": "系统完成请求处理",
        },
        {
            "step_no": 3,
            "action": "观察响应与状态变化",
            "test_data": "无",
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
        msg = f"步骤 {no}: {action}" if no is not None else action
        if expected:
            msg += f" | 预期: {expected}"
        out.append({"type": "pass", "message": msg[:240]})

    if out:
        return out
    return [{"type": "pass", "message": "根据需求生成"}]


def _normalize_professional_case(obj: dict[str, Any], title: str, tags: list[str]) -> dict[str, Any]:
    module = _clean_text(obj.get("module"), "通用模块", 80)
    priority = _normalize_priority(obj.get("priority"))
    case_type = _normalize_case_type(obj.get("type"))
    preconditions = _clean_list_str(
        obj.get("preconditions"),
        default=["系统可访问", "测试账号与测试数据已准备好"],
        max_items=10,
    )

    expected_result = _clean_text(
        obj.get("expected_result"),
        default="系统行为符合预期结果。",
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

    description = _clean_text(obj.get("description"), "（自动）根据需求生成", 500)
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
        return _json_loads_loose(s)
    except Exception:
        pass

    start = s.find("{")
    end = s.rfind("}")
    if start >= 0 and end > start:
        return _json_loads_loose(s[start : end + 1])
    raise RuntimeError("model content did not contain valid json object")


def _deepseek_api_key() -> str:
    return _env_first("DEEPSEEK_API_KEY", "DeepSeek_API_KEY", "DEEPSEEK_KEY")


def _is_timeout_error(exc: Exception) -> bool:
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return True
    if isinstance(exc, error.URLError):
        reason = getattr(exc, "reason", None)
        return isinstance(reason, (TimeoutError, socket.timeout))
    return "timed out" in str(exc).lower()


def _is_retryable_transport_error(exc: Exception) -> bool:
    retryable_types = (
        IncompleteRead,
        RemoteDisconnected,
        ConnectionResetError,
        ConnectionAbortedError,
        BrokenPipeError,
    )
    if isinstance(exc, retryable_types):
        return True
    if isinstance(exc, error.URLError):
        reason = getattr(exc, "reason", None)
        if isinstance(reason, retryable_types + (TimeoutError, socket.timeout)):
            return True
        if isinstance(reason, str):
            low_reason = reason.lower()
            if any(
                k in low_reason
                for k in ("incompleteread", "connection reset", "connection aborted", "broken pipe")
            ):
                return True
    low = str(exc).lower()
    return any(
        k in low
        for k in (
            "incompleteread",
            "remote end closed connection",
            "connection reset",
            "connection aborted",
            "broken pipe",
            "connection broken",
            "chunkedencodingerror",
        )
    )


def _try_decode_complete_json_text(raw: Any) -> str | None:
    if isinstance(raw, (bytes, bytearray)):
        text = raw.decode("utf-8", errors="replace").strip()
    elif isinstance(raw, str):
        text = raw.strip()
    else:
        return None
    if not text:
        return None
    try:
        json.loads(text)
        return text
    except Exception:
        return None


def _json_loads_loose(text: str) -> Any:
    s = (text or "").strip()
    if not s:
        raise RuntimeError("empty json text")

    candidates: list[str] = []
    base = s.replace("\ufeff", "").strip()
    candidates.append(base)
    # Remove trailing commas before object/array endings.
    candidates.append(re.sub(r",\s*([}\]])", r"\1", base))
    # Remove accidental control chars that sometimes appear in streaming responses.
    candidates.append(re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", base))

    last_err: Exception | None = None
    dedup: list[str] = []
    for c in candidates:
        if c and c not in dedup:
            dedup.append(c)
    for c in dedup:
        try:
            return json.loads(c)
        except Exception as e:
            last_err = e
        try:
            return json.loads(c, strict=False)
        except Exception as e:
            last_err = e
    if last_err is None:
        raise RuntimeError("json parse failed")
    raise last_err


def _find_balanced_json_object(text: str, start: int) -> str | None:
    if start < 0 or start >= len(text) or text[start] != "{":
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _extract_cases_obj_from_raw_response(data: str) -> Any | None:
    s = str(data or "")
    markers = ['{"cases"', '{"suggestions"']
    for marker in markers:
        idx = s.find(marker)
        if idx >= 0:
            obj_text = _find_balanced_json_object(s, idx)
            if obj_text:
                try:
                    return _json_loads_loose(obj_text)
                except Exception:
                    pass

    # Fallback for heavily escaped JSON strings inside raw completion payloads.
    escaped_markers = ['{\\\"cases\\\"', '{\\\"suggestions\\\"']
    for marker in escaped_markers:
        idx = s.find(marker)
        if idx >= 0:
            obj_text = _find_balanced_json_object(s, idx)
            if not obj_text:
                continue
            unescaped = obj_text.replace("\\\\n", "\n").replace('\\"', '"')
            try:
                return _json_loads_loose(unescaped)
            except Exception:
                continue
    return None


def _safe_int_env(name: str, default: int, min_v: int, max_v: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)) or str(default))
    except Exception:
        value = default
    if value < min_v:
        return min_v
    if value > max_v:
        return max_v
    return value


def _gemini_prompt_text(prompt: str) -> str:
    return (
        "你是一名资深QA测试工程师，请根据需求生成高质量软件测试用例。\n"
        "只返回合法 JSON，不要返回 Markdown，不要添加额外解释。\n"
        "除非需求明确要求英文，否则所有自然语言字段一律使用简体中文。\n"
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
        "- 默认输出语言：简体中文（需求明确要求英文时除外）。\n"
        "- steps 中 action/test_data/expected_result 必须具体且可执行。\n"
        "- expected_result 必须可验证、可判定。\n"
        "- 尽可能覆盖正向、边界和异常场景。\n"
        f"需求文本:\n{prompt}"
    )


def _deepseek_prompt_text(prompt: str, max_cases: int) -> str:
    # Keep prompt concise to reduce latency/token usage on DeepSeek.
    return (
        "请扮演资深QA工程师，根据需求输出结构化测试用例。只返回JSON对象，不要Markdown。\n"
        "输出格式:\n"
        "{\"cases\":[{"
        "\"case_id\":\"string\","
        "\"title\":\"string\","
        "\"module\":\"string\","
        "\"priority\":\"P0|P1|P2|P3\","
        "\"type\":\"functional|boundary|negative|security|performance|compatibility|api\","
        "\"preconditions\":[\"string\"],"
        "\"steps\":[{\"step_no\":1,\"action\":\"string\",\"test_data\":\"string\",\"expected_result\":\"string\"}],"
        "\"expected_result\":\"string\","
        "\"tags\":[\"string\"],"
        "\"description\":\"string\""
        "}]}\n"
        f"要求: 最多输出{max_cases}条；默认简体中文（需求明确要求英文除外）；步骤可执行，预期可验证。\n"
        "- JSON 必须可被标准 json.loads 直接解析。\n"
        "- 禁止尾逗号，字符串里的双引号必须转义。\n"
        f"需求:\n{prompt}"
    )


def _parse_deepseek_response_cases(data: str) -> list[SuggestedCase]:
    try:
        payload = _json_loads_loose(data)
    except Exception as e:
        # Some responses may have broken outer completion JSON while still
        # containing a valid inner {"cases":[...]} object. Try to recover it.
        recovered = _extract_cases_obj_from_raw_response(data)
        if recovered is not None:
            normalized = _normalize_cases_payload(recovered)
            if normalized:
                return normalized
        raise RuntimeError(f"deepseek returned non-json response: {e}") from e

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
        "systemInstruction": {
            "parts": [
                {
                    "text": "除非用户明确要求英文，否则所有自然语言字段必须使用简体中文。只返回JSON。"
                }
            ]
        },
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
    timeout_s = float(os.environ.get("DEEPSEEK_TIMEOUT_S", "60"))
    retries = int(os.environ.get("DEEPSEEK_RETRIES", "2") or "2")
    max_tokens = _safe_int_env("DEEPSEEK_MAX_TOKENS", 1400, 256, 8192)
    max_cases = _safe_int_env("DEEPSEEK_MAX_CASES", 10, 1, 30)
    prompt_max_chars = _safe_int_env("DEEPSEEK_PROMPT_MAX_CHARS", 4500, 500, 20000)
    parse_retries = _safe_int_env("DEEPSEEK_PARSE_RETRIES", 2, 0, 5)
    prompt_text = (prompt or "").strip()
    if len(prompt_text) > prompt_max_chars:
        prompt_text = prompt_text[:prompt_max_chars]

    if retries < 0:
        retries = 0
    if retries > 5:
        retries = 5
    max_attempts = retries + 1
    url = _deepseek_chat_url()
    req_body = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "你是资深QA测试工程师。默认输出简体中文，仅返回JSON。",
            },
            {"role": "user", "content": _deepseek_prompt_text(prompt_text, max_cases=max_cases)},
        ],
        "temperature": 0.1,
        "stream": False,
        "response_format": {"type": "json_object"},
        "max_tokens": max_tokens,
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

    parse_attempts = parse_retries + 1
    last_parse_error: Exception | None = None
    for parse_attempt in range(1, parse_attempts + 1):
        data = ""
        for attempt in range(1, max_attempts + 1):
            try:
                with request.urlopen(req, timeout=timeout_s) as resp:  # nosec - fixed upstream endpoint
                    data = resp.read().decode("utf-8", errors="replace")
                    break
            except IncompleteRead as e:
                # Some upstream connections close early after sending most bytes.
                # If the partial body is still valid JSON, accept it; otherwise retry.
                partial_text = _try_decode_complete_json_text(getattr(e, "partial", b""))
                if partial_text:
                    data = partial_text
                    break
                if attempt < max_attempts:
                    time.sleep(min(2 ** (attempt - 1), 4))
                    continue
                partial_size = len(getattr(e, "partial", b"") or b"")
                raise RuntimeError(
                    f"deepseek response interrupted (IncompleteRead) after {max_attempts} attempts; partial_bytes={partial_size}"
                ) from e
            except error.HTTPError as e:
                code, msg = _parse_http_error(e)
                if code == 402:
                    raise RuntimeError("deepseek insufficient balance (402): top up DeepSeek account") from e
                if code == 429:
                    raise RuntimeError(
                        "deepseek quota/rate limit exceeded (429): check plan/billing or wait for reset"
                    ) from e
                # Retry on transient 5xx errors.
                if code in (500, 502, 503, 504) and attempt < max_attempts:
                    time.sleep(min(2 ** (attempt - 1), 4))
                    continue
                raise RuntimeError(f"deepseek http error: {code} {msg}") from e
            except Exception as e:  # pragma: no cover - environment/network dependent
                if _is_timeout_error(e) and attempt < max_attempts:
                    time.sleep(min(2 ** (attempt - 1), 4))
                    continue
                if _is_timeout_error(e):
                    raise RuntimeError(
                        f"deepseek request timed out after {max_attempts} attempts (timeout={timeout_s}s)"
                    ) from e
                if _is_retryable_transport_error(e) and attempt < max_attempts:
                    time.sleep(min(2 ** (attempt - 1), 4))
                    continue
                if _is_retryable_transport_error(e):
                    raise RuntimeError(
                        f"deepseek transport interrupted after {max_attempts} attempts: {e.__class__.__name__}: {e}"
                    ) from e
                raise RuntimeError(f"deepseek request failed: {e}") from e

        try:
            return _parse_deepseek_response_cases(data)
        except Exception as parse_err:
            last_parse_error = parse_err
            if parse_attempt < parse_attempts:
                time.sleep(min(2 ** (parse_attempt - 1), 3))
                continue
            data_preview = re.sub(r"\s+", " ", str(data or ""))[:180]
            raise RuntimeError(
                f"deepseek invalid json content after {parse_attempts} attempts: {parse_err}; preview={data_preview}"
            ) from parse_err

    raise RuntimeError(f"deepseek parse retries exhausted: {last_parse_error}")


def _infer_local_profile(line: str) -> tuple[str, str, str, list[str], str]:
    low = line.lower()
    module = "通用模块"
    case_type = "functional"
    priority = "P1"
    tags: list[str] = []
    expected = "系统行为符合预期业务结果。"

    if any(k in low for k in ["login", "sign in", "auth"]) or any(k in line for k in ["登录", "鉴权", "认证"]):
        module = "登录认证"
        tags.append("auth")
    if any(k in low for k in ["payment", "checkout", "refund"]) or any(k in line for k in ["支付", "结算", "退款"]):
        module = "支付结算"
        tags.append("payment")
    if "api" in low or "接口" in line:
        module = "接口"
        tags.append("api")
        case_type = "api"

    if any(k in low for k in ["error", "fail", "invalid", "forbidden", "denied"]) or any(
        k in line for k in ["失败", "错误", "异常", "非法", "拒绝"]
    ):
        case_type = "negative"
        expected = "系统拒绝非法输入并返回明确错误信息。"

    if any(k in low for k in ["boundary", "limit", "max", "min", "empty", "null"]) or any(
        k in line for k in ["边界", "上限", "下限", "为空", "空值", "长度"]
    ):
        case_type = "boundary"
        expected = "系统可正确处理边界输入，且不破坏约束。"

    if any(k in low for k in ["security", "permission", "csrf", "xss", "sql injection"]) or any(
        k in line for k in ["安全", "权限", "注入", "越权", "风控"]
    ):
        case_type = "security"
        priority = "P0"
        expected = "安全控制有效拦截风险行为，并产生可审计结果。"

    if any(k in low for k in ["performance", "load", "stress", "latency"]) or any(
        k in line for k in ["性能", "并发", "压测", "延迟"]
    ):
        case_type = "performance"
        priority = "P1"
        expected = "响应时间与吞吐量满足既定性能目标。"

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
                "action": "准备前置条件和输入数据",
                "test_data": "按场景要求准备",
                "expected_result": "前置条件满足",
            },
            {
                "step_no": 2,
                "action": ln,
                "test_data": "场景对应输入",
                "expected_result": "系统接收并处理请求",
            },
            {
                "step_no": 3,
                "action": "校验响应和副作用",
                "test_data": "无",
                "expected_result": expected,
            },
        ]
        row = {
            "title": ln,
            "description": "根据需求文本生成",
            "module": module,
            "priority": priority,
            "type": case_type,
            "preconditions": [
                "系统可访问",
                "测试账号和测试数据已准备好",
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
                            "message": f"执行场景: {ln}",
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


def _coerce_suggested_case_to_zh(s: SuggestedCase) -> SuggestedCase:
    pro = professional_case_from_suggested(s)
    pro_title = _to_zh_text(
        pro.get("title"),
        "根据需求生成的测试用例",
        300,
        force_default_on_non_cjk=True,
    )
    pro["title"] = pro_title
    pro["module"] = _to_zh_module(pro.get("module"))
    pro["preconditions"] = [
        _to_zh_text(x, "前置条件已满足", 200, force_default_on_non_cjk=True)
        for x in _clean_list_str(pro.get("preconditions"), default=["系统可访问", "测试账号与测试数据已准备好"], max_items=10)
    ]
    pro["expected_result"] = _to_zh_text(
        pro.get("expected_result"),
        "系统行为符合预期结果。",
        400,
        force_default_on_non_cjk=True,
    )

    normalized_steps = _normalize_professional_steps(pro.get("steps"))
    if not normalized_steps:
        normalized_steps = _fallback_professional_steps(title=pro_title, expected_result=pro["expected_result"])
    fixed_steps: list[dict[str, Any]] = []
    for i, row in enumerate(normalized_steps, start=1):
        fixed_steps.append(
            {
                "step_no": int(row.get("step_no") or i),
                "action": _to_zh_text(row.get("action"), "执行测试步骤", 300, force_default_on_non_cjk=True),
                "test_data": _to_zh_text(row.get("test_data"), "无", 200, force_default_on_non_cjk=True),
                "expected_result": _to_zh_text(
                    row.get("expected_result"),
                    "系统行为符合预期。",
                    300,
                    force_default_on_non_cjk=True,
                ),
            }
        )
    pro["steps"] = fixed_steps

    spec: dict[str, Any]
    if isinstance(s.spec, dict):
        try:
            spec = json.loads(json.dumps(s.spec, ensure_ascii=False))
        except Exception:
            spec = dict(s.spec)
    else:
        spec = {}
    spec["professional_case"] = pro
    spec["steps"] = _to_execution_steps(pro)

    title = _to_zh_text(s.title, pro_title, 300, force_default_on_non_cjk=True)
    if not _contains_cjk(title):
        title = pro_title
    description = _to_zh_text(s.description, "（自动）根据需求生成", 500, force_default_on_non_cjk=True)
    return SuggestedCase(title=title, description=description, tags=s.tags, kind=s.kind, spec=spec)


def _coerce_cases_default_language(cases: list[SuggestedCase], prompt: str) -> list[SuggestedCase]:
    if not cases:
        return cases
    default_lang = (os.environ.get("LAITEST_DEFAULT_LANG", "zh-CN").strip() or "zh-CN").lower()
    if not default_lang.startswith("zh"):
        return cases
    if _prompt_requests_english(prompt):
        return cases
    return [_coerce_suggested_case_to_zh(s) for s in cases]


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
        "deepseek_timeout_s": float(os.environ.get("DEEPSEEK_TIMEOUT_S", "60") or "60"),
        "deepseek_retries": int(os.environ.get("DEEPSEEK_RETRIES", "2") or "2"),
        "deepseek_parse_retries": _safe_int_env("DEEPSEEK_PARSE_RETRIES", 2, 0, 5),
        "deepseek_max_tokens": _safe_int_env("DEEPSEEK_MAX_TOKENS", 1400, 256, 8192),
        "deepseek_max_cases": _safe_int_env("DEEPSEEK_MAX_CASES", 10, 1, 30),
        "deepseek_prompt_max_chars": _safe_int_env("DEEPSEEK_PROMPT_MAX_CHARS", 4500, 500, 20000),
        "gemini_api_key_configured": has_gemini,
        "gemini_model": configured,
        "gemini_effective_model": effective,
        "gemini_api_version": api_version,
        "default_language": (os.environ.get("LAITEST_DEFAULT_LANG", "zh-CN").strip() or "zh-CN"),
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
            rows = _deepseek_generate_cases(text)
            return _coerce_cases_default_language(rows, text), "deepseek", None
        except Exception as deep_err:
            if has_gemini:
                try:
                    rows = _gemini_generate_cases(text)
                    return (
                        _coerce_cases_default_language(rows, text),
                        "gemini-fallback",
                        f"deepseek failed: {deep_err}",
                    )
                except Exception as gem_err:
                    local = _coerce_cases_default_language(generate_cases_local(text), text)
                    return (
                        local,
                        "local-fallback",
                        f"deepseek failed: {deep_err}; gemini failed: {gem_err}",
                    )
            local = _coerce_cases_default_language(generate_cases_local(text), text)
            return local, "local-fallback", f"deepseek failed: {deep_err}"

    if has_gemini:
        try:
            rows = _gemini_generate_cases(text)
            return _coerce_cases_default_language(rows, text), "gemini", None
        except Exception as e:
            local = _coerce_cases_default_language(generate_cases_local(text), text)
            return local, "local-fallback", str(e)

    return (
        _coerce_cases_default_language(generate_cases_local(text), text),
        "local",
        "DEEPSEEK_API_KEY/DeepSeek_API_KEY and GEMINI_API_KEY are not configured; using local generator",
    )
