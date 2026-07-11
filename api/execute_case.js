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

async function runStep(page, step, logs) {
  const action = String(step?.action || "").trim();
  await fillFields(page, dataMap(step?.test_data), logs);
  const click = action.match(/(?:点击|单击|按下)[「『\"']?([^，,。；;|「』\"']+?)[」』\"']?(?:按钮|链接|$)/);
  if (click) {
    const label = click[1].trim();
    let target = page.getByRole("button", { name: new RegExp(label, "i") });
    if (!(await target.count())) target = page.getByText(label, { exact: true });
    await target.first().click({ timeout: 8000 }); logs.push(`点击 ${label}`); return;
  }
  const label = ["登录","提交","确认","保存","下一步"].find((word) => action.includes(word));
  if (label) { await page.getByRole("button", { name: new RegExp(label, "i") }).first().click({ timeout: 8000 }); logs.push(`点击 ${label}`); }
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
    page.on("console", (msg) => logs.push(`console.${msg.type()}: ${msg.text()}`));
    page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 }); logs.push(`打开 ${target}`);
    for (const [index, step] of (testCase.steps || []).entries()) { logs.push(`STEP ${index + 1} START`); await runStep(page, step, logs); await page.waitForTimeout(500); logs.push(`STEP ${index + 1} PASS`); }
    const shot = await page.screenshot({ type: "jpeg", quality: 70 });
    return res.status(200).json({ result: { status:"passed", duration_ms:Date.now()-started, log:logs.join("\n"), screenshot_base64:shot.toString("base64"), screenshot_mime:"image/jpeg", final_url:page.url() } });
  } catch (error) {
    logs.push(`FAILED: ${error?.name || "Error"}: ${error?.message || error}`);
    let screenshot = "";
    try { if (page) screenshot = (await page.screenshot({ type:"jpeg", quality:70 })).toString("base64"); } catch (_) {}
    return res.status(200).json({ result: { status:"failed", duration_ms:Date.now()-started, log:logs.join("\n"), screenshot_base64:screenshot, screenshot_mime:"image/jpeg", error:String(error?.message || error) } });
  } finally { if (browser) await browser.close().catch(() => {}); }
};

module.exports.config = { maxDuration: 60 };
