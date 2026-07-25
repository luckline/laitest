# OpenClaw → Luckline 内容同步

把本目录的两个 `sync_to_laitest.*` 文件复制到：

```text
/root/.openclaw/workspace/
```

在云服务器环境变量中配置，不要写入公众号配置文件：

```bash
export LAITEST_SYNC_URL="https://timelens.cc/api/content/sync"
export LAITEST_SYNC_TOKEN="与 timelens-server 一致的独立随机密钥"
```

## Node 发布脚本接入

在 `publish_wechat.js` 或 `publish.js` 顶部引入：

```js
const { syncWithoutBlockingPublish } = require('./sync_to_laitest');
```

平台发布成功后调用。微信公众号“小梁游记”：

```js
await syncWithoutBlockingPublish({
  externalId: mediaId,
  accountKey: 'xiaoliang',
  platform: 'wechat',
  contentType: 'travel-note',
  title: article.title,
  summary: article.summary || article.digest,
  content: article.content,
  coverImage: article.coverImage || article.thumb_url,
  keywords: article.keywords || article.tags || [],
  status: 'published'
});
```

微信公众号“铭锦数智”把 `accountKey` 改为 `mingjin`，`contentType` 改为 `tech-note`。

头条号“小梁游记”：

```js
await syncWithoutBlockingPublish({
  externalId: publishResult.id,
  accountKey: 'xiaoliang',
  platform: 'toutiao',
  contentType: 'micro-post',
  title: content.title,
  summary: content.summary,
  content: content.text || content.content,
  platformUrl: publishResult.url,
  status: 'published'
});
```

`syncWithoutBlockingPublish` 会捕获同步异常，个人站不可用时不会影响微信或头条发布。

## Bash 调度接入

如果生成器已经输出 JSON，可以在发布成功后调用：

```bash
python3 /root/.openclaw/workspace/sync_to_laitest.py \
  --file "$ARTICLE_JSON" \
  --account xiaoliang \
  --platform wechat \
  --external-id "$MEDIA_ID" \
  --status published
```

`generate_xiaoliang_article.py` 一次生成三篇时，JSON 可以是数组，或包含 `articles`、`items`、`posts` 字段；同步器会逐篇写入。

## 上线顺序

1. 执行 `sql/036_content_posts.sql`。
2. 在 `timelens-server` 设置 `LAITEST_SYNC_TOKEN` 并重启。
3. 将同步文件复制到 OpenClaw workspace。
4. 在 OpenClaw 云服务器设置相同 Token。
5. 先用一篇测试内容验证，再接入正式调度。
