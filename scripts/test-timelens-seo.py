import json
import re
import unittest
import xml.etree.ElementTree as ET

from api.timelens_share import app


class TimeLensSeoTest(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_public_route_contains_indexable_content(self):
        response = self.client.get("/travel/hangzhou")
        page = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 200)
        self.assertIn("<h1>西湖城市漫游周末线</h1>", page)
        self.assertIn('rel="canonical" href="https://laitest.tech/travel/hangzhou"', page)
        self.assertIn('name="robots" content="index,follow,max-image-preview:large"', page)
        self.assertNotIn("正在加载路线", page)

        match = re.search(r'<script type="application/ld\+json">(.*?)</script>', page)
        self.assertIsNotNone(match)
        self.assertEqual(json.loads(match.group(1))["@context"], "https://schema.org")

    def test_missing_route_is_a_real_404(self):
        response = self.client.get("/travel/does-not-exist")

        self.assertEqual(response.status_code, 404)
        self.assertIn('name="robots" content="noindex"', response.get_data(as_text=True))

    def test_route_sitemap_uses_canonical_urls(self):
        response = self.client.get("/timelens-routes-sitemap.xml")

        self.assertEqual(response.status_code, 200)
        ET.fromstring(response.data)
        self.assertIn(b"https://laitest.tech/travel/hangzhou", response.data)


if __name__ == "__main__":
    unittest.main()
