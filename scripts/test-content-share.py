import json
import re
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch

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
        match = re.search(r'<script type="application/ld\+json">(.*?)</script>', page)
        self.assertIsNotNone(match)
        self.assertEqual(json.loads(match.group(1))["@type"], "Article")

    def test_article_index_links_to_detail(self):
        with patch.object(content_share, "_api", side_effect=self.fake_api):
            response = self.client.get("/articles")

        self.assertEqual(response.status_code, 200)
        self.assertIn('/articles/hangzhou-weekend-demo', response.get_data(as_text=True))

    def test_article_sitemap_is_valid(self):
        with patch.object(content_share, "_api", side_effect=self.fake_api):
            response = self.client.get("/articles-sitemap.xml")

        self.assertEqual(response.status_code, 200)
        ET.fromstring(response.data)
        self.assertIn(b"/articles/hangzhou-weekend-demo", response.data)

    def test_html_content_drops_scripts(self):
        output = content_share._content_html("<p>正常正文</p><script>alert(1)</script>")

        self.assertIn("<p>正常正文</p>", output)
        self.assertNotIn("<script>", output)
        self.assertNotIn("alert(1)", output)


if __name__ == "__main__":
    unittest.main()
