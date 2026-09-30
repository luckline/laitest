import json
import re
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from api import content_share


POST = {
    "id": "post_1",
    "accountKey": "xiaoliang",
    "platform": "wechat",
    "contentType": "travel-note",
    "title": "杭州周末两日游",
    "slug": "hangzhou-weekend-demo",
    "summary": "第一次去杭州也能轻松照着走的路线。",
    "content": "## 第一天\n\n- 西湖散步\n- 河坊街\n\n> 出发前记得查看天气。",
    "coverImage": "https://example.com/hangzhou.jpg",
    "platformUrl": "https://mp.weixin.qq.com/example",
    "publishedAt": "2026-07-25T09:00:00+08:00",
    "updatedAt": "2026-07-25T09:00:00+08:00",
}


class ContentShareTest(unittest.TestCase):
    def setUp(self):
        self.client = content_share.app.test_client()

    def fake_api(self, path):
        return {"list": [POST], "total": 1} if path.startswith("/api/content/posts?") else POST

    def test_article_is_server_rendered_and_indexable(self):
        with patch.object(content_share, "_api", side_effect=self.fake_api):
            response = self.client.get("/articles/hangzhou-weekend-demo")
        page = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 200)
        self.assertIn("<h1>杭州周末两日游</h1>", page)
        self.assertIn("<h3>第一天</h3>", page)
        self.assertIn("<li>西湖散步</li>", page)
        self.assertIn('rel="canonical" href="https://laitest.tech/articles/hangzhou-weekend-demo"', page)
        self.assertIn('src="/img/qrcode_laitest.jpg"', page)
        self.assertIn("关注「小梁游记」", page)
        match = re.search(r'<script type="application/ld\+json">(.*?)</script>', page)
        self.assertIsNotNone(match)
        self.assertEqual(json.loads(match.group(1))["@type"], "Article")

    def test_encoded_chinese_slug_is_not_double_encoded(self):
        with patch.object(content_share, "_api", return_value=POST) as api:
            response = self.client.get("/articles/%25E6%25B5%258B%25E8%25AF%2595")

        self.assertEqual(response.status_code, 200)
        api.assert_any_call("/api/content/posts/%E6%B5%8B%E8%AF%95")

    def test_wechat_media_id_is_not_rendered_as_cover(self):
        post = {**POST, "coverImage": "QbtLpkGH1zF1DAYHXNfjuvxhTT6IQVnQ2N1ITP8KcX94"}
        with patch.object(content_share, "_api", return_value=post):
            response = self.client.get("/articles/hangzhou-weekend-demo")

        page = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('class="article-cover"', page)
        self.assertNotIn('src="https://laitest.tech/img/og-cover.png"', page)

    def test_article_index_links_to_detail(self):
        with patch.object(content_share, "_api", side_effect=self.fake_api):
            response = self.client.get("/content")

        self.assertEqual(response.status_code, 200)
        self.assertIn('/articles/hangzhou-weekend-demo', response.get_data(as_text=True))
        self.assertIn('rel="canonical" href="https://laitest.tech/content"', response.get_data(as_text=True))
        self.assertNotIn("测试方法", response.get_data(as_text=True))
        self.assertNotIn("资源收藏", response.get_data(as_text=True))

    def test_article_sitemap_is_valid(self):
        with patch.object(content_share, "_api", side_effect=self.fake_api):
            response = self.client.get("/articles-sitemap.xml")

        self.assertEqual(response.status_code, 200)
        ET.fromstring(response.data)
        self.assertIn(b"/articles/hangzhou-weekend-demo", response.data)

    def paginated_api(self, path):
        params = parse_qs(urlparse(path).query)
        page = int(params.get("page", [1])[0])
        size = int(params.get("pageSize", [100])[0])
        posts = [{**POST, "slug": f"article-{i:03d}", "contentType": "travel-note" if i % 2 else "tech-note"} for i in range(170)]
        return {"list": posts[(page - 1) * size:page * size], "total": len(posts)}

    def test_all_articles_are_reachable_across_pages(self):
        slugs = []
        with patch.object(content_share, "_api", side_effect=self.paginated_api):
            for page in range(1, 16):
                response = self.client.get(f"/content?page={page}")
                self.assertEqual(response.status_code, 200)
                body = response.get_data(as_text=True)
                current = re.findall(r'href="/articles/(article-\d+)"', body)
                self.assertLessEqual(len(current), 12)
                slugs.extend(current)
                self.assertIn('<strong>170</strong>', body)
                if page < 15:
                    self.assertIn(f'rel="next" href="/content?page={page + 1}"', body)
                else:
                    self.assertNotIn('rel="next"', body)
                if page > 1:
                    self.assertIn(f'rel="canonical" href="https://laitest.tech/content?page={page}"', body)
        self.assertEqual(len(slugs), 170)
        self.assertEqual(len(set(slugs)), 170)

    def test_topic_filter_persists_when_paginating(self):
        with patch.object(content_share, "_api", side_effect=self.paginated_api):
            response = self.client.get("/content?topic=travel-note&page=2")
        body = response.get_data(as_text=True)
        self.assertIn("共 85 篇", body)
        self.assertIn('href="/content?topic=travel-note&amp;page=3"', body)
        self.assertIn('href="/content?topic=travel-note" aria-current="page"', body)
        slugs = re.findall(r'href="/articles/article-(\d+)"', body)
        self.assertEqual(len(slugs), 12)
        self.assertTrue(all(int(slug) % 2 for slug in slugs))

    def test_sitemap_includes_articles_beyond_first_hundred(self):
        with patch.object(content_share, "_api", side_effect=self.paginated_api):
            response = self.client.get("/articles-sitemap.xml")
        root = ET.fromstring(response.data)
        self.assertEqual(len(root), 171)
        self.assertIn(b"/articles/article-169", response.data)

    def test_missing_and_invalid_pages(self):
        with patch.object(content_share, "_api", side_effect=self.paginated_api):
            for url in ["/content?page=0", "/content?page=oops", "/content?topic=invalid"]:
                self.assertEqual(self.client.get(url).status_code, 400)
            self.assertEqual(self.client.get("/content?page=16").status_code, 404)

    def test_partial_upstream_failure_does_not_publish_incomplete_archive(self):
        first = self.paginated_api("/api/content/posts?page=1&pageSize=100")
        for url in ["/content", "/articles-sitemap.xml"]:
            with patch.object(content_share, "_api", side_effect=[first, RuntimeError("unavailable")]):
                response = self.client.get(url)
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_repeated_upstream_page_does_not_loop_or_look_complete(self):
        first = self.paginated_api("/api/content/posts?page=1&pageSize=100")
        with patch.object(content_share, "_api", return_value=first) as api:
            response = self.client.get("/content")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(api.call_count, 2)

    def test_html_content_drops_scripts(self):
        output = content_share._content_html("<p>正常正文</p><script>alert(1)</script>")

        self.assertIn("<p>正常正文</p>", output)
        self.assertNotIn("<script>", output)
        self.assertNotIn("alert(1)", output)


if __name__ == "__main__":
    unittest.main()
