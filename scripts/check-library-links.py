#!/usr/bin/env python3
"""Check generated public-library links without changing the data."""
import json
import re
import ssl
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else "library-data.js")
OUTPUT = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/library-link-results.json")
TIMEOUT = 12

payload = json.loads(re.match(r"window\.LUCKLINE_LIBRARY = (.*);\s*$", SOURCE.read_text(), re.S).group(1))
context = ssl.create_default_context()
headers = {"User-Agent": "Mozilla/5.0 (compatible; LucklineLinkCheck/1.0; +https://laitest.tech/library)", "Accept": "text/html,*/*;q=0.8"}

def check(item):
    request = urllib.request.Request(item["url"], headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT, context=context) as response:
            response.read(1024)
            return {"id": item["id"], "url": item["url"], "title": item["title"], "status": response.status, "final_url": response.url, "error": None}
    except urllib.error.HTTPError as error:
        return {"id": item["id"], "url": item["url"], "title": item["title"], "status": error.code, "final_url": error.url, "error": f"HTTP {error.code}"}
    except Exception as error:
        return {"id": item["id"], "url": item["url"], "title": item["title"], "status": None, "final_url": None, "error": f"{type(error).__name__}: {error}"}

results = []
with ThreadPoolExecutor(max_workers=12) as pool:
    futures = [pool.submit(check, item) for item in payload["items"]]
    for future in as_completed(futures):
        result = future.result(); results.append(result)
        print(f'{result["id"]:>3} {str(result["status"]):>4} {result["url"]}', flush=True)

results.sort(key=lambda item: item["id"])
OUTPUT.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
print(f"Saved {len(results)} results to {OUTPUT}")
