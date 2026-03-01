# laitest (MVP)

一个“TestHub 风格”的测试平台最小可运行版本：

- 无需安装任何依赖（Python 标准库）
- SQLite 持久化（`./.laitest/laitest.db`）
- Web UI（静态页面）+ JSON API
- 内置一个可插拔的“AI 生成用例”接口（默认用本地启发式；可选对接外部模型）

## 运行

Web 模式（本机正常终端里运行即可）：

```bash
cd /Users/user/Documents/laitest
python3 -m laitest
```

然后打开：

- 官网落地页：`http://127.0.0.1:8080/`
- 控制台：`http://127.0.0.1:8080/app`

CLI 模式（不需要监听端口，适合受限环境）：

```bash
python3 -m laitest cli health
python3 -m laitest cli project-create demo
python3 -m laitest cli projects
```

## API 概览

- `GET /api/health`
- `GET/POST /api/projects`
- `GET/POST /api/suites`
- `GET/POST /api/cases`
- `POST /api/runs` 创建执行
- `GET /api/runs` 查看执行
- `POST /api/ai/generate_cases` 生成建议用例（本地启发式 or 外部模型）

## AI 用例生成（DeepSeek / Qianwen / Gemini）

默认使用本地启发式生成；若配置了远程模型 key，则按以下顺序调用并在失败时自动回退：

1. `DeepSeek`
2. `Qianwen`
3. `Gemini`
4. `local`（本地启发式）

`POST /api/ai/generate_cases` 支持可选请求字段：

- `model_provider`：`deepseek` / `qianwen` / `gemini`
  - 传入后将仅调用该模型生成（失败时仅回退 `local`）
  - 不传时按上述顺序自动回退

可选环境变量：

- `DEEPSEEK_API_KEY`：DeepSeek API Key（优先使用；兼容 `DeepSeek_API_KEY`）
- `DEEPSEEK_MODEL`：模型名（默认 `deepseek-chat`）
- `DEEPSEEK_BASE_URL`：DeepSeek 基础地址（默认 `https://api.deepseek.com`）
- `DEEPSEEK_TIMEOUT_S`：DeepSeek 请求超时秒数（默认 `60`）
- `DEEPSEEK_RETRIES`：DeepSeek 超时/5xx 重试次数（默认 `2`，总尝试次数=重试+1）
- `DEEPSEEK_TIMEOUT_CAP_S`：有效超时上限（默认不启用；仅在你显式配置时生效）
- `DEEPSEEK_RETRIES_CAP`：有效重试上限（默认不启用；仅在你显式配置时生效）
- `DEEPSEEK_PARSE_RETRIES`：DeepSeek 内容解析失败重试次数（默认 `2`）
- `DEEPSEEK_TOTAL_DEADLINE_S`：DeepSeek 单次生成总时长上限（默认自动按 `timeout*(retries+1)+10s` 推导，超时即回退）
- `DEEPSEEK_FORCE_JSON_OBJECT`：是否启用 `response_format=json_object`（默认 `0`，建议关闭以提高兼容性）
- `DEEPSEEK_MAX_TOKENS`：DeepSeek 最大输出 token（默认 `1400`，越小通常越快）
- `DEEPSEEK_MAX_CASES`：单次最多生成用例条数（默认 `10`，越小通常越快）
- `DEEPSEEK_PROMPT_MAX_CHARS`：发送给 DeepSeek 的需求文本最大字符数（默认 `4500`）
- `QIANWEN_API_KEY`：Qianwen API Key（Vercel 环境变量）
- `QIANWEN_MODEL`：模型名（默认 `qwen-plus`）
- `QIANWEN_BASE_URL`：基础地址；可用逗号配置多个端点（默认按 `https://dashscope-intl.aliyuncs.com/compatible-mode/v1, https://dashscope.aliyuncs.com/compatible-mode/v1` 顺序尝试）
- `QIANWEN_TIMEOUT_S`：请求超时秒数（默认 `30`）
- `QIANWEN_RETRIES`：超时/5xx 重试次数（默认 `1`）
- `QIANWEN_MAX_TOKENS`：最大输出 token（默认 `1400`）
- `QIANWEN_MAX_CASES`：单次最多生成用例条数（默认 `10`）
- `QIANWEN_PROMPT_MAX_CHARS`：发送给 Qianwen 的需求文本最大字符数（默认 `4500`）
- `GEMINI_API_KEY`：Gemini API Key（作为 DeepSeek 失败时回退）
- `GEMINI_MODEL`：Gemini 模型名（默认 `gemini-2.0-flash`）
- `GEMINI_TIMEOUT_S`：Gemini 请求超时秒数（默认 `25`）

接口返回会包含：

- `provider`：`deepseek` / `qianwen` / `gemini` / `qianwen-fallback` / `gemini-fallback` / `local` / `local-fallback`
- `requested_provider`：请求中指定的 `model_provider`（未指定时为 `null`）
- `warning`：当远程生成失败并回退时返回错误摘要

## 设计目标（后续可扩展）

- 用例管理：标签、版本、评审流
- 执行：并发、重试、隔离、分布式 worker
- 报告：趋势、失败聚类、Flaky 检测
- 集成：GitHub/GitLab、CI、通知、缺陷单
- 智能：从 PR/需求/OpenAPI 自动生成用例，失败归因与修复建议
