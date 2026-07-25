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
<link rel="stylesheet" href="/css/content-articles.css?v=4"><link rel="stylesheet" href="/css/product-nav.css?v=6"><link rel="stylesheet" href="/css/site-density.css?v=2">
</head><body>{body}<script src="/product-nav.js?v=8"></script><script defer src="/site-analytics.js"></script></body></html>"""


def _header() -> str:
    return """<header class="content-nav unified-nav" data-product="luckline">
    <a class="content-brand" href="/"><span>L</span><div><b>Luckline</b><small>laitest.tech</small></div></a>
    <nav><a href="/">首页</a><a href="/#projects">作品</a><a href="/#content">内容</a><a href="/#about">关于</a></nav>
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
    featured = valid_posts[0] if valid_posts else None
    featured_html = ""
    if featured:
        featured_account = ACCOUNT_NAMES.get(str(featured.get("accountKey")), str(featured.get("accountKey") or "Luckline"))
        featured_html = f"""<article class="journal-feature"><a href="/articles/{quote(str(featured.get('slug')))}">
        <div class="journal-feature-number">01</div><div class="journal-feature-copy">
        <div class="journal-meta"><span>FEATURED · {html.escape(featured_account)}</span><time>{_date(featured.get('publishedAt'))}</time></div>
        <h2>{html.escape(str(featured.get('title') or '未命名文章'))}</h2>
        <p>{html.escape(str(featured.get('summary') or '打开查看完整内容。'))}</p><b>阅读这篇文章 <i>↗</i></b></div></a></article>"""
    archive = "".join(
        f"""<article class="journal-row"><a href="/articles/{quote(str(post.get('slug')))}">
        <span>{index + 2:02d}</span><div><small>{html.escape(ACCOUNT_NAMES.get(str(post.get('accountKey')), str(post.get('accountKey') or 'Luckline')))} · {_date(post.get('publishedAt'))}</small>
        <h3>{html.escape(str(post.get('title') or '未命名文章'))}</h3><p>{html.escape(str(post.get('summary') or '打开查看完整内容。'))}</p></div><i>↗</i></a></article>"""
        for index, post in enumerate(valid_posts[1:])
    )
    if not featured_html:
        featured_html = '<div class="content-empty"><h2>内容正在整理中</h2><p>原创文章会从内容运营系统自动归档到这里。</p></div>'
    archive_html = archive or '<p class="journal-awaiting">下一篇文章正在路上。</p>'
    body = (
        _header()
        + '<main class="content-index journal-index"><section class="journal-masthead"><div><span>LUCKLINE JOURNAL</span>'
        '<h1>在产品之外，<br>记录真实世界。</h1><p>旅行见闻、产品实践与数字生活。独立写作，也由内容系统持续归档。</p></div>'
        f'<aside><small>ARCHIVE</small><strong>{len(valid_posts):02d}</strong><span>篇原创</span><p>小梁游记 × 铭锦数智</p></aside></section>'
        '<nav class="journal-topics" aria-label="内容主题"><span>主题</span><a href="#latest">全部文章</a><i>旅行见闻</i><i>产品实践</i><i>数字生活</i></nav>'
        f'<section id="latest" class="journal-section-head"><div><span>EDITOR’S PICK</span><h2>本期推荐</h2></div><p>最近更新</p></section>{featured_html}'
        f'<section class="journal-section-head journal-archive-head"><div><span>THE ARCHIVE</span><h2>全部文章</h2></div><p>按发布时间倒序</p></section>'
        f'<section class="journal-list">{archive_html}</section>'
        '<section class="journal-products"><div><span>FROM IDEAS TO PRODUCTS</span><h2>阅读之后，继续动手。</h2></div>'
        '<a href="/mingtest"><small>QUALITY</small><b>铭测 MingTest</b><p>AI 测试设计与自动化执行</p><i>→</i></a>'
        '<a href="/timelens"><small>TRAVEL</small><b>时光智行</b><p>路线规划与城市足迹</p><i>→</i></a></section></main>'
        '<footer class="content-footer"><div><b>Luckline Journal</b><span>产品、技术与生活的长期记录。</span></div><nav><a href="/">个人站</a><a href="/#content">首页文章</a></nav></footer>'
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
    cover_image = _safe_url(post.get("coverImage"))
    image = cover_image or FALLBACK_IMAGE
    account = ACCOUNT_NAMES.get(str(post.get("accountKey")), str(post.get("accountKey") or "Luckline"))
    original = _safe_url(post.get("platformUrl"))
    original_link = f'<a class="content-source" href="{html.escape(original, quote=True)}" rel="nofollow noopener">查看平台原文 ↗</a>' if original else ""
    content = str(post.get("content") or "")
    reading_minutes = max(1, round(len(re.sub(r"<[^>]+>", "", content)) / 500))
    try:
        related_posts = [
            item for item in (_api("/api/content/posts?page=1&pageSize=6").get("list") or [])
            if item.get("slug") and item.get("slug") != slug
        ][:2]
    except Exception:
        related_posts = []
    related = "".join(
        f'<a href="/articles/{quote(str(item.get("slug")))}"><span>{_date(item.get("publishedAt"))}</span>'
        f'<b>{html.escape(str(item.get("title") or "未命名文章"))}</b><i>继续阅读 →</i></a>'
        for item in related_posts
    )
    related_section = (
        f'<section class="article-related"><header><span>MORE FROM LUCKLINE</span><h2>继续阅读</h2></header><div>{related}</div></section>'
        if related else ""
    )
    is_travel = str(post.get("contentType")) == "travel-note"
    product_name = "时光智行" if is_travel else "铭测 MingTest"
    product_title = "把旅行灵感变成真正的路线" if is_travel else "把方法变成可执行的测试资产"
    product_copy = "规划路线、管理清单，也记录每一次真实出发。" if is_travel else "从需求分析到用例设计，再到自动化执行与证据留存。"
    product_href = "/timelens" if is_travel else "/mingtest"
    body = (
        _header()
        + f"""<main class="article-page"><article>
        <header class="article-head"><span>{html.escape(account)} · {_date(post.get('publishedAt'))}</span>
        <h1>{html.escape(title)}</h1><p>{html.escape(description)}</p></header>
        <div class="article-meta"><span>原创文章</span><span>约 {reading_minutes} 分钟阅读</span></div>
        {f'<img class="article-cover" src="{html.escape(cover_image, quote=True)}" alt="{html.escape(title, quote=True)}">' if cover_image else ''}
        <div class="article-body">{_content_html(content)}</div>
        <footer class="article-foot">{original_link}<a href="/content">返回内容中心</a></footer>
        {related_section}</article><aside class="article-side">
        <section class="article-cta"><span>FROM READING TO DOING</span><small>{product_name}</small>
        <h2>{product_title}</h2><p>{product_copy}</p><a href="{product_href}">进入产品 →</a>
        <footer><a href="/">返回个人主页</a><a href="/#content">查看首页文章</a></footer></section>
        <section class="article-wechat"><img src="/img/qrcode_laitest.jpg" alt="小梁游记微信公众号二维码">
        <div><span>WECHAT</span><b>关注「小梁游记」</b><p>扫码关注，继续阅读旅行见闻与城市故事。</p></div></section></aside></main>"""
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
