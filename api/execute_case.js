const dns = require("node:dns").promises;
const net = require("node:net");
const { chromium: playwright } = require("playwright-core");
const serverlessChromium = require("@sparticuz/chromium");
const rateBuckets = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 6;
const MAX_STEPS = 12;

function enforceRateLimit(req) {
  const ip = String(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const now = Date.now();
  const recent = (rateBuckets.get(ip) || []).filter((at) => now - at < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) throw new Error("RATE_LIMITED: 执行过于频繁，请一分钟后再试");
  recent.push(now); rateBuckets.set(ip, recent);
}

function isPrivateIp(value) {
  if (net.isIP(value) === 4) {
    const p = value.split(".").map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
  }
  if (net.isIP(value) === 6) {
    const v = value.toLowerCase();
    return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80:");
  }
  return true;
}

async function validateTarget(raw) {
  let url;
  try { url = new URL(String(raw || "").trim()); } catch (_) { throw new Error("目标地址必须是有效的 http/https URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("目标地址必须是有效的 http/https URL");
  if (["localhost", "0.0.0.0"].includes(url.hostname) || url.hostname.endsWith(".local")) throw new Error("线上执行不允许访问本机或内网地址");
  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some((item) => isPrivateIp(item.address))) throw new Error("线上执行不允许访问本机或内网地址");
  return url.toString();
}

function dataMap(text) {
  const out = {};
  for (const match of String(text || "").matchAll(/([\w\u4e00-\u9fff]+)\s*[：:]\s*([^，,；;|]+)/g)) out[match[1].trim().toLowerCase()] = match[2].trim();
  return out;
}

function isExplicitInputAction(action) {
  const text = String(action || "").trim();
  return /^(?:输入|填写)/.test(text) ||
    /(?:在|向).{0,30}?(?:输入|填写)/.test(text) ||
    /(?:输入|填写).{0,12}?(?:框|字段|手机号|手机号码|账号|用户名|密码|验证码|邮箱|关键词|内容)/.test(text);
}

async function fillFields(page, data, logs) {
  const aliases = { "手机号":["手机号","手机号码","phone","mobile"], "账号":["账号","用户名","username","account"], "密码":["密码","password"], "验证码":["验证码","verification","code"], "邮箱":["邮箱","email"] };
  let filledCount = 0;
  for (const [rawKey, value] of Object.entries(data)) {
    const names = Object.entries(aliases).find(([key, values]) => rawKey.includes(key) || values.some((name) => rawKey.includes(name.toLowerCase())))?.[1] || [rawKey];
    let filled = false;
    for (const name of names) {
      const pattern = new RegExp(name, "i");
      for (const locator of [page.getByLabel(pattern), page.getByPlaceholder(pattern)]) {
        if (await locator.count()) { await locator.first().fill(value); logs.push(`填写字段 ${rawKey}`); filled = true; filledCount += 1; break; }
      }
      if (filled) break;
    }
    if (!filled) logs.push(`字段“${rawKey}”未按标签匹配，将尝试通用输入框`);
  }
  return filledCount;
}

async function findEditableInput(page, hint = "") {
  const candidates = [];
  if (hint) {
    const pattern = new RegExp(hint, "i");
    candidates.push(page.getByLabel(pattern), page.getByPlaceholder(pattern));
  }
  candidates.push(
    page.getByRole("searchbox"),
    page.getByRole("textbox"),
    page.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([disabled]), textarea:not([disabled]), [contenteditable="true"]')
  );
  for (const candidate of candidates) {
    const count = Math.min(await candidate.count(), 10);
    for (let index = 0; index < count; index += 1) {
      const visible = candidate.nth(index);
      if (await visible.isVisible()) return visible;
    }
  }
  return page.locator("input:visible").first();
}

function inferCaseValue(testCase) {
  const text = (testCase?.steps || []).map((step) => `${step?.action || ""} ${step?.test_data || ""} ${step?.expected_result || ""}`).join(" ");
  return text.match(/(?:^|[^a-z0-9.-])(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?=[^a-z0-9.-]|$)/i)?.[1] || "";
}

async function assertNotBlocked(page) {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const bodyText = await page.locator("body").innerText({ timeout: 1000 }).catch(() => "");
  if (/captcha|challenge|verify|security-check/i.test(url) || /验证码|安全验证|人机验证|滑块验证|访问异常/.test(`${title} ${bodyText.slice(0, 2000)}`)) {
    throw new Error("BLOCKED_BY_CHALLENGE: 目标网站要求验证码或人机验证，本次自动执行已被网站风控拦截");
  }
}

async function waitForPageReady(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(1200);
}

async function installCjkFont(page) {
  const fontUrl = String(process.env.PLAYWRIGHT_CJK_FONT_URL || "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf").trim();
  if (!/^https:\/\//i.test(fontUrl)) return;
  const source = JSON.stringify(fontUrl);
  await page.addStyleTag({ content: `@font-face{font-family:LingTestCJK;src:url(${source}) format("opentype");font-display:swap}html,body,input,button,textarea,select{font-family:LingTestCJK,Arial,sans-serif}` }).catch(() => {});
  await page.evaluate(() => document.fonts?.load('16px LingTestCJK')).catch(() => {});
}

async function findClickTarget(page, label, action) {
  const domain = action.match(/(?:^|[^a-z0-9.-])([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?=[^a-z0-9.-]|$)/i)?.[1];
  let target = domain ? page.getByRole("link", { name: new RegExp(domain.replaceAll(".", "\\."), "i") }) : page.getByRole("button", { name: new RegExp(label, "i") });
  if (!(await target.count()) && domain) target = page.getByText(new RegExp(domain.replaceAll(".", "\\."), "i"));
  if (!(await target.count())) target = page.getByText(label, { exact: true });
  const isSubmitAction = /搜索|查询|提交|登录|确认|保存|下一步|完成/.test(`${label} ${action}`);
  if (!(await target.count()) && isSubmitAction) target = page.locator('button[type="submit"], input[type="submit"], form button, [role="search"] button');
  return target.first();
}

async function runStep(page, step, logs, context) {
  const action = String(step?.action || "").trim();
  const mapped = dataMap(step?.test_data);
  const shouldInput = isExplicitInputAction(action);
  const filledCount = shouldInput ? await fillFields(page, mapped, logs) : 0;
  if (shouldInput && filledCount === 0) {
    const directValue = action.match(/(?:输入|填写)[「『\"']?([^，,。；;|「』\"']+)[」』\"']?/)?.[1]?.trim();
    const generic = !directValue || /^(?:关键词|内容|数据|信息)$/.test(directValue);
    const value = Object.values(mapped)[0] || (generic ? context.inferredValue : directValue);
    if (!value) throw new Error("用例缺少可执行的输入数据，请在测试数据中明确填写关键词或输入值");
    const hint = action.match(/在(.{1,24}?)(?:中|里)?(?:输入|填写)/)?.[1]?.replace(/页面|表单/g, "").trim();
    const input = await findEditableInput(page, hint || "");
    if (!(await input.count())) throw new Error("目标页面未找到可输入的文本框");
    await input.fill(value);
    logs.push(`在文本框输入 ${value}`);
  }
  const click = action.match(/(?:点击|单击|按下)[「『\"']?([^，,。；;|「』\"']+?)[」』\"']?(?:按钮|链接|$)/);
  if (click) {
    const label = click[1].trim();
    const target = await findClickTarget(page, label, action);
    if (!(await target.count())) throw new Error(`目标页面未找到“${label}”按钮或链接，请填写实际功能页面地址并确认页面内容与用例一致`);
    await target.waitFor({ state: "visible", timeout: 8000 });
    await target.first().click({ timeout: 8000 }); logs.push(`点击 ${label}`); await assertNotBlocked(page); return;
  }
  const label = ["登录","提交","确认","保存","下一步"].find((word) => action.includes(word));
  if (label) {
    const target = await findClickTarget(page, label, action);
    if (!(await target.count())) throw new Error(`目标页面未找到“${label}”按钮，请填写实际功能页面地址并确认页面内容与用例一致`);
    await target.first().click({ timeout: 8000 }); logs.push(`点击 ${label}`); await assertNotBlocked(page);
  }
  else logs.push(`执行步骤：${action}`);
}

function normalizeAssertions(testCase) {
  const explicit = Array.isArray(testCase?.assertions) ? testCase.assertions.filter((item) => item && typeof item === "object") : [];
  if (explicit.length) return explicit.slice(0, 8);
  const text = [testCase?.expected_result, ...(testCase?.steps || []).map((step) => step?.expected_result)].filter(Boolean).join("；");
  const assertions = [];
  const intentText = [testCase?.title, text].filter(Boolean).join("；");
  if (/页面.{0,12}(?:正常加载|加载完成|正常显示|可正常访问|无白屏)|核心页面.{0,12}正常/.test(intentText)) {
    assertions.push({ type:"page_loaded", value:"页面主体可见" });
  }
  const url = text.match(/(?:跳转|进入|地址|URL)[^。；]*?((?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+[^，。；\s]*)/i)?.[1];
  if (url) assertions.push({ type:"url_contains", value:url.replace(/^https?:\/\//, "") });
  for (const match of text.matchAll(/(?:显示|出现|包含|看到)[“「『\"']?([^，。；|”」』\"']{1,50})/g)) {
    const value = match[1].trim().replace(/(?:页面|提示|信息|文案)$/g, "").trim();
    if (value && !/正确|正常|成功处理|符合预期/.test(value)) assertions.push({ type:"text", value });
  }
  return assertions.slice(0, 4);
}

async function runAssertions(page, testCase, logs) {
  const assertions = normalizeAssertions(testCase);
  if (!assertions.length) throw new Error("ASSERTION_REQUIRED: 用例步骤已完成，但缺少可验证的预期结果，请补充明确文案、URL 或元素断言");
  const results = [];
  for (const assertion of assertions) {
    const type = String(assertion.type || "text");
    const value = String(assertion.value || "").trim();
    if (!value) continue;
    let passed = false; let actual = "";
    if (type === "page_loaded") {
      const body = page.locator("body");
      const text = await body.innerText().catch(() => "");
      const title = await page.title().catch(() => "");
      passed = await body.isVisible().catch(() => false) && Boolean(text.trim() || title.trim());
      actual = passed ? `页面主体可见${title ? `，标题：${title}` : ""}` : "页面主体不可见或内容为空";
    }
    else if (type === "url_contains") { actual = page.url(); passed = actual.includes(value); }
    else if (type === "title_contains") { actual = await page.title(); passed = actual.includes(value); }
    else if (type === "visible") { passed = await page.getByText(value, { exact:false }).first().isVisible().catch(() => false); actual = passed ? "visible" : "not visible"; }
    else { actual = (await page.locator("body").innerText()).slice(0, 5000); passed = actual.includes(value); }
    results.push({ type, value, passed, actual: type === "text" ? (passed ? "文本已出现" : "页面未包含目标文本") : actual.slice(0, 300) });
    logs.push(`ASSERT ${passed ? "PASS" : "FAIL"}: ${type} = ${value}`);
    if (!passed) throw new Error(`ASSERTION_FAILED: ${type} 未满足：${value}`);
  }
  return results;
}

async function launchBrowser() {
  const ws = String(process.env.PLAYWRIGHT_WS_ENDPOINT || "").trim();
  if (ws) return { browser: await playwright.connect(ws), mode: "远程 Playwright" };
  return { browser: await playwright.launch({ args: serverlessChromium.args, executablePath: await serverlessChromium.executablePath(), headless: true }), mode: "Vercel Chromium" };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const started = Date.now(); const logs = []; let browser; let page;
  try {
    enforceRateLimit(req);
    const target = await validateTarget(req.body?.target_url);
    const testCase = req.body?.test_case;
    if (!testCase || typeof testCase !== "object") return res.status(400).json({ error: "missing test_case" });
    if (!Array.isArray(testCase.steps) || !testCase.steps.length) return res.status(400).json({ error: "用例缺少执行步骤" });
    if (testCase.steps.length > MAX_STEPS) return res.status(400).json({ error: `单条用例最多支持 ${MAX_STEPS} 个步骤` });
    const launched = await launchBrowser(); browser = launched.browser; logs.push(`已启动${launched.mode}`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
    page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on("console", (msg) => {
      const text = msg.text();
      if (msg.type() === "error" && !text.includes("upgrade-insecure-requests")) logs.push(`console.error: ${text}`);
    });
    page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
    await installCjkFont(page);
    await waitForPageReady(page);
    logs.push(`打开 ${target}`);
    const executionContext = { inferredValue: inferCaseValue(testCase) };
    for (const [index, step] of (testCase.steps || []).entries()) { logs.push(`STEP ${index + 1} START`); await runStep(page, step, logs, executionContext); await page.waitForTimeout(500); await assertNotBlocked(page); logs.push(`STEP ${index + 1} PASS`); }
    const assertions = await runAssertions(page, testCase, logs);
    const shot = await page.screenshot({ type: "jpeg", quality: 70 });
    return res.status(200).json({ result: { status:"passed", category:"assertion_passed", summary:`步骤完成，${assertions.length} 项断言通过`, assertions, duration_ms:Date.now()-started, log:logs.join("\n"), screenshot_base64:shot.toString("base64"), screenshot_mime:"image/jpeg", final_url:page.url() } });
  } catch (error) {
    const message = String(error?.message || error);
    const blocked = message.includes("BLOCKED_BY_CHALLENGE");
    const needsReview = /未找到|缺少可执行|页面地址|页面内容与用例一致|ASSERTION_REQUIRED/.test(message);
    const assertionFailed = message.includes("ASSERTION_FAILED");
    const rateLimited = message.includes("RATE_LIMITED");
    const status = blocked ? "blocked" : needsReview ? "needs_review" : "failed";
    const category = blocked ? "site_challenge" : rateLimited ? "rate_limited" : assertionFailed ? "assertion_failed" : needsReview ? "page_mismatch" : "execution_error";
    const summary = blocked ? "被目标网站风控拦截" : rateLimited ? "执行频率已达到上限" : assertionFailed ? "步骤完成，但预期结果未满足" : needsReview ? "页面或预期结果需要人工确认" : "执行器运行失败";
    logs.push(`${status.toUpperCase()}: ${error?.name || "Error"}: ${message.replace(/^BLOCKED_BY_CHALLENGE:\s*/, "")}`);
    let screenshot = "";
    try { if (page) screenshot = (await page.screenshot({ type:"jpeg", quality:70 })).toString("base64"); } catch (_) {}
    return res.status(200).json({ result: { status, category, summary, duration_ms:Date.now()-started, log:logs.join("\n"), screenshot_base64:screenshot, screenshot_mime:"image/jpeg", error:message } });
  } finally { if (browser) await browser.close().catch(() => {}); }
};

module.exports.config = { maxDuration: 60 };
module.exports._test = { normalizeAssertions, inferCaseValue, isExplicitInputAction };
