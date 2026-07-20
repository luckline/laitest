from pathlib import Path
import os
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from laitest.ai import SuggestedCase, _deepseek_generate_cases, _json_loads_loose


valid = _json_loads_loose('{"cases": [{"title": "登录成功"}]}')
assert valid["cases"][0]["title"] == "登录成功"

missing_comma = """{
  "cases": [{
    "title": "登录成功"
    "priority": "P0",
    "automation_candidate": true
  }]
}"""
repaired = _json_loads_loose(missing_comma)
assert repaired["cases"][0]["priority"] == "P0"
assert repaired["cases"][0]["automation_candidate"] is True

trailing_comma = _json_loads_loose('{"cases": [{"title": "边界值",}],}')
assert trailing_comma["cases"][0]["title"] == "边界值"

requests = []


def fake_request(body, **_kwargs):
    requests.append(body)
    return "{}"


generated = SuggestedCase(
    title="登录成功",
    description="验证主流程",
    tags=["functional"],
    kind="functional",
    spec={
        "case_id": "TC-LOGIN-001",
        "module": "登录",
        "priority": "P0",
        "preconditions": ["登录页可访问"],
        "steps": [{"step_no": 1, "action": "点击登录", "test_data": "无", "expected_result": "进入首页"}],
        "expected_result": "进入首页",
        "assertions": [{"type": "url_contains", "value": "/home"}],
    },
)

with patch.dict(
    os.environ,
    {
        "DEEPSEEK_API_KEY": "test-key",
        "DEEPSEEK_MAX_TOKENS": "1000",
        "DEEPSEEK_MAX_CASES": "1",
        "DEEPSEEK_PARSE_RETRIES": "1",
    },
    clear=False,
), patch("laitest.ai._deepseek_request_chat_completion", side_effect=fake_request), patch(
    "laitest.ai._parse_deepseek_response_cases", side_effect=[RuntimeError("bad json"), [generated]]
), patch("laitest.ai.time.sleep", return_value=None):
    rows = _deepseek_generate_cases("用户使用手机号和密码登录")

assert rows
assert requests[0]["response_format"] == {"type": "json_object"}
assert requests[0]["max_tokens"] == 1000
assert requests[1]["max_tokens"] == 1350

print("DeepSeek JSON recovery: OK")
