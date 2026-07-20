from __future__ import annotations

import re
from typing import Any, Iterable


PIPELINE_METHODS = ["等价类", "边界值", "判定表", "状态迁移", "场景法", "因果图", "错误推测"]


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
    ]
    for matched, category, detail, suggestion in checks:
        if matched:
            issues.append({"severity": "high" if category in {"完整性", "可测试性"} else "medium", "category": category, "detail": detail, "suggestion": suggestion})
    return issues


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
    units = [
        {
            "id": f"REQ-{idx:02d}",
            "end": end,
            "title": f"{end} 需求切片",
            "methodology": {"server": "服务端测试指南", "ui-b": "B 端 UI 测试指南", "ui-c": "C 端 UI 测试指南", "experiment": "实验与灰度测试指南"}[end],
        }
        for idx, end in enumerate(ends, start=1)
    ]
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
        "mode_label": "Standard · SDD 驱动" if mode == "standard" else "Sketch · 轻量需求驱动",
        "stages": [
            {"key": "spec", "name": "需求分析与 Spec 验证", "status": "attention" if issues else "passed", "summary": f"发现 {len(issues)} 项待澄清问题" if issues else "需求具备生成条件"},
            {"key": "risk", "name": "风险驱动测试计划", "status": "passed", "summary": f"P0 {high} · P1 {medium} · P2 {low}"},
            {"key": "split", "name": "需求拆分与分类", "status": "passed", "summary": " · ".join(ends)},
            {"key": "dimensions", "name": "测试覆盖维度", "status": "passed", "summary": f"7 种方法 · {len(cases)} 条覆盖"},
            {"key": "cases", "name": "详细用例生成", "status": "passed", "summary": f"{len(cases)} 条可执行用例"},
            {"key": "delivery", "name": "上传与交付闭环", "status": "ready", "summary": "Case Home JSON 已就绪"},
        ],
        "spec_review": {"score": max(40, 100 - len(issues) * 12), "issues": issues, "clarified_requirement": requirement.strip()},
        "risk_plan": {"strategy": "风险驱动 + 测试左移", "risk_distribution": {"high": high, "medium": medium, "low": low}, "code_diff_included": bool(code_diff.strip()), "scope": ends},
        "requirement_units": units,
        "coverage": {"methods": PIPELINE_METHODS, "dimensions": sorted({str(_case_dict(row).get("type") or "functional") for row in cases})},
        "traceability": traceability,
        "case_home": {"format": "Case Home JSON", "mode": "incremental", "total": len(case_home_records), "records": case_home_records},
    }
