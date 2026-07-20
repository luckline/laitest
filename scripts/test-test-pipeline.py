from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from laitest.test_pipeline import PIPELINE_SKILLS, build_pipeline_delivery, compose_pipeline_prompt, run_pipeline_skill


requirement = "用户使用手机号和密码登录，连续失败 5 次后锁定账号"
prompt = compose_pipeline_prompt(
    requirement,
    "standard",
    "锁定 30 分钟，登录成功进入首页",
    "auth service changed",
)
assert "[SDD Spec]" in prompt
assert "[代码 Diff / 影响面线索]" in prompt

delivery = build_pipeline_delivery(
    requirement,
    [
        {
            "case_id": "TC-LOGIN-001",
            "title": "正确密码登录成功",
            "priority": "P0",
            "module": "登录",
            "type": "functional",
            "steps": [{"step_no": 1, "action": "提交登录", "expected_result": "进入首页"}],
            "expected_result": "进入首页",
        }
    ],
    "standard",
    "锁定 30 分钟，登录成功进入首页",
    "auth service changed",
)
assert len(delivery["stages"]) == 6
assert delivery["risk_plan"]["risk_distribution"]["high"] == 1
assert delivery["case_home"]["records"][0]["tags"][:2] == ["AI生成", "STANDARD"]
assert delivery["traceability"][0]["case_ids"] == ["TC-LOGIN-001"]
assert [skill["key"] for skill in PIPELINE_SKILLS] == ["spec", "risk", "split", "dimensions", "cases", "delivery"]
spec_skill = run_pipeline_skill("spec", requirement, [], "standard", "锁定 30 分钟，登录成功进入首页")
assert spec_skill["skill"]["name"] == "需求验证"
assert "score" in spec_skill["artifact"]
delivery_skill = run_pipeline_skill("delivery", requirement, delivery["case_home"]["records"], "standard")
assert delivery_skill["artifact"]["case_home"]["total"] == 1
print("LingTest six-stage pipeline: OK")
