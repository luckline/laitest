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

## AI 用例生成（DeepSeek / Gemini）

默认使用本地启发式生成；若配置了远程模型 key，则按以下顺序调用并在失败时自动回退：

1. `DeepSeek`
2. `Gemini`
3. `local`（本地启发式）

可选环境变量：

- `DEEPSEEK_API_KEY`：DeepSeek API Key（优先使用）
- `DEEPSEEK_MODEL`：模型名（默认 `deepseek-chat`）
- `DEEPSEEK_BASE_URL`：DeepSeek 基础地址（默认 `https://api.deepseek.com`）
- `DEEPSEEK_TIMEOUT_S`：DeepSeek 请求超时秒数（默认 `25`）
- `GEMINI_API_KEY`：Gemini API Key（作为 DeepSeek 失败时回退）
- `GEMINI_MODEL`：Gemini 模型名（默认 `gemini-2.0-flash`）
- `GEMINI_TIMEOUT_S`：Gemini 请求超时秒数（默认 `25`）

接口返回会包含：

- `provider`：`deepseek` / `gemini` / `gemini-fallback` / `local` / `local-fallback`
- `warning`：当远程生成失败并回退时返回错误摘要

## 设计目标（后续可扩展）

- 用例管理：标签、版本、评审流
- 执行：并发、重试、隔离、分布式 worker
- 报告：趋势、失败聚类、Flaky 检测
- 集成：GitHub/GitLab、CI、通知、缺陷单
- 智能：从 PR/需求/OpenAPI 自动生成用例，失败归因与修复建议
