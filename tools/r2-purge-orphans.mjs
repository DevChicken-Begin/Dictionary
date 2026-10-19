import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  R2_ORPHAN_BUCKET,
  R2_ORPHAN_KEEP_PREFIXES,
  R2_ORPHAN_LIMITS,
  buildKeyTypeSummary,
  selectR2OrphanTargets
} from './r2-orphan-selection.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = R2_ORPHAN_BUCKET;
const KEEP_PREFIXES = R2_ORPHAN_KEEP_PREFIXES;
const MAX_TARGETS = R2_ORPHAN_LIMITS.maxTargets;
const MAX_BYTES = R2_ORPHAN_LIMITS.maxBytes;

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
  console.error(`r2-purge-orphans: ${msg}`);
  process.exit(1);
}

if (!CF_TOKEN) fail('thiếu CLOUDFLARE_API_TOKEN trong .env');
if (!SUPABASE_URL || !SUPABASE_KEY) fail('thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong .env');

const execute = process.argv.includes('--execute');
const force = process.argv.includes('--force');
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg >= 0 ? Math.max(1, Number(process.argv[limitArg + 1] || 1)) : Infinity;
const logPathArg = process.argv.indexOf('--log');
const logPath = logPathArg >= 0 ? process.argv[logPathArg + 1] : '/tmp/opencode/r2-purge-log.json';

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

async function fetchReferenced() {
  const [assets, library] = await Promise.all([
    fetchAllPaths('image_assets'),
    fetchAllPaths('image_library')
  ]);
  return new Set([...assets, ...library]);
}

async function deleteObject(accountId, key) {
  const encoded = encodeURIComponent(key);
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${BUCKET}/objects/${encoded}`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${CF_TOKEN}` } });
  const data = await res.json().catch(() => null);
  if (res.ok && data?.success !== false) return { ok: true, http: res.status };
  if (res.status === 404) return { ok: true, http: res.status, gone: true };
  return { ok: false, http: res.status, errors: data?.errors || [] };
}

async function main() {
  const accountId = await resolveAccountId();
  const objects = await listAllObjects(accountId);
  const referenced = await fetchReferenced();

  const { orphans, kept, targets } = selectR2OrphanTargets(objects, referenced, KEEP_PREFIXES);
  const targetBytes = targets.reduce((sum, o) => sum + o.size, 0);

  console.log(`[purge] bucket=${BUCKET} objects=${objects.length} referenced=${referenced.size}`);
  console.log(`[purge] orphans=${orphans.length} kept(legacy)=${kept.length} (${JSON.stringify(buildKeyTypeSummary(kept.map(o => o.key)))})`);
  console.log(`[purge] targets=${targets.length} bytes=${targetBytes} (${(targetBytes / (1024 * 1024)).toFixed(2)}MB) by_type=${JSON.stringify(buildKeyTypeSummary(targets.map(o => o.key)))}`);

  if (!execute) {
    console.log('[purge] DRY-RUN — chưa xoá gì. Thêm --execute để xoá thật.');
    console.log('[purge] 10 key mẫu:', JSON.stringify(targets.slice(0, 10).map(o => o.key), null, 1));
    return;
  }

  if (!force) {
    if (targets.length > MAX_TARGETS) fail(`safety: targets ${targets.length} > ${MAX_TARGETS} (dùng --force nếu đúng ý)`);
    if (targetBytes > MAX_BYTES) fail(`safety: bytes ${targetBytes} > ${MAX_BYTES} (dùng --force nếu đúng ý)`);
  }

  const freshReferenced = await fetchReferenced();
  const log = { bucket: BUCKET, started_at: new Date().toISOString(), account: accountId, deleted: [], skipped: [], failed: [] };
  let processed = 0;

  for (const target of targets) {
    if (processed >= limit) break;
    if (freshReferenced.has(target.key)) {
      log.skipped.push({ key: target.key, reason: 'referenced_at_execute' });
      continue;
    }
    if (KEEP_PREFIXES.some(p => target.key.startsWith(p))) {
      log.skipped.push({ key: target.key, reason: 'keep_prefix' });
      continue;
    }
    const result = await deleteObject(accountId, target.key);
    if (result.ok) {
      log.deleted.push({ key: target.key, size: target.size, http: result.http, gone: Boolean(result.gone) });
    } else {
      log.failed.push({ key: target.key, http: result.http, errors: result.errors });
    }
    processed++;
    if (processed % 50 === 0) console.log(`[purge] processed=${processed}/${Math.min(targets.length, limit)}`);
  }

  log.finished_at = new Date().toISOString();
  log.summary = {
    attempted: processed,
    deleted: log.deleted.length,
    skipped: log.skipped.length,
    failed: log.failed.length,
    deleted_bytes: log.deleted.reduce((a, r) => a + (r.size || 0), 0)
  };
  writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`[purge] done: ${JSON.stringify(log.summary)}`);
  console.log(`[purge] log: ${logPath}`);
  if (log.failed.length) {
    console.log('[purge] failures:', JSON.stringify(log.failed.slice(0, 5)));
    process.exitCode = 1;
  }
}

main().catch(err => fail(err?.message || String(err)));
