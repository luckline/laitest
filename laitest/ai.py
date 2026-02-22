from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SuggestedCase:
    title: str
    description: str
    tags: list[str]
    kind: str
    spec: dict[str, Any]


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
