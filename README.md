# laitest.tech

[laitest.tech](https://laitest.tech) 是 Luckline 的个人站与产品中心，集中承载个人介绍、产品发布、内容沉淀和用户入口。

仓库同时包含静态站点、本地 Python 服务、Vercel Serverless API，以及三个持续迭代的产品：

| 产品 | 定位 | 主要入口 |
| --- | --- | --- |
| 铭测 MingTest | AI 测试设计与自动化执行工作台 | `/mingtest`、`/mingtest-tools` |
| 时光智行 TimeLens | AI 旅行规划、路线分享、出发清单与旅行记录 | `/timelens`、`/travel/<route-id>` |
| 锦食铭味 jmfood | 餐饮门店扫码点餐与经营管理 | `/jmfood`、`/jmfood-admin` |

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 20+（运行前端脚本、冒烟测试或 Serverless Playwright 执行器时需要）

### 本地运行

基础服务只依赖 Python 标准库，无需先安装依赖：

```bash
git clone <repository-url>
cd laitest
python3 -m laitest
```

服务默认监听 `http://127.0.0.1:8080`。也可以指定地址和端口：

```bash
python3 -m laitest serve --host 0.0.0.0 --port 8080
```

常用页面：

- 个人主页：<http://127.0.0.1:8080/>
- 铭测工作台：<http://127.0.0.1:8080/mingtest>
- 铭测定价：<http://127.0.0.1:8080/mingtest-pricing>
- 时光智行：<http://127.0.0.1:8080/timelens>

如需在本地执行真实浏览器用例，再安装 Playwright：

```bash
python3 -m pip install -r requirements-playwright.txt
playwright install chromium
```

Vercel Python Functions 使用 Flask；需要单独调试线上函数结构时安装：

```bash
python3 -m pip install -r requirements.txt
```

### CLI 示例

```bash
python3 -m laitest cli health
python3 -m laitest cli project-create demo
python3 -m laitest cli projects
python3 -m laitest cli ai-generate --prompt "登录连续失败 5 次后锁定账户"
```

执行 `python3 -m laitest cli --help` 查看完整命令。

## 项目结构

```text
.
├── index.html                    # 个人主页
├── app.html / app.js            # 铭测工作台
├── lingtest-*.html / .js        # 铭测登录、定价、管理与工具页面
├── timelens.html / .js          # 时光智行 PC 版
├── timelens-route.html / .js    # 公开路线详情
├── jmfood.html                  # 锦食铭味产品页
├── jmfood-admin.html / .js      # 商家与平台管理后台
├── css/                         # 页面与组件样式
├── img/                         # 图片、二维码与图标
├── api/
│   ├── index.py                 # Vercel Flask API
│   ├── execute_case.js          # Serverless Playwright 执行器
│   ├── timelens_share.py        # 路线分享与 SEO 页面
│   └── content_share.py         # 内容页与 SEO 页面
├── laitest/                     # 本地服务、CLI、AI、数据库与执行逻辑
├── scripts/                     # 测试、内容构建与发布检查
├── examples/                    # API 调用示例
└── vercel.json                  # Vercel 构建、路由与安全响应头
```

## 技术架构

| 层级 | 实现 |
| --- | --- |
| 前端 | 原生 HTML、CSS、JavaScript |
| 本地后端 | Python 标准库 `ThreadingHTTPServer` |
| 线上 API | Vercel Python Functions + Flask |
| 页面执行 | Vercel Node Function + Playwright Core + Serverless Chromium |
| 本地数据 | SQLite，默认保存到 `.laitest/laitest.db` |
| TimeLens 云数据 | `https://timelens.cc` |
| 部署与统计 | Vercel、Vercel Web Analytics |

本地服务和线上 API 提供相同的核心项目、用例、运行及 AI 能力；静态页面在本地由 Python 服务托管，生产环境由 Vercel 路由分发。

## 核心功能

### 铭测 MingTest

铭测将测试设计和自动化执行拆成两个工作区。用例生成采用六步流水线：

1. 需求与 Spec 验证
2. 风险计划
3. 端拆分
4. 覆盖维度设计
5. 详细用例生成
6. Case Home JSON 交付

`sketch` 模式适合轻量需求，`standard` 模式适合原始需求与 SDD 联合驱动。生成结果包含需求问题、风险分布、测试设计方法、追溯矩阵和结构化用例；远程模型不可用时会回退到本地启发式生成。

页面执行器使用角色、标签、占位符、可见文本和表单语义定位元素，并遵守以下限制：

- 只接受公网 `http/https` 地址，拒绝 localhost、内网 IP 和高风险目标
- 单条用例最多执行 12 个步骤
- 同一来源默认每分钟最多执行 6 次
- 只有明确断言成立才判定通过
- 不绕过验证码或目标网站风控

游客、免费账户和专业版使用不同的生成与执行额度。专业版申请、审核、激活和用量由 `timelens.cc` 的铭测接口管理，管理员令牌通过服务端环境配置。

### 时光智行 TimeLens

时光智行支持公开路线广场、目的地搜索、AI 旅行规划、旅行工作台、出发清单、逐日记录、城市足迹、路线评论与分享。PC 端账号可通过已绑定手机号关联原微信小程序数据。

业务数据和目的地数据由 `https://timelens.cc` 提供；目的地服务不可用时，创建计划仍可手动输入目的地。

### 锦食铭味 jmfood

锦食铭味面向餐饮门店，覆盖多门店、桌码、菜单、订单和员工角色权限；香满碗为首个接入门店。

## 页面与路由

| 路径 | 说明 |
| --- | --- |
| `/` | 个人主页、作品与联系方式 |
| `/mingtest`、`/app` | 铭测工作台 |
| `/mingtest-pricing` | 铭测版本、服务与专业版申请 |
| `/mingtest-login` | 铭测登录与注册 |
| `/mingtest-admin` | 申请审核与激活码管理 |
| `/mingtest-tools` | JSON、Diff、正则、时间戳和 Base64 等前端工具 |
| `/timelens` | 时光智行 PC 版 |
| `/travel/<route-id>` | SEO 友好的公开路线详情 |
| `/content`、`/articles/<slug>` | 内容中心与文章详情 |
| `/jmfood`、`/jmfood-admin` | 锦食铭味产品页与管理后台 |
| `/privacy.html`、`/terms.html`、`/security.html` | 隐私、条款与安全说明 |

旧的 `/lingtest*`、`/library` 和 `/articles` 等路径由 `vercel.json` 永久重定向或兼容处理。

## API

### 本仓库接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 服务健康检查 |
| `GET` | `/api/ai/status` | AI 配置状态 |
| `GET/POST` | `/api/projects` | 项目管理 |
| `GET/POST` | `/api/suites` | 测试套件管理 |
| `GET/POST` | `/api/cases` | 测试用例管理 |
| `GET/POST` | `/api/runs` | 测试运行管理 |
| `POST` | `/api/ai/generate_cases` | 生成测试用例与完整流水线结果 |
| `POST` | `/api/ai/pipeline_stage` | 单独执行某个测试设计阶段 |
| `POST` | `/api/ai/execute_case` | 执行页面用例 |
| `POST` | `/api/ai/travel_plan` | 生成旅行计划 |

设置 `LAITEST_TOKEN` 后，所有 `/api/*` 请求都需要携带：

```http
Authorization: Bearer <LAITEST_TOKEN>
```

生成测试用例示例：

```bash
curl -X POST "http://127.0.0.1:8080/api/ai/generate_cases" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "登录连续失败 5 次后锁定账户",
    "model_provider": "deepseek",
    "generation_mode": "standard",
    "sdd_spec": "连续失败 5 次后锁定 30 分钟，登录成功进入首页",
    "code_diff": "可选：关键改动文件与代码 diff"
  }'
```

生成旅行计划示例：

```bash
curl -X POST "http://127.0.0.1:8080/api/ai/travel_plan" \
  -H "Content-Type: application/json" \
  -d '{"user_input":"带父母去日本关西玩 5 天，预算 2 万元，节奏轻松"}'
```

Node.js 调用示例见 `examples/shiguang_touka_travel_plan_client.js`。

### 外部业务接口

铭测账户、历史、商业化与用量，以及时光智行数据由 `https://timelens.cc/api` 提供。主要包括：

- `/api/lingtest/generations`：铭测生成历史
- `/api/lingtest/leads`：专业版或服务申请
- `/api/lingtest/licenses/*`：权益查询与激活
- `/api/lingtest/usage/*`：额度查询与扣减
- `/api/user/info`：统一账户信息
- `/api/destinations*`：目的地树与搜索
- `/api/trips/:id/comments`：公开路线评论
- `/api/notifications*`：站内消息

这些接口的数据库迁移和服务端实现位于独立的 `timelens-server` 项目。

## 环境变量

本地启发式用例生成无需模型密钥；配置任一支持的模型后会优先调用远程模型。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `LAITEST_TOKEN` | 空 | API Bearer Token；为空时不校验 |
| `LAITEST_DATA_DIR` | `.laitest` | SQLite 数据目录 |
| `LAITEST_DEFAULT_LANG` | `zh-CN` | 默认生成语言 |
| `DEEPSEEK_API_KEY` | 空 | DeepSeek API Key |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | DeepSeek 模型 |
| `QIANWEN_API_KEY` | 空 | 通义千问 API Key |
| `QIANWEN_MODEL` | `qwen-plus` | 通义千问模型 |
| `GEMINI_API_KEY` | 空 | Gemini API Key |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini 模型 |
| `AI_SYSTEM_PROMPT` | 内置 | 自定义用例 System Prompt |
| `AI_CASE_PROMPT_TEMPLATE` | 内置 | 自定义用例提示词模板 |
| `AI_TRAVEL_SYSTEM_PROMPT` | 内置 | 自定义旅行规划 System Prompt |
| `AI_TRAVEL_PROMPT_TEMPLATE` | 内置 | 自定义旅行规划提示词模板 |
| `LINGTEST_QUOTA_API_URL` | timelens.cc 用量接口 | 铭测统一用量扣减地址 |
| `PLAYWRIGHT_WS_ENDPOINT` | 空 | 远程浏览器 WebSocket 地址 |
| `PLAYWRIGHT_CJK_FONT_URL` | 空 | 页面执行时使用的 CJK Web Font |

模型超时、重试、代理地址和 Token 上限等高级参数见 `laitest/ai.py`。

## 测试与质量检查

安装 Node.js 依赖：

```bash
npm install
```

运行主要测试：

```bash
npm run test:pipeline
npm run test:timelens-plan
npm run test:execute-case
npm run smoke:local
```

其他专项测试位于 `scripts/test-*.py`。提交前建议至少执行：

```bash
PYTHONPATH=. python3 scripts/test-content-share.py
PYTHONPATH=. python3 scripts/test-timelens-seo.py
node --check app.js
node --check timelens.js
python3 -m json.tool vercel.json >/dev/null
git diff --check
```

生产环境冒烟检查：

```bash
npm run smoke:prod
```

也可以通过 `SMOKE_BASE_URL` 检查预览环境。

## 内容维护与部署

常用维护入口：

| 内容 | 文件 |
| --- | --- |
| 首页内容 | `index.html`、`home-content.js` |
| 铭测工作台 | `app.html`、`app.js` |
| 铭测账户与版本 | `lingtest-account.js`、`css/lingtest-account.css` |
| 时光智行 | `timelens.html`、`timelens.js`、`timelens-plan.js` |
| 跨产品导航 | `product-nav.js`、`css/product-nav.css` |
| SEO 页面清单 | `sitemap.xml` |
| Vercel 路由与响应头 | `vercel.json` |

新增公开页面时，需要同步检查 `vercel.json`、`sitemap.xml`、canonical URL 和 Open Graph 信息。修改静态 CSS/JS 后，应更新页面引用的版本参数，避免旧缓存。

`main` 分支推送后由 Vercel 自动部署：

```bash
git push origin main
```

生产密钥应配置在 Vercel Project → Settings → Environment Variables，禁止写入仓库。

## 安全约定

- 不提交 API Key、Access Token、密码、激活码或 `.laitest/` 数据库。
- 页面执行功能仅用于已获授权的目标。
- 生产密钥应定期轮换。
- 对外政策见 `privacy.html`、`terms.html` 和 `security.html`。
