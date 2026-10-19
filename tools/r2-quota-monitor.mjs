// R2-02: đọc dung lượng bucket catalogue-images (READ-ONLY — không xoá, không ghi).
// Chạy: node tools/r2-quota-monitor.mjs [--quota-gb 10]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { R2_ORPHAN_BUCKET } from './r2-orphan-selection.mjs';
import { formatUsageReport, summarizeBucketUsage } from './r2-usage.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = R2_ORPHAN_BUCKET;

function loadEnv(path) {
  const out = {};
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return out;
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function fail(msg) {
  console.error(`r2-quota-monitor: ${msg}`);
  process.exit(1);
}

const env = loadEnv(join(ROOT, '.env'));
const CF_TOKEN = env.CLOUDFLARE_API_TOKEN || '';
const CF_ACCOUNT = env.CLOUDFLARE_ACCOUNT_ID || '';
const quotaArg = process.argv.indexOf('--quota-gb');
const quotaBytes = quotaArg >= 0 ? Math.max(0.01, Number(process.argv[quotaArg + 1] || 10)) * 1024 ** 3 : undefined;

if (!CF_TOKEN) fail('thiếu CLOUDFLARE_API_TOKEN trong .env');

async function resolveAccountId() {
  if (CF_ACCOUNT) return CF_ACCOUNT;
  const res = await fetch('https://api.cloudflare.com/client/v4/accounts', {
    headers: { Authorization: `Bearer ${CF_TOKEN}` }
  });
  if (!res.ok) fail(`không đọc được accounts (HTTP ${res.status})`);
  const data = await res.json().catch(() => null);
  const first = data?.result?.[0]?.id;
  if (!first) fail('token không truy cập được account nào');
  return first;
}

async function listAllObjects(accountId) {
  const objects = [];
  let cursor = '';
  for (let page = 0; page < 500; page++) {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${BUCKET}/objects`);
    url.searchParams.set('per_page', '1000');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${CF_TOKEN}` } });
    if (!res.ok) fail(`list objects HTTP ${res.status}`);
    const data = await res.json().catch(() => null);
    if (!data?.success) fail(`list objects lỗi: ${JSON.stringify(data?.errors || [])}`);
    for (const row of Array.isArray(data.result) ? data.result : []) {
      objects.push({ key: String(row?.key || ''), size: Number(row?.size || 0) });
    }
    if (!data?.result_info?.is_truncated) break;
    cursor = data.result_info.cursor;
    if (!cursor) break;
  }
  return objects;
}

async function main() {
  const accountId = await resolveAccountId();
  const objects = await listAllObjects(accountId);
  const summary = summarizeBucketUsage(objects, quotaBytes ? { quotaBytes } : {});
  console.log(`[quota] bucket=${BUCKET} (read-only)`);
  for (const line of formatUsageReport(summary)) console.log(line);
}

main().catch((err) => fail(err?.message || String(err)));
