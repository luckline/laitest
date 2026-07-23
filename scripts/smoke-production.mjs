const baseUrl = String(process.env.SMOKE_BASE_URL || "https://laitest.tech").replace(/\/$/, "");
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 15000);
const routeId = "seed-trip-2026-north-xinjiang-0925";
const isLocal = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(baseUrl);
const localHtmlRoutes = new Map([
  ["/app", "/app.html"], ["/mingtest", "/app.html"],
  ["/mingtest-pricing", "/lingtest-pricing.html"], ["/mingtest-login", "/lingtest-login.html"],
  ["/mingtest-admin", "/lingtest-admin.html"], ["/mingtest-guides", "/lingtest-guides.html"],
  ["/mingtest-tools", "/lingtest-tools.html"], ["/timelens", "/timelens.html"],
  ["/timelens-route", "/timelens-route.html"],
]);

const checks = [
  {
    name: "个人主页",
    path: "/",
    contains: ["Luckline", 'href="/mingtest"', 'href="/timelens"', "product-nav.js?v=5", "home-v6.css?v=1", "直接进入产品", "AI QUALITY WORKSPACE", "AI TRAVEL WORKSPACE", "lingtest-workspace-preview.png", "timelens-workspace-preview.png", "img/og-cover.png"],
  },
  {
    name: "铭测产品页",
    path: "/mingtest",
    contains: ["铭测 MingTest", "从需求分析到测试资产交付", "product-nav.js?v=5", "lingtest-account.js?v=5", "AI 用例设计", "自动化执行", "API 自动化", 'data-workspace-mode="tools"', 'id="toolsWorkspace"', "/mingtest-tools?embed=1"],
  },
  {
    name: "铭测工作台",
    path: "/app",
    contains: ["AI QUALITY WORKSPACE", "product-nav.js?v=5", "lingtest-account.js?v=5", "app-shell-fix.css?v=5", "system-density.css?v=2", "workspace-polish.css?v=2", "api-testing-v2.css?v=2", "api-testing.js?v=5", "app.js?v=workspace-menu-2", "lingtest-execution.css?v=2", "lingtest-pipeline.css?v=4", "从需求分析到测试资产交付", "AI 用例设计", "自动化执行", "executionWorkspace", "快速生成", "文档驱动", "高级模式", "分步调试", "运行当前技能", "一键运行完整流程", "导入 OpenAPI / cURL", "apiImportDialog", "sddSpecFile", "Case Home JSON", "我的生成记录", "登录后次数翻倍", "PRO ACTIVATION", 'id="aiPrompt"'],
  },
  {
    name: "铭测定价",
    path: "/mingtest-pricing",
    contains: ["免费版", "专业版", "测试落地服务", "leadDialog", "lingtest-pricing.js?v=3"],
  },
  {
    name: "铭测申请脚本",
    path: "/lingtest-pricing.js?v=3",
    contains: ["/api/lingtest/leads", "lingtest_lead_submitted", "正在提交"],
  },
  {
    name: "铭测登录注册",
    path: "/mingtest-login",
    contains: ["登录后继续", "注册新账户", "lingtest-login.js?v=1"],
  },
  {
    name: "铭测登录脚本",
    path: "/lingtest-login.js?v=1",
    contains: ["/auth/mobile/register", "/auth/mobile/password-login", "timelens.pc.token", "intent"],
  },
  {
    name: "铭测管理后台",
    path: "/mingtest-admin",
    contains: ["noindex,nofollow", "管理员登录", "专业版申请", "lingtest-admin.js?v=1"],
  },
  {
    name: "铭测管理脚本",
    path: "/lingtest-admin.js?v=1",
    contains: ["lingtest:admin-token", "/admin/leads", "activationCode"],
  },
  {
    name: "铭测版本入口",
    path: "/lingtest-account.js?v=5",
    contains: ["当前版本", "专业版 PRO", "生成额度", "执行额度", "mingtest:usage-updated", "contactMasked", "LICENSE_API", "/status?browserId="],
  },
  {
    name: "铭测方法库",
    path: "/mingtest-guides",
    contains: ["方法与实践", 'href="/mingtest"', "product-nav.js?v=5"],
  },
  {
    name: "铭测工具箱",
    path: "/mingtest-tools",
    contains: ["JSON 格式化与校验", "Diff 文本对比", "正则表达式测试器", "Unix 时间戳转换", "Base64 编解码", "lingtest-tools.js?v=2", "lingtest-tools.css?v=3", "仅浏览器本地运行"],
  },
  {
    name: "铭测工具脚本",
    path: "/lingtest-tools.js?v=2",
    contains: ["normalizeTimestamp", "TextEncoder", "TextDecoder", "jsonHighlight", "diffLines", "runRegex", "tools-embedded"],
  },
  {
    name: "接口自动化状态脚本",
    path: "/api-testing.js?v=5",
    contains: ["apiProjectEmpty", "api-hidden", "parseOpenApi", "parseCurl", "apiImportDialog"],
  },
  {
    name: "接口自动化增强样式",
    path: "/css/api-testing-v2.css?v=2",
    contains: ["#apiProjectEmpty[hidden]", "#apiProjectPanel[hidden]", "api-request-builder", "api-rule-row"],
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
      'src="/timelens.js?v=profile-favorites',
    ],
  },
  {
    name: "时光智行注册",
    path: "/timelens.js?v=profile-favorites",
    contains: ["注册新账户", "/api/auth/mobile/register", "travel_plan", "ai-plans/latest", "savePlanRecord", "DEFAULT_CHECKLIST", "创口贴", "/api/trips/liked", "我收藏的路线"],
  },
  {
    name: "路线方案格式化",
    path: "/timelens-plan.js?v=1",
    contains: ["TimeLensPlan", "travel-plan-section", "AI TRAVEL PLAN"],
  },
  {
    name: "公开路线详情",
    path: `/timelens-route?id=${routeId}`,
    contains: ["时光智行", 'id="routeContent"', "timelens-route.js?v=cover-fallback"],
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
  {
    name: "搜索站点地图",
    path: "/sitemap.xml",
    contains: ["https://laitest.tech/mingtest-tools", "https://laitest.tech/timelens", "2026-07-22"],
  },
];

async function request(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    let response = await fetch(`${baseUrl}${path}`, {
      redirect: "follow",
      headers: { "user-agent": "laitest-production-smoke/1.0" },
      signal: controller.signal,
    });
    if (isLocal && response.status === 404) {
      const url = new URL(path, baseUrl);
      const localFile = localHtmlRoutes.get(url.pathname);
      if (localFile) response = await fetch(`${baseUrl}${localFile}${url.search}`, { signal: controller.signal });
    }
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

async function runSecurityHeaderCheck() {
  const { response, elapsed } = await request("/");
  const expected = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=()",
    "content-security-policy": "frame-ancestors 'none'",
  };
  const missing = Object.entries(expected).filter(([name, value]) => !String(response.headers.get(name) || "").includes(value));
  if (missing.length) throw new Error(`缺少安全响应头：${missing.map(([name]) => name).join("、")}`);
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

if (!isLocal) {
  try {
    const elapsed = await runHealthCheck();
    console.log(`✓ ${"健康接口".padEnd(12)} ${String(elapsed).padStart(5)}ms  /api/health`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${"健康接口".padEnd(12)} /api/health\n  ${error.message}`);
  }
}

if (/^https:\/\//.test(baseUrl)) {
  try {
    const elapsed = await runSecurityHeaderCheck();
    console.log(`✓ ${"安全响应头".padEnd(12)} ${String(elapsed).padStart(5)}ms  /`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${"安全响应头".padEnd(12)} /\n  ${error.message}`);
  }
}

if (failures) {
  console.error(`\n冒烟检查失败：${failures} 项\n`);
  process.exitCode = 1;
} else {
  console.log(`\n冒烟检查通过：${checks.length + (isLocal ? 0 : 1) + (/^https:\/\//.test(baseUrl) ? 1 : 0)} 项\n`);
}
