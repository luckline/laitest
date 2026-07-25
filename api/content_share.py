from __future__ import annotations

import html
import json
import os
import re
from datetime import datetime
from html.parser import HTMLParser
from urllib.error import HTTPError
from urllib.parse import quote, unquote
from urllib.request import Request, urlopen

from flask import Flask, Response

app = Flask(__name__)

API_BASE = "https://timelens.cc"
SITE_BASE = "https://laitest.tech"
FALLBACK_IMAGE = f"{SITE_BASE}/img/og-cover.png"
ACCOUNT_NAMES = {"xiaoliang": "小梁游记", "mingjin": "铭锦数智"}


def _api(path: str) -> dict:
    req = Request(f"{API_BASE}{path}", headers={"User-Agent": "Luckline-Content/1.0"})
    with urlopen(req, timeout=6) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if int(payload.get("code", 0)) != 0:
        raise RuntimeError(payload.get("message") or "内容服务不可用")
    return payload.get("data") or {}


def _safe_url(value: object, fallback: str = "") -> str:
    raw = str(value or "").strip()
    return raw if raw.startswith(("https://", "http://", "/")) else fallback


def _inline_markdown(value: str) -> str:
    escaped = html.escape(value)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"\*(.+?)\*", r"<em>\1</em>", escaped)

    def link(match: re.Match) -> str:
        label, url = match.group(1), html.unescape(match.group(2))
        safe = _safe_url(url)
        return f'<a href="{html.escape(safe, quote=True)}" rel="nofollow noopener">{label}</a>' if safe else label

    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, escaped)


def _markdown_html(value: str) -> str:
    output: list[str] = []
    paragraph: list[str] = []
    in_list = False

    def flush() -> None:
        nonlocal paragraph
        if paragraph:
            output.append(f"<p>{_inline_markdown(' '.join(paragraph))}</p>")
            paragraph = []

    for raw in value.replace("\r\n", "\n").split("\n"):
        line = raw.strip()
        if not line:
            flush()
            if in_list:
                output.append("</ul>")
                in_list = False
            continue
        heading = re.match(r"^(#{1,3})\s+(.+)$", line)
        if heading:
            flush()
            if in_list:
                output.append("</ul>")
                in_list = False
            level = min(3, len(heading.group(1)) + 1)
            output.append(f"<h{level}>{_inline_markdown(heading.group(2))}</h{level}>")
            continue
        item = re.match(r"^[-*]\s+(.+)$", line)
        if item:
            flush()
            if not in_list:
                output.append("<ul>")
                in_list = True
            output.append(f"<li>{_inline_markdown(item.group(1))}</li>")
            continue
        if line.startswith(">"):
            flush()
            output.append(f"<blockquote>{_inline_markdown(line[1:].strip())}</blockquote>")
            continue
        paragraph.append(line)
    flush()
    if in_list:
        output.append("</ul>")
    return "".join(output)


class _SafeHtml(HTMLParser):
    allowed = {"p", "h2", "h3", "ul", "ol", "li", "strong", "b", "em", "i", "blockquote", "br"}

    def __init__(self) -> None:
        super().__init__()
        self.output: list[str] = []
        self.suppressed = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "iframe", "object"}:
            self.suppressed += 1
            return
        if self.suppressed:
            return
        if tag in self.allowed:
            self.output.append(f"<{tag}>")
        elif tag == "a":
            href = _safe_url(dict(attrs).get("href"))
            if href:
                self.output.append(f'<a href="{html.escape(href, quote=True)}" rel="nofollow noopener">')

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "iframe", "object"} and self.suppressed:
            self.suppressed -= 1
            return
        if self.suppressed:
            return
        if tag in self.allowed or tag == "a":
            self.output.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if not self.suppressed:
            self.output.append(html.escape(data))


def _content_html(value: object) -> str:
    content = str(value or "").strip()
    if re.search(r"<(?:p|h[1-6]|ul|ol|blockquote)\b", content, re.I):
        parser = _SafeHtml()
        parser.feed(content)
        return "".join(parser.output)
    return _markdown_html(content)


def _date(value: object) -> str:
    raw = str(value or "")
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).strftime("%Y年%m月%d日")
    except ValueError:
        return raw[:10]


def _shell(*, title: str, description: str, canonical: str, body: str, image: str = FALLBACK_IMAGE, schema: dict | None = None) -> str:
    structured = (
        f'<script type="application/ld+json">{json.dumps(schema, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")}</script>'
        if schema else ""
    )
    return f"""<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(description, quote=True)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="{html.escape(canonical, quote=True)}">
<meta property="og:type" content="article"><meta property="og:title" content="{html.escape(title, quote=True)}">
<meta property="og:description" content="{html.escape(description, quote=True)}">
<meta property="og:image" content="{html.escape(image, quote=True)}"><meta property="og:url" content="{html.escape(canonical, quote=True)}">
<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#173f38">
{structured}<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/content-articles.css?v=2"><link rel="stylesheet" href="/css/product-nav.css?v=4">
</head><body>{body}<script src="/product-nav.js?v=6"></script><script defer src="/site-analytics.js"></script></body></html>"""


def _header() -> str:
    return """<header class="content-nav unified-nav" data-product="luckline">
    <a class="content-brand" href="/"><span>L</span><div><b>Luckline</b><small>CONTENT ARCHIVE</small></div></a>
    <nav><a href="/content">原创文章</a></nav>
    </header>"""


@app.get("/content")
@app.get("/articles")
def article_index() -> Response:
    try:
        data = _api("/api/content/posts?page=1&pageSize=100")
        posts = data.get("list") or []
    except Exception:
        posts = []
    valid_posts = [post for post in posts if post.get("slug")]
    cards = "".join(
        f"""<article class="content-card{' content-card-featured' if index == 0 else ''}"><a href="/articles/{quote(str(post.get('slug') or ''))}">
        <div class="content-card-top"><span>{html.escape(ACCOUNT_NAMES.get(str(post.get('accountKey')), str(post.get('accountKey') or 'Luckline')))}</span><time>{_date(post.get('publishedAt'))}</time></div>
        <div class="content-card-copy"><small>{'FEATURED STORY' if index == 0 else f'NOTE {index + 1:02d}'}</small>
        <h2>{html.escape(str(post.get('title') or '未命名文章'))}</h2>
        <p>{html.escape(str(post.get('summary') or '打开查看完整内容。'))}</p></div>
        <div class="content-card-foot"><b>阅读全文</b><i aria-hidden="true">↗</i></div></a></article>"""
        for index, post in enumerate(valid_posts)
    )
    if not cards:
        cards = '<div class="content-empty"><h2>内容正在整理中</h2><p>龙虾运营产物会陆续沉淀到这里。</p></div>'
    body = (
        _header()
        + '<main class="content-index"><section class="content-hero"><div><span>LUCKLINE · CONTENT</span>'
        '<h1>持续创作，<br>持续沉淀。</h1><p>这里收录小梁游记与铭锦数智持续发布的原创文章，记录旅行见闻、产品实践与数字生活。</p>'
        '<div class="content-hero-actions"><a href="#latest">阅读最新原创 ↓</a><a href="/">返回个人站</a></div></div>'
        f'<aside><small>CONTENT SYSTEM</small><strong>{len(valid_posts):02d}</strong><p>篇原创文章</p><div><span>原创</span><span>方法</span><span>资源</span></div></aside></section>'
        f'<section id="latest" class="content-feed-head"><div><span>LATEST STORIES</span><h2>最新发布</h2></div><p>由内容运营系统自动归档，持续更新。</p></section>'
        f'<section class="content-grid">{cards}</section></main>'
        '<footer class="content-footer"><div><b>Luckline</b><span>产品、技术与生活的长期记录。</span></div><nav><a href="/">个人站</a><a href="/content">原创文章</a></nav></footer>'
    )
    return Response(
        _shell(
            title="Luckline 原创文章｜旅行见闻、产品实践与数字生活",
            description="Luckline 原创内容归档，持续收录旅行见闻、产品实践与数字生活文章。",
            canonical=f"{SITE_BASE}/content",
            body=body,
        ),
        content_type="text/html; charset=utf-8",
        headers={"Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600"},
    )


@app.get("/articles/<slug>")
def article_detail(slug: str) -> Response:
    slug = unquote(slug)
    try:
        post = _api(f"/api/content/posts/{quote(slug)}")
    except HTTPError as error:
        if error.code == 404:
            return Response('<meta name="robots" content="noindex"><h1>文章不存在</h1>', status=404, content_type="text/html; charset=utf-8")
        raise
    except Exception:
        return Response('<meta name="robots" content="noindex"><h1>文章暂时无法访问</h1>', status=503, content_type="text/html; charset=utf-8")
    title = str(post.get("title") or "Luckline 文章")
    description = str(post.get("summary") or title)[:160]
    canonical = f"{SITE_BASE}/articles/{quote(slug)}"
    image = _safe_url(post.get("coverImage"), FALLBACK_IMAGE)
    account = ACCOUNT_NAMES.get(str(post.get("accountKey")), str(post.get("accountKey") or "Luckline"))
    original = _safe_url(post.get("platformUrl"))
    original_link = f'<a class="content-source" href="{html.escape(original, quote=True)}" rel="nofollow noopener">查看平台原文 ↗</a>' if original else ""
    body = (
        _header()
        + f"""<main class="article-page"><article>
        <header class="article-head"><span>{html.escape(account)} · {_date(post.get('publishedAt'))}</span>
        <h1>{html.escape(title)}</h1><p>{html.escape(description)}</p></header>
        {f'<img class="article-cover" src="{html.escape(image, quote=True)}" alt="{html.escape(title, quote=True)}">' if post.get('coverImage') else ''}
        <div class="article-body">{_content_html(post.get('content'))}</div>
        <footer class="article-foot">{original_link}<a href="/content">返回内容中心</a></footer>
        </article><aside class="article-cta"><span>TIME TO GO</span><h2>把旅行灵感变成真正的路线</h2>
        <p>在时光智行查看公开路线，或进入微信小程序继续规划。</p><a href="/travel/hangzhou">查看旅行路线 →</a></aside></main>"""
    )
    schema = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": title,
        "description": description,
        "image": [image],
        "datePublished": str(post.get("publishedAt") or "")[:10],
        "dateModified": str(post.get("updatedAt") or "")[:10],
        "author": {"@type": "Organization", "name": account},
        "publisher": {"@type": "Organization", "name": "Luckline", "url": SITE_BASE},
        "mainEntityOfPage": canonical,
    }
    if not schema["datePublished"]:
        schema.pop("datePublished")
    if not schema["dateModified"]:
        schema.pop("dateModified")
    return Response(
        _shell(title=f"{title}｜{account} · Luckline", description=description, canonical=canonical, body=body, image=image, schema=schema),
        content_type="text/html; charset=utf-8",
        headers={"Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600"},
    )


@app.get("/articles-sitemap.xml")
def article_sitemap() -> Response:
    try:
        posts = (_api("/api/content/posts?page=1&pageSize=100").get("list") or [])
    except Exception:
        posts = []
    urls = [f"<url><loc>{SITE_BASE}/content</loc></url>"]
    for post in posts:
        slug = str(post.get("slug") or "")
        if not slug:
            continue
        lastmod = str(post.get("updatedAt") or post.get("publishedAt") or "")[:10]
        urls.append(
            f"<url><loc>{SITE_BASE}/articles/{html.escape(quote(slug))}</loc>"
            f"{f'<lastmod>{html.escape(lastmod)}</lastmod>' if lastmod else ''}</url>"
        )
    xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(urls) + "</urlset>"
    return Response(xml, content_type="application/xml; charset=utf-8", headers={"Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400"})
