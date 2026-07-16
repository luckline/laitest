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
FALLBACK_IMAGE = f"{SITE_BASE}/img/timelens-miniapp.jpg"
BUILTINS = {
    "hangzhou": {"title": "西湖城市漫游周末线", "destination": "杭州", "notes": "把湖滨散步、宋韵街区和咖啡慢游串成一条节奏舒服的两天一夜路线。", "coverImage": "https://timelens.cc/images/official-changping.jpg"},
    "xiamen": {"title": "海风疗愈三日轻旅行", "destination": "厦门", "notes": "把鼓浪屿、海岸线和夜晚海风都装进一趟轻盈旅行。", "coverImage": "https://timelens.cc/images/official-city-night.jpg"},
    "dali": {"title": "苍洱之间的慢节奏假期", "destination": "大理", "notes": "从古城到洱海，把风景、轻徒步与发呆时间都纳入路线安排。", "coverImage": "https://timelens.cc/images/official-family-coast.jpg"},
}


def _route_data(route_id: str) -> dict:
    if route_id in BUILTINS:
        return BUILTINS[route_id]
    if not route_id:
        return {}
    try:
        req = Request(f"{API_BASE}/api/trips/public/{quote(route_id)}", headers={"User-Agent": "TimeLens-Share/1.0"})
        with urlopen(req, timeout=4) as res:
            payload = json.loads(res.read().decode("utf-8"))
        root = payload.get("data") or payload.get("result") or payload
        return root.get("trip") or root.get("routeCollection") or root.get("route_collection") or root
    except Exception:
        return {}


def _meta(name: str, value: str, *, prop: bool = False) -> str:
    key = "property" if prop else "name"
    return f'<meta {key}="{name}" content="{html.escape(value, quote=True)}">'


@app.get("/")
@app.get("/timelens-route")
def share_page() -> Response:
    route_id = request.args.get("id", "").strip()
    trip = _route_data(route_id)
    title = str(trip.get("title") or "一条值得出发的旅行路线")
    destination = str(trip.get("destination") or "精选目的地")
    summary = str(trip.get("notes") or trip.get("summary") or "查看完整逐日路线，收藏灵感，准备下一次出发。")
    summary = " ".join(summary.split())[:110]
    image = str(trip.get("coverImage") or trip.get("cover_image") or trip.get("routeImageUrl") or trip.get("route_image_url") or FALLBACK_IMAGE)
    url = f"{SITE_BASE}/timelens-route?id={quote(route_id)}" if route_id else f"{SITE_BASE}/timelens-route"
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "timelens-route.html")
    with open(path, "r", encoding="utf-8") as f:
        page = f.read()
    page_title = f"{title}｜{destination}旅行路线 · 时光智行"
    page = page.replace("<title>路线详情 · 时光智行</title>", f"<title>{html.escape(page_title)}</title>")
    page = page.replace('<meta name="description" content="查看并分享时光智行旅行路线合集。">', _meta("description", summary))
    page = page.replace('<meta property="og:title" content="路线详情 · 时光智行">', _meta("og:title", page_title, prop=True))
    page = page.replace('<meta property="og:description" content="查看完整逐日路线，扫码收藏并继续规划旅程。">', _meta("og:description", summary, prop=True))
    page = page.replace('<meta property="og:image" content="https://laitest.tech/img/timelens-miniapp.jpg">', _meta("og:image", image, prop=True))
    extras = "".join([
        _meta("og:type", "article", prop=True), _meta("og:url", url, prop=True),
        _meta("og:site_name", "时光智行 TimeLens", prop=True), _meta("twitter:title", page_title),
        _meta("twitter:description", summary), _meta("twitter:image", image),
        f'<link rel="canonical" href="{html.escape(url, quote=True)}">',
    ])
    page = page.replace('<meta name="twitter:card" content="summary_large_image">', '<meta name="twitter:card" content="summary_large_image">' + extras)
    return Response(page, content_type="text/html; charset=utf-8", headers={"Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600"})
