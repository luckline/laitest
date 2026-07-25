#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def pick(row: dict, *keys: str, default=""):
    for key in keys:
        if row.get(key) not in (None, ""):
            return row[key]
    return default


def normalize(row: dict, args: argparse.Namespace, index: int) -> dict:
    title = str(pick(row, "title", "headline", "name")).strip()
    content = str(pick(row, "content", "body", "article", "markdown", "html", "text")).strip()
    if not title or not content:
        raise ValueError(f"第 {index + 1} 条内容缺少 title 或 content")
    seed = f"{args.account}:{args.platform}:{args.external_id}:{index}:{title}:{content}"
    external_id = f"{args.external_id}-{index + 1}" if args.external_id else hashlib.sha256(seed.encode()).hexdigest()[:24]
    keywords = pick(row, "keywords", "tags", default=[])
    return {
        "externalId": external_id,
        "accountKey": args.account,
        "platform": args.platform,
        "contentType": args.content_type or ("micro-post" if args.platform == "toutiao" else "article"),
        "title": title,
        "summary": str(pick(row, "summary", "description", "digest")),
        "content": content,
        "coverImage": str(pick(row, "coverImage", "cover_image", "thumb_url")),
        "keywords": keywords if isinstance(keywords, list) else str(keywords).split(","),
        "platformUrl": args.platform_url or str(pick(row, "platformUrl", "platform_url", "url")),
        "publishedAt": pick(row, "publishedAt", "published_at"),
        "status": args.status,
    }


def rows_from(value) -> list[dict]:
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    if isinstance(value, dict):
        for key in ("articles", "items", "posts", "data"):
            if isinstance(value.get(key), list):
                return [row for row in value[key] if isinstance(row, dict)]
        return [value]
    raise ValueError("内容文件必须是 JSON 对象或数组")


def sync(payload: dict, endpoint: str, token: str) -> dict:
    request = Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=15) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code}: {detail}") from error
    if int(result.get("code", 0)) != 0:
        raise RuntimeError(result.get("message") or "同步失败")
    return result.get("data") or {}


def main() -> int:
    parser = argparse.ArgumentParser(description="将 OpenClaw 运营内容同步到 Luckline")
    parser.add_argument("--file", help="生成内容的 JSON 文件；省略时从 stdin 读取")
    parser.add_argument("--account", required=True, choices=["xiaoliang", "mingjin"])
    parser.add_argument("--platform", required=True, choices=["wechat", "toutiao", "manual"])
    parser.add_argument("--external-id", default="")
    parser.add_argument("--platform-url", default="")
    parser.add_argument("--content-type", choices=["article", "micro-post", "travel-note", "tech-note"])
    parser.add_argument("--status", default="published", choices=["draft", "published", "archived"])
    args = parser.parse_args()

    endpoint = os.environ.get("LAITEST_SYNC_URL", "https://timelens.cc/api/content/sync")
    token = os.environ.get("LAITEST_SYNC_TOKEN", "")
    if not token:
        print("[laitest] 缺少 LAITEST_SYNC_TOKEN", file=sys.stderr)
        return 2
    raw = Path(args.file).read_text(encoding="utf-8") if args.file else sys.stdin.read()
    rows = rows_from(json.loads(raw))
    failures = 0
    for index, row in enumerate(rows):
        try:
            payload = normalize(row, args, index)
            result = sync(payload, endpoint, token)
            print(json.dumps({"ok": True, "title": payload["title"], **result}, ensure_ascii=False))
        except Exception as error:
            failures += 1
            print(json.dumps({"ok": False, "index": index, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
