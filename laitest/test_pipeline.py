from __future__ import annotations

import re
from typing import Any, Iterable


PIPELINE_METHODS = ["等价类", "边界值", "判定表", "状态迁移", "场景法", "因果图", "错误推测"]
PIPELINE_SKILLS = [
    {"key": "spec", "name": "需求验证", "method": "完整性、一致性、歧义性与可测试性审查", "input": "需求文档 / SDD", "output": "问题清单与需求质量评分"},
    {"key": "risk", "name": "风险计划", "method": "测试左移、风险分级与 Diff 影响面分析", "input": "已验证需求与代码变更", "output": "范围、风险分布与测试深度"},
    {"key": "split", "name": "需求拆分", "method": "按 server / UI-B / UI-C / 实验灰度分类", "input": "需求与风险计划", "output": "独立可测需求单元"},
    {"key": "dimensions", "name": "覆盖设计", "method": "等价类、边界值、判定表、状态迁移、场景、因果图、错误推测", "input": "需求单元与风险等级", "output": "模块化测试覆盖维度"},
    {"key": "cases", "name": "详细用例", "method": "从覆盖维度展开可直接执行的结构化用例", "input": "覆盖维度与测试数据", "output": "P0/P1/P2 用例与可自动化断言"},
    {"key": "delivery", "name": "交付闭环", "method": "追溯矩阵、差异标记与 Case Home 格式转换", "input": "结构化测试用例", "output": "追溯矩阵与平台 JSON"},
]


def normalize_generation_mode(value: Any) -> str:
    return "standard" if str(value or "").strip().lower() == "standard" else "sketch"


def compose_pipeline_prompt(
    requirement: str,
    mode: str = "sketch",
    sdd_spec: str = "",
    code_diff: str = "",
) -> str:
    mode = normalize_generation_mode(mode)
    sections = [
        f"[领测生成模式] {'Standard（SDD 驱动）' if mode == 'standard' else 'Sketch（轻量需求驱动）'}",
        "[原始需求]",
        requirement.strip(),
    ]
    if mode == "standard":
        sections.extend(["[SDD Spec]", sdd_spec.strip() or "未提供（请将其作为需求质量风险标记，不得擅自补造规则）"])
    if code_diff.strip():
        sections.extend(["[代码 Diff / 影响面线索]", code_diff.strip()])
    sections.extend(
        [
            "[流水线要求]",
            "先完成 Spec 验证与风险分析，再按 server/ui-b/ui-c/experiment 拆分需求；",
            "使用等价类、边界值、判定表、状态迁移、场景法、因果图、错误推测设计覆盖维度；",
            "最终用例必须包含可执行步骤、可观察预期、P0/P1/P2 优先级和需求追溯标识。",
            "严禁把待澄清规则写成确定事实：需求未给出的验证码时长、频控阈值、页面跳转、账号或接口参数必须标记为待确认，不得自行假设具体数值。",
        ]
    )
    return "\n".join(sections)


def _case_dict(item: Any) -> dict[str, Any]:
    if isinstance(item, dict):
        return item
    return {}


def _case_ids(cases: Iterable[Any]) -> list[str]:
    return [str(_case_dict(row).get("case_id") or f"TC-GEN-{idx}") for idx, row in enumerate(cases, start=1)]


def _detect_ends(text: str) -> list[str]:
    low = text.lower()
    ends: list[str] = []
    if any(x in low for x in ["api", "接口", "服务端", "server", "数据库", "消息队列"]):
        ends.append("server")
    if any(x in low for x in ["后台", "管理端", "运营端", "b端", "ui-b"]):
        ends.append("ui-b")
    if any(x in low for x in ["页面", "用户端", "客户端", "小程序", "app", "前端", "ui-c", "登录"]):
        ends.append("ui-c")
    if any(x in low for x in ["灰度", "实验", "ab test", "a/b", "开关"]):
        ends.append("experiment")
    return ends or ["ui-c"]


def _spec_issues(requirement: str, mode: str, sdd_spec: str) -> list[dict[str, str]]:
    text = f"{requirement}\n{sdd_spec}".strip()
    issues: list[dict[str, str]] = []
    checks = [
        (not re.search(r"验收|预期|成功|完成", text), "完整性", "缺少明确、可观察的验收标准", "补充成功条件、页面/接口反馈及状态变化"),
        (not re.search(r"失败|异常|错误|拒绝|限制", text), "覆盖度", "未描述失败路径与异常限制", "补充非法输入、依赖失败、重复操作与恢复策略"),
        (not re.search(r"角色|用户|管理员|权限|登录", text), "一致性", "参与角色或权限边界不清晰", "明确操作者、数据范围与越权处理"),
        (not re.search(r"\d|上限|下限|最多|最少|超时|次数", text), "可测试性", "关键阈值或时限未量化", "给出长度、次数、金额、超时等可验证边界"),
        (mode == "standard" and not sdd_spec.strip(), "完整性", "Standard 模式未提供 SDD Spec", "补充 SDD Spec，或切换 Sketch 模式快速生成"),
        (bool(re.search(r"见[一二三四五六七八九十\d]+", text)), "一致性", "存在无法定位的章节引用（如“见五”）", "补充被引用章节内容或改为可独立理解的交互说明"),
        ("频繁" in text and not re.search(r"(?:\d+\s*次.{0,8}频繁|频繁.{0,8}\d+\s*次)", text), "可测试性", "频繁操作的次数阈值和时间窗口未定义", "明确多少次、统计周期、限制时长和解除条件"),
        ("验证码" in text and "过期" in text and not re.search(r"\d+\s*(?:秒|分钟|分|小时)", text), "可测试性", "验证码有效期未量化", "明确验证码有效时长及过期时间起算点"),
        ("纯数字键盘" in text and not re.search(r"小程序|安卓|Android|iOS|移动端|H5", text, re.I), "兼容性", "纯数字键盘的生效终端与输入类型未说明", "明确适用端，并约定 inputmode/type 与粘贴行为"),
        ("注册登录" in text and not re.search(r"注册成功|登录成功|跳转|进入首页|会话|token", text, re.I), "完整性", "注册与登录成功后的可观察状态未定义", "补充成功提示、跳转页面、登录态和重复注册后的处理"),
    ]
    for matched, category, detail, suggestion in checks:
        if matched:
            issues.append({"severity": "high" if category in {"完整性", "可测试性"} else "medium", "category": category, "detail": detail, "suggestion": suggestion})
    return issues


def _requirement_units(requirement: str, ends: list[str]) -> list[dict[str, Any]]:
    text = requirement.strip()
    candidates: list[tuple[str, str, str]] = []
    if re.search(r"注册|登录", text):
        candidates.append(("账户与权限", "ui-c", "注册、登录及已注册用户分流"))
    if re.search(r"手机号|手机号码", text):
        candidates.append(("手机号输入", "ui-c", "数字键盘、空值与格式校验"))
    if "验证码" in text:
        candidates.append(("验证码生命周期", "server", "发送、使用、过期、错误次数与重放防护"))
    if re.search(r"频繁|最大尝试|次数", text):
        candidates.append(("风控与限流", "server", "频率限制、尝试上限及恢复策略"))
    if not candidates:
        candidates = [(f"{end} 需求切片", end, "按端拆分的独立可测需求") for end in ends]
    methodology = {"server": "服务端测试指南", "ui-b": "B 端 UI 测试指南", "ui-c": "C 端 UI 测试指南", "experiment": "实验与灰度测试指南"}
    return [
        {"id": f"REQ-{idx:02d}", "end": end, "title": title, "scope": scope, "methodology": methodology[end]}
        for idx, (title, end, scope) in enumerate(candidates, start=1)
    ]


def _risk_items(requirement: str, issues: list[dict[str, str]]) -> list[dict[str, str]]:
    text = requirement.strip()
    items: list[dict[str, str]] = []
    if re.search(r"注册|登录|权限", text):
        items.append({"level": "high", "risk": "身份与权限状态错误", "impact": "账号串用、越权或无法登录", "strategy": "覆盖新用户、已注册用户、未登录与重复提交状态"})
    if "验证码" in text:
        items.append({"level": "high", "risk": "验证码被重放或绕过", "impact": "账号被非法注册或接管", "strategy": "验证一次性、过期、错误次数、手机号绑定与并发提交"})
    if re.search(r"频繁|次数", text):
        items.append({"level": "medium", "risk": "频控边界不一致", "impact": "误伤正常用户或被批量滥用", "strategy": "覆盖阈值前后、时间窗口、解除条件和多端并发"})
    if "纯数字键盘" in text:
        items.append({"level": "medium", "risk": "移动端键盘与输入兼容异常", "impact": "手机号无法正确输入", "strategy": "覆盖 Android、iOS、粘贴、删除、全角字符与超长输入"})
    if issues:
        items.append({"level": "medium", "risk": "需求歧义导致错误实现", "impact": "验收口径不一致与返工", "strategy": "生成前确认高优先级待澄清项"})
    return items


def _coverage_dimensions(requirement: str, issues: list[dict[str, str]]) -> list[dict[str, Any]]:
    text = requirement.strip()
    rows: list[dict[str, Any]] = [
        {"module": "核心流程", "method": "场景法", "checks": ["未注册手机号完成注册", "已注册手机号引导直接登录", "注册成功后的登录态"]},
    ]
    if re.search(r"手机号|手机号码", text):
        rows.append({"module": "手机号输入", "method": "等价类 + 边界值", "checks": ["空值", "合法手机号", "位数不足/超长", "非数字与特殊字符", "纯数字键盘"]})
    if "验证码" in text:
        rows.append({"module": "验证码状态", "method": "状态迁移 + 判定表", "checks": ["未填写", "有效", "错误", "已使用", "已过期", "达到最大尝试次数"]})
    if re.search(r"频繁|次数", text):
        rows.append({"module": "频控", "method": "边界值 + 错误推测", "checks": ["阈值前一次", "达到阈值", "超过阈值", "窗口结束后恢复", "连续快速点击"]})
    if issues:
        rows.append({"module": "需求待确认", "method": "评审", "checks": [item["detail"] for item in issues]})
    return rows


def build_pipeline_delivery(
    requirement: str,
    cases: list[dict[str, Any]],
    mode: str = "sketch",
    sdd_spec: str = "",
    code_diff: str = "",
) -> dict[str, Any]:
    mode = normalize_generation_mode(mode)
    ends = _detect_ends(f"{requirement}\n{sdd_spec}")
    issues = _spec_issues(requirement, mode, sdd_spec)
    ids = _case_ids(cases)
    priorities = [str(_case_dict(row).get("priority") or "P1") for row in cases]
    high = sum(1 for value in priorities if value == "P0")
    medium = sum(1 for value in priorities if value == "P1")
    low = max(0, len(cases) - high - medium)
    units = _requirement_units(requirement, ends)
    risk_items = _risk_items(requirement, issues)
    coverage_dimensions = _coverage_dimensions(requirement, issues)
    traceability = []
    for idx, unit in enumerate(units):
        linked = ids[idx::len(units)] or ids[:1]
        traceability.append({"requirement_id": unit["id"], "case_ids": linked})
    case_home_records = []
    for idx, raw in enumerate(cases, start=1):
        row = _case_dict(raw)
        case_home_records.append(
            {
                "caseId": str(row.get("case_id") or f"TC-GEN-{idx}"),
                "name": str(row.get("title") or f"测试用例 {idx}"),
                "priority": str(row.get("priority") or "P1"),
                "module": str(row.get("module") or "通用模块"),
                "preconditions": row.get("preconditions") or [],
                "steps": row.get("steps") or [],
                "expectedResult": str(row.get("expected_result") or ""),
                "tags": ["AI生成", mode.upper(), *list(row.get("tags") or [])],
                "traceIds": [item["requirement_id"] for item in traceability if str(row.get("case_id") or f"TC-GEN-{idx}") in item["case_ids"]],
            }
        )
    return {
        "version": "2.0",
        "mode": mode,
        "mode_label": "文档驱动" if mode == "standard" else "快速生成",
        "skills": PIPELINE_SKILLS,
        "stages": [
            {"key": "spec", "name": "需求分析与 Spec 验证", "status": "attention" if issues else "passed", "summary": f"发现 {len(issues)} 项待澄清问题" if issues else "需求具备生成条件"},
            {"key": "risk", "name": "风险驱动测试计划", "status": "passed", "summary": f"识别 {len(risk_items)} 项产品风险"},
            {"key": "split", "name": "需求拆分与分类", "status": "passed", "summary": f"{len(units)} 个独立可测单元"},
            {"key": "dimensions", "name": "测试覆盖维度", "status": "passed", "summary": f"{len(coverage_dimensions)} 组覆盖设计"},
            {"key": "cases", "name": "详细用例生成", "status": "passed", "summary": f"{len(cases)} 条可执行用例"},
            {"key": "delivery", "name": "上传与交付闭环", "status": "ready", "summary": "Case Home JSON 已就绪"},
        ],
        "spec_review": {"score": max(40, 100 - len(issues) * 12), "issues": issues, "clarified_requirement": requirement.strip()},
        "risk_plan": {"strategy": "风险驱动 + 测试左移", "risk_distribution": {"high": sum(1 for item in risk_items if item["level"] == "high") or high, "medium": sum(1 for item in risk_items if item["level"] == "medium") or medium, "low": low}, "risks": risk_items, "code_diff_included": bool(code_diff.strip()), "scope": sorted({item["end"] for item in units})},
        "requirement_units": units,
        "coverage": {"methods": PIPELINE_METHODS, "dimensions": coverage_dimensions, "case_types": sorted({str(_case_dict(row).get("type") or "functional") for row in cases})},
        "traceability": traceability,
        "case_home": {"format": "Case Home JSON", "mode": "incremental", "total": len(case_home_records), "records": case_home_records},
    }


def run_pipeline_skill(
    stage_key: str,
    requirement: str,
    cases: list[dict[str, Any]] | None = None,
    mode: str = "sketch",
    sdd_spec: str = "",
    code_diff: str = "",
) -> dict[str, Any]:
    """Run one deterministic pipeline skill and return its inspectable artifact."""
    delivery = build_pipeline_delivery(requirement, cases or [], mode, sdd_spec, code_diff)
    skill = next((item for item in PIPELINE_SKILLS if item["key"] == stage_key), None)
    if not skill:
        raise ValueError(f"unsupported pipeline stage: {stage_key}")
    artifacts = {
        "spec": delivery["spec_review"],
        "risk": delivery["risk_plan"],
        "split": {"units": delivery["requirement_units"]},
        "dimensions": delivery["coverage"],
        "cases": {"total": len(cases or []), "records": cases or []},
        "delivery": {"traceability": delivery["traceability"], "case_home": delivery["case_home"]},
    }
    stage = next(item for item in delivery["stages"] if item["key"] == stage_key)
    return {"skill": skill, "stage": stage, "artifact": artifacts[stage_key], "pipeline": delivery}
