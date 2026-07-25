const crypto = require('crypto');

const endpoint = process.env.LAITEST_SYNC_URL || 'https://timelens.cc/api/content/sync';

function externalIdFor(payload) {
  return crypto
    .createHash('sha256')
    .update(`${payload.accountKey}:${payload.platform}:${payload.title}:${payload.content}`)
    .digest('hex')
    .slice(0, 24);
}

async function syncToLaitest(payload) {
  const token = process.env.LAITEST_SYNC_TOKEN;
  if (!token) throw new Error('缺少 LAITEST_SYNC_TOKEN');
  const body = {
    status: 'published',
    contentType: payload.platform === 'toutiao' ? 'micro-post' : 'article',
    ...payload,
    externalId: payload.externalId || externalIdFor(payload),
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || Number(result.code || 0) !== 0) {
    throw new Error(result.message || `同步失败 (${response.status})`);
  }
  return result.data;
}

async function syncWithoutBlockingPublish(payload, logger = console) {
  try {
    const result = await syncToLaitest(payload);
    logger.log(`[laitest] 已同步：${result.slug}`);
    return result;
  } catch (error) {
    logger.error(`[laitest] 同步失败，不影响平台发布：${error.message}`);
    return null;
  }
}

module.exports = { syncToLaitest, syncWithoutBlockingPublish };
