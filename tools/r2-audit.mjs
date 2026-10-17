import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = 'catalogue-images';

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

const env = loadEnv(join(ROOT, '.env'));

const CF_TOKEN = env.CLOUDFLARE_API_TOKEN || '';
const CF_ACCOUNT = env.CLOUDFLARE_ACCOUNT_ID || '';
const SUPABASE_URL = env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';

function fail(msg) {
  console.error(`r2-audit: ${msg}`);
  process.exit(1);
}

if (!CF_TOKEN) fail('thiếu CLOUDFLARE_API_TOKEN trong .env');
if (!SUPABASE_URL || !SUPABASE_KEY) fail('thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong .env');

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
    const rows = Array.isArray(data.result) ? data.result : [];
    for (const row of rows) {
      objects.push({ key: String(row?.key || ''), size: Number(row?.size || 0) });
    }
    if (!data?.result_info?.is_truncated) break;
    cursor = data.result_info.cursor;
    if (!cursor) break;
  }
  return objects;
}

async function fetchAllPaths(table) {
  const paths = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 1_000_000; offset += pageSize) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=image_path&order=id.asc&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    });
    if (!res.ok) fail(`đọc ${table} HTTP ${res.status}`);
    const rows = await res.json().catch(() => []);
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) {
      const p = String(row?.image_path || '').trim();
      if (p) paths.push(p);
    }
    if (rows.length < pageSize) break;
  }
  return paths;
}

function summarize(keys) {
  const byType = {};
  for (const key of keys) {
    const type = key.split('/')[0] || 'unknown';
    byType[type] = (byType[type] || 0) + 1;
  }
  return byType;
}

async function main() {
  const accountId = await resolveAccountId();
  const objects = await listAllObjects(accountId);
  const totalBytes = objects.reduce((sum, o) => sum + o.size, 0);

  const [assetsPaths, libraryPaths] = await Promise.all([
    fetchAllPaths('image_assets'),
    fetchAllPaths('image_library')
  ]);

  const referenced = new Set([...assetsPaths, ...libraryPaths]);
  const r2Keys = new Set(objects.map(o => o.key));

  const orphans = objects.filter(o => !referenced.has(o.key));
  const missing = [...referenced].filter(p => !r2Keys.has(p));
  const orphanBytes = orphans.reduce((sum, o) => sum + o.size, 0);

  const report = {
    bucket: BUCKET,
    generated_at: new Date().toISOString(),
    r2: {
      object_count: objects.length,
      total_bytes: totalBytes,
      total_mb: Number((totalBytes / (1024 * 1024)).toFixed(2)),
      by_type: summarize(objects.map(o => o.key))
    },
    db: {
      image_assets_paths: assetsPaths.length,
      image_library_paths: libraryPaths.length,
      unique_referenced: referenced.size
    },
    orphan_objects: {
      count: orphans.length,
      bytes: orphanBytes,
      mb: Number((orphanBytes / (1024 * 1024)).toFixed(2)),
      by_type: summarize(orphans.map(o => o.key)),
      sample: orphans.slice(0, 10).map(o => ({ key: o.key, size: o.size }))
    },
    missing_objects: {
      count: missing.length,
      sample: missing.slice(0, 10)
    }
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch(err => fail(err?.message || String(err)));
