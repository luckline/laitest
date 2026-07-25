import argparse
import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "integrations" / "openclaw" / "sync_to_laitest.py"
SPEC = importlib.util.spec_from_file_location("sync_to_laitest", MODULE_PATH)
sync_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync_module)


class OpenClawSyncTest(unittest.TestCase):
    def args(self):
        return argparse.Namespace(
            account="xiaoliang",
            platform="wechat",
            external_id="media-1",
            platform_url="",
            content_type="travel-note",
            status="published",
        )

    def test_three_article_payload_is_expanded(self):
        rows = sync_module.rows_from({"articles": [{"title": "A"}, {"title": "B"}, {"title": "C"}]})

        self.assertEqual(len(rows), 3)

    def test_normalize_accepts_generator_field_aliases(self):
        payload = sync_module.normalize(
            {
                "headline": "杭州两日游",
                "article": "完整正文",
                "digest": "摘要",
                "thumb_url": "https://example.com/cover.jpg",
                "tags": ["杭州", "周末"],
            },
            self.args(),
            0,
        )

        self.assertEqual(payload["externalId"], "media-1-1")
        self.assertEqual(payload["title"], "杭州两日游")
        self.assertEqual(payload["content"], "完整正文")
        self.assertEqual(payload["contentType"], "travel-note")
        self.assertEqual(payload["keywords"], ["杭州", "周末"])


if __name__ == "__main__":
    unittest.main()
