# laitest.tech

Luckline 的个人站与产品集合。目前包含：

- **个人主页**：作品、测试内容、个人介绍与联系方式
- **领测 LingTest**：AI 测试设计与质量工作台，提供用例生成、管理、轻量执行与结果汇总
- **时光透卡 Web**：旅行路线、计划工作台、城市足迹与可分享路线详情
- **JSON API / CLI**：供自动化流程、本地工具和其他服务调用

生产站点：[https://laitest.tech](https://laitest.tech)

## 站点路由

| 路径 | 说明 |
| --- | --- |
| `/` | Luckline 个人主页与作品入口 |
| `/app` | 领测 LingTest · AI 测试设计与质量工作台 |
| `/timelens` | 时光透卡 PC 工作台 |
| `/timelens-route?id=<route-id>` | 可独立转发的路线详情页 |
| `/api/health` | 服务健康检查 |
| `/api/ai/generate_cases` | AI 测试用例生成 |
| `/api/ai/travel_plan` | AI 旅行规划 |

## 技术结构

- 前端：原生 HTML、CSS、JavaScript
- 后端：Python；本地使用标准库 HTTP Server，Vercel 使用 Flask
- 数据：SQLite，默认位于 `.laitest/laitest.db`
- 部署：Vercel，配置见 `vercel.json`
- 统计：Vercel Web Analytics（Hobby 免费版）
- SEO：`robots.txt`、`sitemap.xml`、Open Graph、JSON-LD、Web Manifest

主要文件：

```text
.
├── index.html                 # 个人主页
├── app.html / app.js          # 领测 LingTest 工作台
├── timelens.html              # 时光透卡 PC 工作台
├── timelens.js
├── timelens-route.html        # 独立路线详情页
├── timelens-route.js
├── css/                       # 各页面样式
├── img/                       # 站点图片、二维码与图标
├── api/index.py               # Vercel Flask API
├── laitest/                   # 本地服务、CLI、AI 与执行引擎
├── examples/                  # API 调用示例
├── site-analytics.js          # 站点事件标识
└── vercel.json                # 部署和路由配置
```

## 本地运行

要求 Python 3.10+。

```bash
cd /Users/user/Documents/laitest
python3 -m laitest
```

默认访问地址：

- 个人主页：<http://127.0.0.1:8080/>
- 领测 LingTest：<http://127.0.0.1:8080/app>
- 时光透卡：<http://127.0.0.1:8080/timelens.html>

CLI 示例：

```bash
python3 -m laitest cli health
python3 -m laitest cli project-create demo
python3 -m laitest cli projects
```

## API

### 基础接口

- `GET /api/health`
- `GET/POST /api/projects`
- `GET/POST /api/suites`
- `GET/POST /api/cases`
- `POST /api/runs`
- `GET /api/runs`
- `POST /api/ai/generate_cases`
- `POST /api/ai/travel_plan`

如配置 `LAITEST_TOKEN`，调用 API 时需要携带：

```http
Authorization: Bearer <LAITEST_TOKEN>
```

### 生成测试用例

```bash
curl -X POST "http://127.0.0.1:8080/api/ai/generate_cases" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "登录连续失败 5 次后锁定账户",
    "model_provider": "deepseek"
  }'
```

支持 `deepseek`、`qianwen`、`gemini`。未指定模型时按可用配置自动选择，远程调用失败后回退到本地启发式生成。

### 生成旅行计划

```bash
curl -X POST "http://127.0.0.1:8080/api/ai/travel_plan" \
  -H "Content-Type: application/json" \
  -d '{
    "user_input": "带父母去日本关西玩 5 天，预算 2 万元，节奏轻松"
  }'
```

请求支持 `prompt`、`user_input` 或 `input` 字段。Node.js 调用示例见 `examples/shiguang_touka_travel_plan_client.js`。

## AI 配置

常用环境变量：

| 环境变量 | 用途 |
| --- | --- |
| `LAITEST_TOKEN` | API Bearer Token；不设置则不启用鉴权 |
| `LAITEST_DATA_DIR` | SQLite 数据目录 |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `DEEPSEEK_MODEL` | 默认 `deepseek-chat` |
| `PLAYWRIGHT_WS_ENDPOINT` | 可选的远程 Playwright WebSocket 地址；留空时 Vercel 使用内置 Serverless Chromium |
| `PLAYWRIGHT_CJK_FONT_URL` | 可选的 HTTPS 中日韩字体地址；执行页面通过 Web Font 加载，字体失败不会阻断测试 |

### Playwright 页面自动化

领测生成用例后，可填写测试环境 URL 并逐条或批量执行。执行结果会在用例列表中显示，通过“查看详情”可以检查步骤日志与失败现场截图。

执行器采用通用页面模型：优先根据 `role`、`label`、`placeholder`、可见文本和表单语义定位元素，不绑定特定网站。执行结论区分通过、失败、页面需确认和网站风控拦截；验证码不会被自动绕过。

P0 保护与可信结果：每个用例最多 12 个步骤，同一来源默认每分钟最多执行 6 次；只有明确的文本、标题、URL 或可见性断言通过后才判定成功。最近用例和最多 12 条执行摘要保存在当前浏览器的 `localStorage` 中。

- 本地：执行 `pip install -r requirements-playwright.txt`，然后执行 `playwright install chromium`。
- Vercel：默认使用 `@sparticuz/chromium` 提供的 Serverless Chromium，无需额外下载浏览器；如需更高并发或更长任务，也可以配置 `PLAYWRIGHT_WS_ENDPOINT` 连接远程浏览器。
- 安全：执行接口仅接受公网 `http/https` 地址，拒绝 localhost 和内网 IP，避免服务端请求伪造。
| `QIANWEN_API_KEY` | 通义千问 API Key |
| `QIANWEN_MODEL` | 默认 `qwen-plus` |
| `GEMINI_API_KEY` | Gemini API Key |
| `GEMINI_MODEL` | 默认 `gemini-2.0-flash` |
| `AI_DEFAULT_CASES` | 默认生成用例数量，默认 `10` |
| `AI_SYSTEM_PROMPT` | 自定义测试用例 System Prompt |
| `AI_CASE_PROMPT_TEMPLATE` | 自定义测试用例提示词模板 |
| `AI_TRAVEL_SYSTEM_PROMPT` | 自定义旅行规划 System Prompt |
| `AI_TRAVEL_PROMPT_TEMPLATE` | 自定义旅行规划提示词模板 |

超时、重试、Token 上限等高级配置请查看 `laitest/ai.py` 中对应的环境变量读取逻辑。

## 时光透卡

PC 版提供：

- 公开路线广场
- 路线合集与逐日行程
- 可独立分享的路线详情 URL
- 旅行计划、清单和单日记录
- 城市足迹地图
- 微信小程序二维码与扫码登录引导
- 通过访问令牌同步云端数据

时光透卡公开数据由 `https://timelens.cc` API 提供。PC 浏览器无法直接调用微信小程序的 `wx.login`；扫码登录小程序与 PC Access Token 同步是两个独立步骤。

## 内容与图片维护

- 首页作品与文字：`index.html`
- 首页样式：`css/marketing.css`、`css/personal-content.css`
- 测试文章链接：`index.html` 中的 `project-resources`
- 公众号二维码：`img/qrcode_laitest.jpg`
- 时光透卡小程序码：`img/timelens-miniapp.jpg`
- SEO 页面清单：`sitemap.xml`

新增公开页面时，请同步更新 `vercel.json` 和 `sitemap.xml`。

## Analytics

项目使用 Vercel Web Analytics 静态脚本。Vercel 项目控制台需要启用 Web Analytics；部署后访问网站即可产生页面访问数据。

`site-analytics.js` 为关键按钮提供统一事件命名。Hobby 免费版提供页面访问统计但不展示自定义事件；升级或切换统计服务时，可继续复用页面上的 `data-event` 标识。

## 部署

仓库 `main` 分支推送后由 Vercel 自动部署：

```bash
git push origin main
```

部署前建议执行：

```bash
node --check app.js
node --check timelens.js
node --check timelens-route.js
python3 -m json.tool vercel.json >/dev/null
```

## 安全说明

- 不要提交 API Key、Access Token 或 `.laitest/` 数据库。
- 生产环境密钥通过 Vercel Environment Variables 配置。
- `privacy.html`、`terms.html` 和 `security.html` 为站点公开政策页面。

## 后续方向

- 作品、文章和社交账号的数据化维护
- 产品更新日志与订阅入口
- 路线详情服务端动态 OG 分享卡片
- 自媒体内容聚合和运营看板
- 领测 LingTest 的 CI、通知、失败聚类与 Flaky 检测
