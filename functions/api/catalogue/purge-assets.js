import {
  validateSession
} from "../../_lib/moris/v5/connectors/supabase.js";

import {
  baseUrl,
  serverKey,
  headersForKey
} from "../../_lib/moris/v5/connectors/supabaseService.js";

import {
  json,
  readJson,
  errorResponse
} from "../../_lib/shared/http.js";

// M30 (B14): dọn object R2 cũ khi thay ảnh trong editor.
// Chỉ nhận key đúng định dạng asset catalogue, verify service role là key
// KHÔNG còn được tham chiếu trong DB trước khi xoá (fail-closed nếu không
// xác minh được) để không bao giờ xoá ảnh đang dùng.
const MAX_KEYS = 50;
const KEY_PATTERN = /^(thumb|front|back|detail|compare)\/[A-Za-z0-9_-]{1,120}\/[A-Za-z0-9_-]{1,100}\.(webp|png|jpg)$/;

function requireAdmin(me) {
  if (String(me?.role_name || "").toLowerCase() !== "admin") {
    const e = new Error("Chỉ admin mới có quyền dọn ảnh R2 đã thay thế.");
    e.status = 403;
    throw e;
  }
}

async function fetchReferencedKeys(base, key, paths) {
  const inParam = `(${paths.map(p => `"${p}"`).join(",")})`;
  const found = new Set();
  for (const table of ["image_assets", "image_library"]) {
    const res = await fetch(
      `${base}/rest/v1/${table}?select=image_path&image_path=in.${encodeURIComponent(inParam)}`,
      { headers: headersForKey(key) }
    );
    if (!res.ok) throw new Error(`Không đọc được tham chiếu ${table} (HTTP ${res.status}).`);
    const rows = await res.json().catch(() => []);
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const path = String(row?.image_path || "").trim();
        if (path) found.add(path);
      }
    }
  }
  return found;
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request, { maxBytes: 50_000 });
    const authHeader = request.headers.get("authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const token = String(body?.session_token || request.headers.get("x-session-token") || bearer || "").trim();

    const me = await validateSession(env, token);
    requireAdmin(me);

    const rawKeys = Array.isArray(body?.r2_keys) ? body.r2_keys : [];
    const keys = [...new Set(
      rawKeys
        .map(k => String(k || "").trim())
        .filter(k => KEY_PATTERN.test(k))
    )].slice(0, MAX_KEYS);

    if (!keys.length) {
      const e = new Error("Không có r2_keys hợp lệ để dọn (sai định dạng asset catalogue).");
      e.status = 400;
      throw e;
    }

    if (!env.CATALOGUE_BUCKET) {
      const e = new Error("Thiếu R2 binding CATALOGUE_BUCKET.");
      e.status = 503;
      throw e;
    }

    let referenced = new Set();
    let verification = "ok";
    try {
      const key = serverKey(env);
      const base = baseUrl(env);
      const refs = key && base ? await fetchReferencedKeys(base, key, keys) : null;
      if (!refs) {
        verification = "unavailable";
        referenced = new Set(keys);
      } else {
        referenced = refs;
      }
    } catch (verifyErr) {
      console.warn("purge-assets: không xác minh được tham chiếu DB, giữ nguyên toàn bộ key:", verifyErr?.message || verifyErr);
      verification = "unavailable";
      referenced = new Set(keys);
    }

    const deletableKeys = keys.filter(k => !referenced.has(k));
    const skippedKeys = keys.filter(k => referenced.has(k));

    if (deletableKeys.length) {
      await env.CATALOGUE_BUCKET.delete(deletableKeys);
    }

    return json({
      ok: true,
      verification,
      deleted_count: deletableKeys.length,
      deleted_keys: deletableKeys,
      skipped_count: skippedKeys.length,
      skipped_referenced_keys: skippedKeys
    });
  } catch (error) {
    return errorResponse(error);
  }
}
