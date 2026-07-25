from __future__ import annotations

import html
import json
import os
from urllib.parse import quote
from urllib.request import Request, urlopen

from flask import Flask, Response, request

app = Flask(__name__)

API_BASE = "https://timelens.cc"
SITE_BASE = "https://laitest.tech"
FALLBACK_IMAGE = f"{SITE_BASE}/img/timelens-route-fallback.jpg"
BUILTINS = {
    "hangzhou": {"title": "西湖城市漫游周末线", "destination": "杭州", "notes": "把湖滨散步、宋韵街区和咖啡慢游串成一条节奏舒服的两天一夜路线。", "coverImage": "https://timelens.cc/images/official-changping.jpg"},
    "xiamen": {"title": "海风疗愈三日轻旅行", "destination": "厦门", "notes": "把鼓浪屿、海岸线和夜晚海风都装进一趟轻盈旅行。", "coverImage": "https://timelens.cc/images/official-city-night.jpg"},
    "dali": {"title": "苍洱之间的慢节奏假期", "destination": "大理", "notes": "从古城到洱海，把风景、轻徒步与发呆时间都纳入路线安排。", "coverImage": "https://timelens.cc/images/official-family-coast.jpg"},
}


def _route_payload(route_id: str) -> tuple[dict, list[dict]]:
    if route_id in BUILTINS:
        return {"id": route_id, **BUILTINS[route_id]}, []
    if not route_id:
        return {}, []
    try:
        req = Request(f"{API_BASE}/api/trips/public/{quote(route_id)}", headers={"User-Agent": "TimeLens-Share/1.0"})
        with urlopen(req, timeout=4) as res:
            payload = json.loads(res.read().decode("utf-8"))
        root = payload.get("data") or payload.get("result") or payload
        trip = root.get("trip") or root.get("routeCollection") or root.get("route_collection") or root
        records = root.get("records") or root.get("routeRecords") or root.get("route_records") or []
        return trip if isinstance(trip, dict) else {}, records if isinstance(records, list) else []
    except Exception:
        return {}, []


def _public_routes() -> list[dict]:
    try:
        rows: list[dict] = []
        page = 1
        while page <= 500:
            req = Request(f"{API_BASE}/api/trips/public?page={page}&pageSize=100", headers={"User-Agent": "TimeLens-SEO/1.0"})
            with urlopen(req, timeout=5) as res:
                payload = json.loads(res.read().decode("utf-8"))
            root = payload.get("data") or payload.get("result") or payload
            batch = root.get("list") or root.get("trips") or root.get("items") or []
            if not isinstance(batch, list):
                break
            rows.extend(batch)
            total = int(root.get("total") or len(rows))
            if len(rows) >= total or len(batch) < 100:
                break
            page += 1
        return rows
    except Exception:
        return []


def _meta(name: str, value: str, *, prop: bool = False) -> str:
    key = "property" if prop else "name"
    return f'<meta {key}="{name}" content="{html.escape(value, quote=True)}">'


def _date(value: object) -> str:
    return html.escape(str(value or "")[:10])


def _safe_image(value: object) -> str:
    raw = str(value or FALLBACK_IMAGE).strip()
    if not raw.startswith(("https://", "http://", "/")):
        return FALLBACK_IMAGE
    return raw.replace("'", "%27").replace(")", "%29")


def _server_content(trip: dict, records: list[dict]) -> str:
    title = html.escape(str(trip.get("title") or "旅行路线"))
    destination = html.escape(str(trip.get("destination") or "精选目的地"))
    summary = html.escape(str(trip.get("notes") or trip.get("summary") or "一条值得收藏的旅行路线。"))
    cover = html.escape(_safe_image(trip.get("coverImage") or trip.get("cover_image") or trip.get("routeImageUrl") or trip.get("route_image_url")), quote=True)
    date = _date(trip.get("startDate") or trip.get("start_date") or trip.get("days") or "随时出发")
    budget = html.escape(str(trip.get("budget") or "预算灵活"))
    timeline = "".join(
        f'<article class="day-record"><time><b>DAY {index:02d}</b><br>{_date(record.get("recordDate") or record.get("record_date") or record.get("date"))}</time>'
        f'<div><h2>{html.escape(str(record.get("location") or record.get("title") or "当日行程"))}</h2>'
        f'<p>{html.escape(str(record.get("essay") or record.get("notes") or record.get("content") or "暂无记录说明"))}</p></div></article>'
        for index, record in enumerate(records, 1)
    )
    if not timeline:
        timeline = '<p class="route-seo-empty">这条路线的逐日安排正在整理中，可以先收藏目的地灵感。</p>'
    return (
        f'<article class="route-seo-article">'
        f'<section class="route-hero" style="--cover:url(\'{cover}\')"><div>'
        f'<span class="route-kicker">时光智行目的地路线</span><h1>{title}</h1><p>{destination} · {date}</p></div></section>'
        f'<section class="route-summary"><span class="eyebrow">ROUTE STORY</span><h2>{destination}旅行路线亮点</h2>'
        f'<p>{summary}</p><div class="route-summary-footer"><span class="route-budget">{budget}</span></div></section>'
        f'<div class="route-section-head"><div><span class="eyebrow">DAY BY DAY</span><h2>{destination}逐日行程</h2></div>'
        f'<p>{"共 " + str(len(records)) + " 条路线记录" if records else "路线安排参考"}</p></div>'
        f'<section class="route-timeline">{timeline}</section>'
        f'<section class="route-seo-guide"><h2>如何使用这条路线</h2><p>收藏后可根据出发日期、同行人和预算调整行程。景区开放时间、交通班次和预约要求可能变化，出发前请再次确认。</p></section>'
        f'<nav class="route-seo-links" aria-label="更多旅行路线"><h2>更多热门旅行路线</h2>'
        + "".join(
            f'<a href="/travel/{quote(key)}">{html.escape(str(value["destination"]))}旅行攻略</a>'
            for key, value in BUILTINS.items()
            if str(trip.get("id") or "") != key
        )
        + '</nav>'
        f'</article>'
    )


def _structured_data(trip: dict, records: list[dict], url: str, image: str, summary: str) -> str:
    destination = str(trip.get("destination") or "精选目的地")
    itinerary = [
        {
            "@type": "ListItem",
            "position": index,
            "name": str(record.get("location") or record.get("title") or f"第 {index} 天"),
            "description": str(record.get("essay") or record.get("notes") or record.get("content") or "")[:300],
        }
        for index, record in enumerate(records, 1)
    ]
    data = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Article",
                "@id": f"{url}#article",
                "headline": str(trip.get("title") or f"{destination}旅行路线"),
                "description": summary,
                "image": [image],
                "datePublished": str(trip.get("created_at") or trip.get("createdAt") or "")[:10] or None,
                "dateModified": str(trip.get("updated_at") or trip.get("updatedAt") or "")[:10] or None,
                "author": {"@type": "Organization", "name": "时光智行 TimeLens"},
                "publisher": {"@type": "Organization", "name": "时光智行 TimeLens", "url": SITE_BASE},
                "mainEntityOfPage": url,
                "about": {"@type": "Place", "name": destination},
                "hasPart": {"@type": "ItemList", "name": f"{destination}逐日行程", "itemListElement": itinerary},
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "时光智行", "item": f"{SITE_BASE}/timelens"},
                    {"@type": "ListItem", "position": 2, "name": f"{destination}旅行路线", "item": url},
                ],
            },
        ],
    }
    article = data["@graph"][0]
    if not article["datePublished"]:
        article.pop("datePublished")
    if not article["dateModified"]:
        article.pop("dateModified")
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


@app.get("/")
@app.get("/timelens-route")
@app.get("/travel/<route_id>")
def share_page(route_id: str = "") -> Response:
    route_id = (route_id or request.args.get("id", "")).strip()
    trip, records = _route_payload(route_id)
    if not route_id or not trip:
        return Response(
            '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="robots" content="noindex">'
            '<title>路线不存在 · 时光智行</title></head><body><h1>路线不存在</h1><p><a href="/timelens">返回路线广场</a></p></body></html>',
            status=404,
            content_type="text/html; charset=utf-8",
        )
    title = str(trip.get("title") or "一条值得出发的旅行路线")
    destination = str(trip.get("destination") or "精选目的地")
    raw_summary = " ".join(str(trip.get("notes") or trip.get("summary") or "查看完整逐日路线，收藏灵感，准备下一次出发。").split())
    summary = f"{destination}旅游攻略：{raw_summary}，包含逐日行程、路线亮点和出发建议。"
    summary = summary[:150]
    image = _safe_image(trip.get("coverImage") or trip.get("cover_image") or trip.get("routeImageUrl") or trip.get("route_image_url"))
    url = f"{SITE_BASE}/travel/{quote(route_id)}"
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "timelens-route.html")
    with open(path, "r", encoding="utf-8") as f:
        page = f.read()
    page_title = f"{title}｜{destination}旅游攻略与逐日路线 · 时光智行"
    page = page.replace("<title>路线详情 · 时光智行</title>", f"<title>{html.escape(page_title)}</title>")
    page = page.replace('<meta name="description" content="查看并分享时光智行旅行路线合集。">', _meta("description", summary))
    page = page.replace('<meta property="og:title" content="路线详情 · 时光智行">', _meta("og:title", page_title, prop=True))
    page = page.replace('<meta property="og:description" content="查看完整逐日路线，扫码收藏并继续规划旅程。">', _meta("og:description", summary, prop=True))
    page = page.replace('<meta property="og:image" content="https://laitest.tech/img/timelens-route-fallback.jpg">', _meta("og:image", image, prop=True))
    extras = "".join([
        _meta("robots", "index,follow,max-image-preview:large"),
        _meta("og:type", "article", prop=True), _meta("og:url", url, prop=True),
        _meta("og:site_name", "时光智行 TimeLens", prop=True), _meta("twitter:title", page_title),
        _meta("twitter:description", summary), _meta("twitter:image", image),
        f'<link rel="canonical" href="{html.escape(url, quote=True)}">',
        f'<script type="application/ld+json">{_structured_data(trip, records, url, image, summary)}</script>',
    ])
    page = page.replace('<meta name="twitter:card" content="summary_large_image">', '<meta name="twitter:card" content="summary_large_image">' + extras)
    page = page.replace(
        '<main class="route-main" id="routeContent"><div class="empty"><h2>正在加载路线…</h2><p>逐日行程马上就来。</p></div></main>',
        f'<main class="route-main" id="routeContent">{_server_content(trip, records)}</main>',
    )
    return Response(page, content_type="text/html; charset=utf-8", headers={"Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600"})


@app.get("/timelens-routes-sitemap.xml")
def routes_sitemap() -> Response:
    routes = [{"id": key, **value} for key, value in BUILTINS.items()] + _public_routes()
    seen: set[str] = set()
    urls = []
    for route in routes:
        route_id = str(route.get("id") or "").strip()
        if not route_id or route_id in seen:
            continue
        seen.add(route_id)
        loc = html.escape(f"{SITE_BASE}/travel/{quote(route_id)}")
        lastmod = str(route.get("updated_at") or route.get("updatedAt") or route.get("created_at") or route.get("createdAt") or "")[:10]
        image = str(route.get("coverImage") or route.get("cover_image") or "")
        image_xml = f"<image:image><image:loc>{html.escape(image)}</image:loc></image:image>" if image else ""
        urls.append(f"<url><loc>{loc}</loc>{f'<lastmod>{html.escape(lastmod)}</lastmod>' if lastmod else ''}{image_xml}</url>")
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">'
        + "".join(urls)
        + "</urlset>"
    )
    return Response(body, content_type="application/xml; charset=utf-8", headers={"Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400"})
