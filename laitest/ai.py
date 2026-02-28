from __future__ import annotations

import json
import os
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


def _normalize_case(obj: dict[str, Any]) -> SuggestedCase | None:
    title = str(obj.get("title") or "").strip()
    if not title:
        return None

    description = str(obj.get("description") or "").strip() or "(auto) generated from prompt"
    tags = obj.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    tags = [str(x).strip() for x in tags if str(x).strip()]

    kind = str(obj.get("kind") or "demo").strip().lower()
    if kind not in ("http", "demo"):
        kind = "demo"

    spec = obj.get("spec")
    if not isinstance(spec, dict):
        spec = {
            "steps": [
                {
                    "type": "pass",
                    "message": "generated demo step (replace with real http/api steps)",
                }
            ]
        }

    return SuggestedCase(title=title, description=description, tags=tags, kind=kind, spec=spec)


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
        "You generate software test cases.\n"
        "Return ONLY valid JSON, no markdown.\n"
        "Schema: {\"cases\":[{"
        "\"title\":string,"
        "\"description\":string,"
        "\"tags\":string[],"
        "\"kind\":\"http\"|\"demo\","
        "\"spec\":object"
        "}]}\n"
        "Keep cases concise and actionable. Prefer kind=http when reasonable.\n"
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
        with request.urlopen(req, timeout=timeout_s) as resp:  # nosec - user-provided endpoint path is fixed
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


def generate_cases_local(prompt: str) -> list[SuggestedCase]:
    """
    Offline heuristic generator: turns bullet-ish lines into test cases.
    This keeps the MVP dependency-free and still "smart enough" to demo.
    """
    text = (prompt or "").strip()
    if not text:
        return []

    lines = [ln.strip(" \t-•*") for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]

    out: list[SuggestedCase] = []
    for ln in lines[:50]:
        title = ln
        tags = []
        low = ln.lower()
        if "login" in low or "sign in" in low:
            tags.append("auth")
        if "payment" in low or "checkout" in low:
            tags.append("payment")
        if "api" in low:
            tags.append("api")
        out.append(
            SuggestedCase(
                title=title,
                description="(auto) generated from prompt",
                tags=tags,
                kind="demo",
                spec={
                    "steps": [
                        {
                            "type": "pass",
                            "message": "generated demo step (replace with real http/api steps)",
                        }
                    ]
                },
            )
        )
    return out


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
