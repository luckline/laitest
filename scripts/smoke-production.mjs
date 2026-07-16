const baseUrl = String(process.env.SMOKE_BASE_URL || "https://laitest.tech").replace(/\/$/, "");
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 15000);
const routeId = "seed-trip-2026-north-xinjiang-0925";

const checks = [
  {
    name: "个人主页",
    path: "/",
    contains: ["Luckline", 'href="/lingtest"', 'href="/timelens"', "product-nav.js?v=5", "5 类 · 22 项出发清单", "home-growth-p0.css?v=2", "product-visuals.css?v=1", "lingtest-workspace-preview.png", "timelens-workspace-preview.png"],
  },
  {
    name: "领测产品页",
    path: "/lingtest",
    contains: ["领测 LingTest", 'href="/app"', "product-nav.js?v=5", "lingtest-account.js?v=5", "一张图看懂：需求如何变成测试证据", "evidence-board", "product-visuals.css?v=1"],
  },
  {
    name: "领测工作台",
    path: "/app",
    contains: ["AI QUALITY WORKSPACE", "product-nav.js?v=5", "lingtest-account.js?v=5", "app-shell-fix.css?v=5", "quota-metering-1", "登录后次数翻倍", "PRO ACTIVATION", 'id="aiPrompt"'],
  },
  {
    name: "领测定价",
    path: "/lingtest-pricing",
    contains: ["免费版", "专业版", "测试落地服务", "leadDialog", "lingtest-pricing.js?v=3"],
  },
  {
    name: "领测申请脚本",
    path: "/lingtest-pricing.js?v=3",
    contains: ["/api/lingtest/leads", "lingtest_lead_submitted", "正在提交"],
  },
  {
    name: "领测登录注册",
    path: "/lingtest-login",
    contains: ["登录后继续", "注册新账户", "lingtest-login.js?v=1"],
  },
  {
    name: "领测登录脚本",
    path: "/lingtest-login.js?v=1",
    contains: ["/auth/mobile/register", "/auth/mobile/password-login", "timelens.pc.token", "intent"],
  },
  {
    name: "领测管理后台",
    path: "/lingtest-admin",
    contains: ["noindex,nofollow", "管理员登录", "专业版申请", "lingtest-admin.js?v=1"],
  },
  {
    name: "领测管理脚本",
    path: "/lingtest-admin.js?v=1",
    contains: ["lingtest:admin-token", "/admin/leads", "activationCode"],
  },
  {
    name: "领测版本入口",
    path: "/lingtest-account.js?v=5",
    contains: ["当前版本", "专业版 PRO", "contactMasked", "/licenses/status"],
  },
  {
    name: "领测方法库",
    path: "/lingtest-guides",
    contains: ["方法与实践", 'href="/app"', "product-nav.js?v=5"],
  },
  {
    name: "时光智行",
    path: "/timelens",
    contains: [
      "时光智行 - TimeLens 官方网站",
      'name="description"',
      "TimeLens（时光智行，原时光透卡）是一款 AI 旅行规划与城市足迹工具",
      "<h1>时光智行",
      'src="/timelens-plan.js?v=1',
      'src="/timelens.js?v=trip-duration',
    ],
  },
  {
    name: "时光智行注册",
    path: "/timelens.js?v=trip-duration",
    contains: ["注册新账户", "/api/auth/mobile/register", "travel_plan", "ai-plans/latest", "savePlanRecord", "DEFAULT_CHECKLIST", "创口贴"],
  },
  {
    name: "路线方案格式化",
    path: "/timelens-plan.js?v=1",
    contains: ["TimeLensPlan", "travel-plan-section", "AI TRAVEL PLAN"],
  },
  {
    name: "公开路线详情",
    path: `/timelens-route?id=${routeId}`,
    contains: ["时光智行", 'id="routeContent"', "timelens-route.js?v=comment-replies"],
  },
  {
    name: "产品导航脚本",
    path: "/product-nav.js?v=5",
    contains: ["product!=='luckline'", "site-home-link", "返回 Luckline 个人主页", "home.textContent='主页'"],
  },
  {
    name: "产品导航样式",
    path: "/css/product-nav.css?v=3",
    contains: [".unified-nav", ".site-home-link", ".nav-mobile-toggle"],
  },
  {
    name: "百度站点验证",
    path: "/baidu_verify_codeva-XOPq3AJQbN.html",
    contains: ["4c28ae6da214724cdcbc953178f166ac"],
  },
];

async function request(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      redirect: "follow",
      headers: { "user-agent": "laitest-production-smoke/1.0" },
      signal: controller.signal,
    });
    const body = await response.text();
    return { response, body, elapsed: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

async function runPageCheck(check) {
  const { response, body, elapsed } = await request(check.path);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const missing = check.contains.filter((text) => !body.includes(text));
  if (missing.length) throw new Error(`缺少关键内容：${missing.join("、")}`);
  return elapsed;
}

async function runHealthCheck() {
  const { response, body, elapsed } = await request("/api/health");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("返回内容不是 JSON");
  }
  const healthy = payload.ok === true || payload.status === "ok" || payload.success === true;
  if (!healthy) throw new Error(`健康状态异常：${body.slice(0, 160)}`);
  return elapsed;
}

console.log(`\n生产冒烟检查：${baseUrl}\n`);
let failures = 0;
for (const check of checks) {
  try {
    const elapsed = await runPageCheck(check);
    console.log(`✓ ${check.name.padEnd(12)} ${String(elapsed).padStart(5)}ms  ${check.path}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${check.name.padEnd(12)} ${check.path}\n  ${error.message}`);
  }
}

try {
  const elapsed = await runHealthCheck();
  console.log(`✓ ${"健康接口".padEnd(12)} ${String(elapsed).padStart(5)}ms  /api/health`);
} catch (error) {
  failures += 1;
  console.error(`✗ ${"健康接口".padEnd(12)} /api/health\n  ${error.message}`);
}

if (failures) {
  console.error(`\n冒烟检查失败：${failures} 项\n`);
  process.exitCode = 1;
} else {
  console.log(`\n冒烟检查通过：${checks.length + 1} 项\n`);
}
