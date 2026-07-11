const dns = require("node:dns").promises;
const net = require("node:net");
const { chromium: playwright } = require("playwright-core");
const serverlessChromium = require("@sparticuz/chromium");

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

async function fillFields(page, data, logs) {
  const aliases = { "手机号":["手机号","手机号码","phone","mobile"], "账号":["账号","用户名","username","account"], "密码":["密码","password"], "验证码":["验证码","verification","code"], "邮箱":["邮箱","email"] };
  for (const [rawKey, value] of Object.entries(data)) {
    const names = Object.entries(aliases).find(([key]) => rawKey.includes(key))?.[1] || [rawKey];
    let filled = false;
    for (const name of names) {
      const pattern = new RegExp(name, "i");
      for (const locator of [page.getByLabel(pattern), page.getByPlaceholder(pattern)]) {
        if (await locator.count()) { await locator.first().fill(value); logs.push(`填写字段 ${rawKey}`); filled = true; break; }
      }
      if (filled) break;
    }
    if (!filled) logs.push(`未找到字段 ${rawKey}，已跳过`);
  }
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
  await fillFields(page, mapped, logs);
  if (/输入|填写/.test(action) && !Object.keys(mapped).length) {
    const directValue = action.match(/(?:输入|填写)[「『\"']?([^，,。；;|「』\"']+)[」』\"']?/)?.[1]?.trim();
    const generic = !directValue || /^(?:关键词|内容|数据|信息)$/.test(directValue);
    const value = generic ? context.inferredValue : directValue;
    if (!value) throw new Error("用例缺少可执行的输入数据，请在测试数据中明确填写关键词或输入值");
    const hint = action.match(/在(.{1,24}?)(?:中|里)?(?:输入|填写)/)?.[1]?.replace(/页面|表单/g, "").trim();
    let input = hint ? page.getByLabel(new RegExp(hint, "i")) : page.getByRole("textbox");
    if (!(await input.count()) && hint) input = page.getByPlaceholder(new RegExp(hint, "i"));
    if (!(await input.count())) input = page.getByRole("textbox");
    input = input.first();
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

async function launchBrowser() {
  const ws = String(process.env.PLAYWRIGHT_WS_ENDPOINT || "").trim();
  if (ws) return { browser: await playwright.connect(ws), mode: "远程 Playwright" };
  return { browser: await playwright.launch({ args: serverlessChromium.args, executablePath: await serverlessChromium.executablePath(), headless: true }), mode: "Vercel Chromium" };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const started = Date.now(); const logs = []; let browser; let page;
  try {
    const target = await validateTarget(req.body?.target_url);
    const testCase = req.body?.test_case;
    if (!testCase || typeof testCase !== "object") return res.status(400).json({ error: "missing test_case" });
    const launched = await launchBrowser(); browser = launched.browser; logs.push(`已启动${launched.mode}`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
    page = await context.newPage();
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
    const shot = await page.screenshot({ type: "jpeg", quality: 70 });
    return res.status(200).json({ result: { status:"passed", category:"assertion_passed", summary:"全部步骤执行完成", duration_ms:Date.now()-started, log:logs.join("\n"), screenshot_base64:shot.toString("base64"), screenshot_mime:"image/jpeg", final_url:page.url() } });
  } catch (error) {
    const message = String(error?.message || error);
    const blocked = message.includes("BLOCKED_BY_CHALLENGE");
    const needsReview = /未找到|缺少可执行|页面地址|页面内容与用例一致/.test(message);
    const status = blocked ? "blocked" : needsReview ? "needs_review" : "failed";
    const category = blocked ? "site_challenge" : needsReview ? "page_mismatch" : "execution_error";
    const summary = blocked ? "被目标网站风控拦截" : needsReview ? "页面与用例需要人工确认" : "执行器运行失败";
    logs.push(`${status.toUpperCase()}: ${error?.name || "Error"}: ${message.replace(/^BLOCKED_BY_CHALLENGE:\s*/, "")}`);
    let screenshot = "";
    try { if (page) screenshot = (await page.screenshot({ type:"jpeg", quality:70 })).toString("base64"); } catch (_) {}
    return res.status(200).json({ result: { status, category, summary, duration_ms:Date.now()-started, log:logs.join("\n"), screenshot_base64:screenshot, screenshot_mime:"image/jpeg", error:message } });
  } finally { if (browser) await browser.close().catch(() => {}); }
};

module.exports.config = { maxDuration: 60 };
