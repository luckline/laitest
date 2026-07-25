# laitest.tech

Luckline 的个人站与产品中心，统一承载个人介绍、产品发布、内容沉淀和用户入口。

当前包含两个持续迭代的产品：

- **铭测 MingTest**：AI 测试设计与质量工作台，将“AI 用例设计”和“自动化执行”拆成两个独立工作区；以“快速生成 / 文档驱动”双模式完成需求验证、风险计划、覆盖设计与结构化用例，再将确认后的用例同步至 Playwright 执行区查看日志和失败截图。六个测试设计 Skill 支持分步调试或一键运行，文档驱动模式支持上传 TXT、Markdown、JSON、YAML、CSV 等需求文件。
- **时光智行 TimeLens**（原时光透卡）：AI 旅行规划、公开路线、出发清单、逐日记录与城市足迹工具。

生产地址：[https://laitest.tech](https://laitest.tech)

## 站点地图

| 路径 | 页面 |
| --- | --- |
| `/` | Luckline 个人主页、作品与联系方式 |
| `/mingtest` | 铭测工作台（旧 `/lingtest` 永久跳转至此） |
| `/app` | 铭测工作台 |
| `/mingtest-pricing` | 铭测版本、服务与专业版申请 |
| `/mingtest-login` | 铭测登录与注册（专业版申请前置） |
| `/mingtest-admin` | 铭测申请审核与激活码管理（管理员 Token） |
| `/mingtest-guides` | 测试方法与质量工程实践 |
| `/mingtest-tools` | JSON、Diff、正则、时间戳和 Base64 等纯前端测试工具 |
| `/timelens` | 时光智行 PC 版 |
| `/travel/<route-id>` | SEO 友好的公开路线详情（旧 `/timelens-route?id=` 地址继续兼容） |
| `/privacy.html` | 隐私政策 |
| `/terms.html` | 使用条款 |
| `/security.html` | 安全说明 |
| `/api/health` | 服务健康检查 |
| `/api/ai/status` | AI 服务状态 |

顶部产品导航用于在个人主页、铭测和时光智行之间切换。个人主页以作品卡承接产品发现，产品页面通过“全部产品”完成跨产品导航。

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 20+（仅 Serverless Playwright 执行器和相关依赖需要）

### 启动本地服务

```bash
cd /Users/user/Documents/laitest
python3 -m laitest
```

默认地址：

- 个人主页：<http://127.0.0.1:8080/>
- 铭测产品页：<http://127.0.0.1:8080/mingtest>
- 铭测工作台：<http://127.0.0.1:8080/app>
- 铭测定价页：<http://127.0.0.1:8080/mingtest-pricing>
- 时光智行：<http://127.0.0.1:8080/timelens>

### 可选：安装页面自动化环境

```bash
pip install -r requirements-playwright.txt
playwright install chromium
```

### CLI

```bash
python3 -m laitest cli health
python3 -m laitest cli project-create demo
python3 -m laitest cli projects
```

## 技术架构

- 前端：原生 HTML、CSS、JavaScript
- 本地后端：Python 标准库 HTTP Server
- 线上 API：Vercel Python Functions + Flask
- 页面执行：Vercel Node Function + Playwright Core + Serverless Chromium
- 本地数据：SQLite，默认位于 `.laitest/laitest.db`
- 时光智行云数据：`https://timelens.cc`
- 部署：Vercel，`main` 分支推送后自动发布
- 统计：Vercel Web Analytics

### 主要目录

```text
.
├── index.html                     # 个人主页
├── lingtest.html                  # 铭测产品介绍
├── lingtest-guides.html           # 铭测方法库
├── lingtest-tools.html / .js      # 本地运行的常用测试工具箱
├── lingtest-pricing.html / .js    # 定价、服务、专业版申请与状态联动
├── lingtest-login.html / .js      # 铭测登录、注册与申请回跳
├── lingtest-admin.html / .js      # 专业版申请审核与激活码管理
├── lingtest-account.js            # 跨页面账户身份与版本组件
├── app.html / app.js              # 铭测工作台
├── laitest/test_pipeline.py       # 六步用例生成流水线、追溯矩阵与 Case Home 交付
├── timelens.html / timelens.js    # 时光智行 PC 版
├── timelens-route.html            # 公开路线详情
├── timelens-route.js
├── product-nav.js                 # 跨产品导航与产品切换
├── css/                           # 页面与组件样式
├── img/                           # 图片、二维码和图标
├── api/index.py                   # Vercel Flask API
├── api/execute_case.js            # Serverless Playwright 执行器
├── api/timelens_share.py          # 路线分享页面
├── laitest/                       # 本地服务、CLI、AI、数据库与执行逻辑
├── examples/                      # API 调用示例
├── site-analytics.js              # 统计事件标识
└── vercel.json                    # 构建、静态资源和路由配置
```

## 铭测 MingTest

核心流程：

1. 输入需求、验收标准或用户故事。
2. 调用 AI 生成结构化测试用例。
3. 覆盖正常、边界、异常和安全场景。
4. 使用 Playwright 在真实公网页面执行。
5. 查看结果分类、步骤日志和失败截图。

### 版本与商业化

- 游客按浏览器提供 5 次生成/日、15 次生成/月和 3 次执行/日、10 次执行/月；登录免费用户提升为 10/30 次生成和 6/20 次执行（日/月）
- `/mingtest-pricing` 展示免费版、专业版内测和测试落地服务
- 专业版申请写入 `timelens-server` 的 `lingtest_leads` 表
- 生产部署后端前需执行 `sql/023_lingtest_leads.sql`
- 管理员通过 `/mingtest-admin` 审核申请并生成 24 小时有效的一次性激活码
- 用户在工作台输入一次性激活码后开通专业版；登录用户的权益按已验证手机号关联
- 浏览器 ID 仅作为未登录场景和历史激活记录的兼容兜底
- 铭测产品页、工作台和定价页右上角统一展示当前版本；专业版使用紫金色标识
- 铭测复用同域登录态展示账户身份，并区分免费版、审核中、待激活和专业版状态
- 专业版用户进入定价页后隐藏重复申请操作，页面直接展示当前版本与工作台入口
- 点击版本入口可查看申请人称呼、脱敏联系方式、版本与有效期
- 管理员 Token 通过后端环境变量 `LINGTEST_ADMIN_TOKEN` 配置
- 审核与激活功能还需执行 `sql/024_lingtest_licenses.sql`
- 统一用量硬限制需执行 `sql/025_lingtest_usage.sql`；额度按账户或游客浏览器在后端原子扣减
- ¥59/月专业版：AI 生成 50 次/日、1,000 次/月；页面执行 80 次/日、1,500 次/月

专业版运营流程：

1. 游客在 `/mingtest-pricing` 点击申请后，先完成手机号注册或登录。
2. 登录成功后自动返回定价页，申请表自动填写已验证手机号。
3. 管理员在 `/mingtest-admin` 查看申请并完成审核。
4. 审核通过后生成 24 小时有效的一次性激活码。
5. 用户在 `/app` 输入激活码，专业版立即生效。
6. 登录用户后续通过已验证手机号识别权益，无需在每台设备重复申请。

账户身份来自时光智行的同域登录令牌，但铭测页面统一使用“登录”“账户”“当前版本”等产品中立文案，不向用户暴露跨产品实现细节。

执行器优先使用 `role`、`label`、`placeholder`、可见文本和表单语义定位元素，不绑定特定网站。验证码和网站风控不会被绕过。

当前安全限制：

- 仅接受公网 `http/https` 地址
- 拒绝 localhost、内网 IP 和高风险目标
- 单条用例最多执行 12 个步骤
- 同一来源默认每分钟最多执行 6 次
- 只有明确断言成立才判定通过
- 最近用例和最多 12 条执行摘要保存在浏览器 `localStorage`

## 时光智行 TimeLens

> 2026-07-16 起，“时光透卡”正式升级为“时光智行”。现有 `/timelens` 地址、账户、旅行计划及接口保持不变。

PC 版当前支持：

- 公开路线广场与目的地搜索
- 创建计划时可搜索目的地，或按国内/国外层级树逐层选择
- 路线广场可按目的地层级筛选；选择上级节点会包含全部子级路线
- 城市足迹按标准目的地聚合，展示国内、国外、目的地和点位数量
- AI 旅行规划
- 旅行计划工作台
- 出发清单与云端同步
- 单日旅行记录与路线合集
- 城市足迹地图
- 新用户手机号与独立密码注册、登录
- 原小程序用户通过激活码关联历史旅行数据
- 公开路线详情、相邻路线翻页和分享
- 微信小程序二维码引导

时光智行业务数据由 `https://timelens.cc` API 提供。PC 登录与小程序原微信数据通过已绑定手机号关联。

目的地选择器使用以下接口：

- `GET https://timelens.cc/api/destinations?scene=trip&format=tree`
- `GET https://timelens.cc/api/destinations/search?q=北疆&scene=trip&limit=20`

如果目的地服务暂时不可用，创建计划仍允许用户手动输入目的地。

## API

常用接口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/ai/status` | AI 配置状态 |
| GET/POST | `/api/projects` | 项目管理 |
| GET/POST | `/api/suites` | 测试套件 |
| GET/POST | `/api/cases` | 测试用例 |
| GET/POST | `/api/runs` | 测试运行 |
| POST | `/api/ai/generate_cases` | 生成测试用例 |
| POST | `/api/ai/pipeline_stage` | 分步运行需求验证、风险计划、需求拆分、覆盖设计或交付闭环 Skill |
| POST | `https://timelens.cc/api/lingtest/generations` | 登录用户保存需求、六步分析与完整用例 |
| GET | `https://timelens.cc/api/lingtest/generations` | 获取当前账号生成历史 |
| GET/DELETE | `https://timelens.cc/api/lingtest/generations/:id` | 恢复或删除当前账号生成记录 |
| POST | `/api/ai/execute_case` | 执行页面用例 |
| POST | `/api/ai/travel_plan` | 生成旅行计划 |

铭测商业化相关接口由 `timelens-server` 提供：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `https://timelens.cc/api/lingtest/leads` | 提交专业版或服务申请 |
| GET | `https://timelens.cc/api/lingtest/licenses/status` | 按登录手机号或浏览器查询权益 |
| POST | `https://timelens.cc/api/lingtest/licenses/activate` | 使用一次性激活码开通专业版 |
| GET | `https://timelens.cc/api/lingtest/usage/status` | 查询账户或游客的日/月额度与用量 |
| POST | `https://timelens.cc/api/lingtest/usage/consume` | 原子校验并扣减一次生成或执行额度 |
| GET | `https://timelens.cc/api/user/info` | 获取当前统一账户信息 |
| GET/POST | `https://timelens.cc/api/trips/:id/comments` | 查看或发布公开路线评论；传 `parentCommentId` 回复评论 |
| DELETE | `https://timelens.cc/api/trips/:id/comments/:commentId` | 删除自己的评论；路线作者也可管理 |
| GET | `https://timelens.cc/api/notifications` | 获取点赞、收藏、评论与回复站内消息 |
| GET | `https://timelens.cc/api/notifications/unread-count` | 获取未读消息数量 |
| PUT | `https://timelens.cc/api/notifications/read-all` | 全部标记为已读 |

设置 `LAITEST_TOKEN` 后，API 请求需要携带：

```http
Authorization: Bearer <LAITEST_TOKEN>
```

### 生成测试用例

铭测用 6 步流水线替代一次性简单生成：需求与 Spec 验证 → 风险计划 → 端拆分 → 覆盖维度 → 详细用例 → Case Home JSON 交付。`sketch` 适合轻量需求，`standard` 适合原始需求与 SDD 联合驱动；旧客户端不传模式时默认使用 `sketch`。

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

响应在兼容原 `suggestions` 数组的同时新增 `pipeline`，包含需求问题清单、风险分布、端归属、7 种测试设计方法、需求追溯矩阵以及可直接下载的 Case Home JSON。支持 DeepSeek、Qianwen 和 Gemini；远程模型不可用时会回退到本地启发式生成，且不会将系统流水线说明混入业务用例。

### 生成旅行计划

```bash
curl -X POST "http://127.0.0.1:8080/api/ai/travel_plan" \
  -H "Content-Type: application/json" \
  -d '{
    "user_input": "带父母去日本关西玩 5 天，预算 2 万元，节奏轻松"
  }'
```

Node.js 示例见 `examples/shiguang_touka_travel_plan_client.js`。

## 环境变量

### 基础与 AI

| 变量 | 用途 |
| --- | --- |
| `LAITEST_TOKEN` | 可选的 API Bearer Token |
| `LAITEST_DATA_DIR` | SQLite 数据目录 |
| `LINGTEST_QUOTA_API_URL` | 铭测统一用量扣减接口，默认 `https://timelens.cc/api/lingtest/usage/consume` |
| `LAITEST_DEFAULT_LANG` | 默认生成语言，默认 `zh-CN` |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `DEEPSEEK_MODEL` | 默认 `deepseek-v4-flash`；旧值 `deepseek-chat` 会自动迁移 |
| `DEEPSEEK_MAX_TOKENS` | 用例生成输出预算，默认 `4096`；系统会按每条约 400 tokens 自动托底，详细用例较多时可上调至 `8192` |
| `DEEPSEEK_PARSE_RETRIES` | 非法 JSON 的重新生成次数，默认 `2` |
| `DEEPSEEK_FORCE_JSON_OBJECT` | 默认 `1`，要求模型使用 JSON Object 模式；兼容代理不支持时可设为 `0` |
| `QIANWEN_API_KEY` | 通义千问 API Key |
| `QIANWEN_MODEL` | 默认 `qwen-plus` |
| `GEMINI_API_KEY` | Gemini API Key |
| `GEMINI_MODEL` | 默认 `gemini-2.0-flash` |
| `AI_DEFAULT_CASES` | 默认生成用例数量，默认 10 |
| `AI_SYSTEM_PROMPT` | 自定义测试用例 System Prompt |
| `AI_CASE_PROMPT_TEMPLATE` | 自定义用例提示词模板 |
| `AI_TRAVEL_SYSTEM_PROMPT` | 自定义旅行规划 System Prompt |
| `AI_TRAVEL_PROMPT_TEMPLATE` | 自定义旅行规划提示词模板 |

模型超时、重试、Token 上限等高级参数见 `laitest/ai.py`。

### Playwright

| 变量 | 用途 |
| --- | --- |
| `PLAYWRIGHT_WS_ENDPOINT` | 可选远程浏览器 WebSocket；留空时线上使用 Serverless Chromium |
| `PLAYWRIGHT_CJK_FONT_URL` | 可选的中日韩 Web Font 地址；加载失败不阻断测试 |

## 内容与运营维护

| 内容 | 文件 |
| --- | --- |
| 首页文案与产品指标 | `index.html` |
| 首页布局与字号 | `css/marketing.css`、`css/system-density.css`、`css/home-v5.css` |
| 铭测产品介绍与案例 | `lingtest.html` |
| 铭测账户与版本状态 | `lingtest-account.js`、`css/lingtest-account.css` |
| 铭测定价与申请联动 | `lingtest-pricing.html`、`lingtest-pricing.js` |
| 铭测申请审核 | `lingtest-admin.html`、`lingtest-admin.js` |
| 测试方法文章 | `lingtest-guides.html` |
| 跨产品导航 | `product-nav.js`、`css/product-nav.css` |
| 公众号二维码 | `img/qrcode_laitest.jpg` |
| 时光智行小程序码 | `img/timelens-miniapp.jpg` |
| SEO 页面清单 | `sitemap.xml` |
| Vercel 路由 | `vercel.json` |

新增公开页面时，应同步更新 `vercel.json`、`sitemap.xml`、canonical URL 和 Open Graph 信息。修改静态 CSS/JS 后应升级引用中的版本参数，避免 CDN 或浏览器继续命中旧资源。

## 发布检查

生产环境冒烟检查：

```bash
npm run smoke:prod
```

检查其他环境：

```bash
SMOKE_BASE_URL=https://preview.example.com npm run smoke:prod
```

脚本会验证核心页面、返回个人主页入口、导航静态资源、公开路线和健康接口。任一关键内容缺失或接口异常都会以非零状态退出。

基础静态检查：

```bash
node --check product-nav.js
node --check app.js
node --check timelens.js
node --check timelens-route.js
python3 -m json.tool vercel.json >/dev/null
git diff --check
```

重点人工回归：

1. 首页能进入两个产品。
2. 铭测产品页和工作台能返回个人主页。
3. 铭测可生成用例、执行用例并查看失败日志和截图。
4. 登录后，铭测右上角能显示账户和正确版本，专业版权益按手机号识别。
5. 专业版用户访问定价页时不会再次看到申请入口。
6. 时光智行可登录、同步计划、查看城市足迹和清单。
7. 公开路线详情可加载、翻页和分享。
8. 手机端导航可展开，弹窗可以关闭。

## 部署

推送 `main` 后由 Vercel 自动部署：

```bash
git push origin main
```

生产密钥统一配置在 Vercel Project → Settings → Environment Variables，不要写入仓库。

## 安全

- 不提交 API Key、Access Token、密码、激活码或 `.laitest/` 数据库。
- 页面执行接口仅用于授权目标。
- 生产密钥定期轮换。
- 公开政策见 `privacy.html`、`terms.html` 和 `security.html`。

## 下一步

- 补充账户登录、专业版识别和定价状态的自动化回归
- 用真实访问、申请和激活数据替换静态产品指标
- 完善铭测云端项目、运行历史和失败聚类
- 优化路线分享卡片与服务端动态 Open Graph
- 建立内容更新节奏和产品更新日志
