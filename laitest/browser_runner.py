from __future__ import annotations

import base64
import os
import re
import socket
import time
from ipaddress import ip_address
from typing import Any
from urllib.parse import urlparse


def _validate_public_url(value: str) -> str:
    url = value.strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("目标地址必须是有效的 http/https URL")
    host = parsed.hostname.lower()
    if host in {"localhost", "0.0.0.0"} or host.endswith(".local"):
        raise ValueError("线上执行不允许访问本机或内网地址")
    for item in socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80)):
        addr = ip_address(item[4][0])
        if not addr.is_global:
            raise ValueError("线上执行不允许访问本机或内网地址")
    return url


def _test_data_map(text: str) -> dict[str, str]:
    data: dict[str, str] = {}
    for key, value in re.findall(r"([\w\u4e00-\u9fff]+)\s*[：:]\s*([^，,；;|]+)", text):
        data[key.strip().lower()] = value.strip()
    return data


def _fill_common_fields(page: Any, data: dict[str, str], logs: list[str]) -> None:
    aliases = {
        "手机号": ["手机号", "手机号码", "phone", "mobile"],
        "账号": ["账号", "用户名", "username", "account"],
        "密码": ["密码", "password"],
        "验证码": ["验证码", "verification", "code"],
        "邮箱": ["邮箱", "email"],
    }
    for raw_key, value in data.items():
        names = next((v for k, v in aliases.items() if k in raw_key), [raw_key])
        filled = False
        for name in names:
            pattern = re.compile(re.escape(name), re.I)
            for locator in (page.get_by_label(pattern), page.get_by_placeholder(pattern)):
                try:
                    if locator.count() > 0:
                        locator.first.fill(value)
                        logs.append(f"填写字段 {raw_key}")
                        filled = True
                        break
                except Exception:
                    continue
            if filled:
                break
        if not filled:
            logs.append(f"未找到字段 {raw_key}，已跳过")


def _infer_case_value(test_case: dict[str, Any]) -> str:
    text = " ".join(
        f"{step.get('action', '')} {step.get('test_data', '')} {step.get('expected_result', '')}"
        for step in (test_case.get("steps") or []) if isinstance(step, dict)
    )
    match = re.search(r"(?:^|[^a-z0-9.-])(?:https?://)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?=[^a-z0-9.-]|$)", text, re.I)
    return match.group(1) if match else ""


def _assert_not_blocked(page: Any) -> None:
    if re.search(r"captcha|wappass\.baidu\.com", page.url, re.I):
        raise RuntimeError("BLOCKED_BY_CAPTCHA: 百度检测到自动化访问并要求验证码，本次执行已被目标站风控拦截")


def _run_natural_step(page: Any, step: dict[str, Any], logs: list[str], inferred_value: str = "") -> None:
    action = str(step.get("action") or "").strip()
    test_data = str(step.get("test_data") or "").strip()
    if not action:
        return
    data = _test_data_map(test_data)
    if data:
        _fill_common_fields(page, data, logs)
    if re.search(r"输入|填写", action) and not data:
        direct = re.search(r"(?:输入|填写)[「『\"']?([^，,。；;|「』\"']+)[」』\"']?", action)
        direct_value = direct.group(1).strip() if direct else ""
        value = inferred_value if not direct_value or direct_value in {"关键词", "内容", "数据", "信息"} else direct_value
        if not value:
            raise RuntimeError("用例缺少可执行的输入数据，请在测试数据中明确填写关键词或输入值")
        target = page.get_by_role("textbox").first
        if target.count() == 0:
            raise RuntimeError("目标页面未找到可输入的文本框")
        target.fill(value)
        logs.append(f"在文本框输入 {value}")

    click_match = re.search(r"(?:点击|单击|按下)[「『\"']?([^，,。；;|「』\"']+?)[」』\"']?(?:按钮|链接|$)", action)
    if click_match:
        label = click_match.group(1).strip()
        domain_match = re.search(r"(?:^|[^a-z0-9.-])([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?=[^a-z0-9.-]|$)", action, re.I)
        domain = domain_match.group(1) if domain_match else ""
        target = page.get_by_role("link", name=re.compile(re.escape(domain), re.I)) if domain else page.get_by_role("button", name=re.compile(re.escape(label), re.I))
        if target.count() == 0 and domain:
            target = page.get_by_text(re.compile(re.escape(domain), re.I))
        if target.count() == 0:
            target = page.get_by_text(label, exact=True)
        if target.count() == 0:
            raise RuntimeError(f"目标页面未找到“{label}”按钮或链接，请填写实际功能页面地址并确认页面内容与用例一致")
        target.first.click(timeout=8000)
        logs.append(f"点击 {label}")
        _assert_not_blocked(page)
    elif any(word in action for word in ("提交", "登录", "确认", "保存", "下一步")):
        labels = [word for word in ("登录", "提交", "确认", "保存", "下一步") if word in action]
        label = labels[0]
        target = page.get_by_role("button", name=re.compile(label, re.I))
        if target.count() == 0:
            target = page.get_by_text(label, exact=True)
        if target.count() == 0:
            raise RuntimeError(f"目标页面未找到“{label}”按钮，请填写实际功能页面地址并确认页面内容与用例一致")
        target.first.click(timeout=8000)
        logs.append(f"点击 {label}")
        _assert_not_blocked(page)
    else:
        logs.append(f"执行步骤：{action}")


def run_browser_case(target_url: str, test_case: dict[str, Any]) -> dict[str, Any]:
    started = time.monotonic()
    logs: list[str] = []
    screenshot = ""
    browser = None
    playwright = None
    try:
        url = _validate_public_url(target_url)
        from playwright.sync_api import sync_playwright

        playwright = sync_playwright().start()
        ws_endpoint = os.environ.get("PLAYWRIGHT_WS_ENDPOINT", "").strip()
        if ws_endpoint:
            browser = playwright.chromium.connect(ws_endpoint)
            logs.append("已连接远程 Playwright 浏览器")
        else:
            browser = playwright.chromium.launch(headless=True)
            logs.append("已启动本地 Playwright 浏览器")
        context = browser.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN")
        page = context.new_page()
        page.on("console", lambda msg: logs.append(f"console.error: {msg.text}") if msg.type == "error" and "upgrade-insecure-requests" not in msg.text else None)
        page.on("pageerror", lambda exc: logs.append(f"pageerror: {exc}"))
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        logs.append(f"打开 {url}")
        inferred_value = _infer_case_value(test_case)
        for index, step in enumerate(test_case.get("steps") or [], start=1):
            logs.append(f"STEP {index} START")
            _run_natural_step(page, step if isinstance(step, dict) else {}, logs, inferred_value)
            page.wait_for_timeout(500)
            _assert_not_blocked(page)
            logs.append(f"STEP {index} PASS")
        screenshot = base64.b64encode(page.screenshot(full_page=True, type="png")).decode("ascii")
        return {
            "status": "passed",
            "duration_ms": int((time.monotonic() - started) * 1000),
            "log": "\n".join(logs),
            "screenshot_base64": screenshot,
            "final_url": page.url,
        }
    except Exception as exc:
        logs.append(f"FAILED: {exc.__class__.__name__}: {exc}")
        try:
            pages = browser.contexts[0].pages if browser and browser.contexts else []
            if pages:
                screenshot = base64.b64encode(pages[-1].screenshot(full_page=True, type="png")).decode("ascii")
        except Exception as shot_exc:
            logs.append(f"截图失败: {shot_exc}")
        return {
            "status": "failed",
            "duration_ms": int((time.monotonic() - started) * 1000),
            "log": "\n".join(logs),
            "screenshot_base64": screenshot,
            "error": str(exc),
        }
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        if playwright:
            playwright.stop()
