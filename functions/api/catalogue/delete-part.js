import {
  rpc,
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

function requireAdmin(me) {
  if (String(me?.role_name || "").toLowerCase() !== "admin") {
    const e = new Error("Chỉ admin mới có quyền xóa mã linh kiện.");
    e.status = 403;
    throw e;
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request, { maxBytes: 50_000 });
    const authHeader = request.headers.get("authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const token = String(body?.session_token || request.headers.get("x-session-token") || bearer || "").trim();

    const me = await validateSession(env, token);
    requireAdmin(me);

    const imageId = String(body?.image_id || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageId)) {
      const e = new Error("image_id không hợp lệ (yêu cầu UUID).");
      e.status = 400;
      throw e;
    }

    // 0. Thu thập object key R2 của mã TRƯỚC khi xóa (đối xứng app_bulk_delete_parts)
    // vì app_delete_part không trả r2_keys; sau khi xóa thì không truy vấn lại được.
    let r2Keys = [];
    try {
      const key = serverKey(env);
      const base = baseUrl(env);
      if (key && base) {
        const enc = encodeURIComponent(imageId);
        const [assetsRes, libRes] = await Promise.all([
          fetch(`${base}/rest/v1/image_assets?image_id=eq.${enc}&select=image_path`, { headers: headersForKey(key) }),
          fetch(`${base}/rest/v1/image_library?id=eq.${enc}&select=image_path`, { headers: headersForKey(key) })
        ]);
        const collectPaths = async (res) => {
          if (!res.ok) return [];
          const rows = await res.json().catch(() => []);
          if (!Array.isArray(rows)) return [];
          return rows.map(r => String(r?.image_path || "").trim()).filter(Boolean);
        };
        const [assetPaths, libPaths] = await Promise.all([collectPaths(assetsRes), collectPaths(libRes)]);
        r2Keys = [...new Set([...assetPaths, ...libPaths])];
      }
    } catch (keyErr) {
      console.warn("Không thu thập được R2 keys trước khi xóa mã:", keyErr);
    }

    // 1. Gọi RPC app_delete_part để xóa bản ghi trong image_library và image_assets
    const delResult = await rpc(env, "app_delete_part", {
      p_session_token: token,
      p_image_id: imageId
    });

    if (delResult && delResult.ok === false) {
      const e = new Error(delResult.message || "Không thể xóa mã linh kiện.");
      e.status = 400;
      throw e;
    }

    // 2. Xóa triệt để dữ liệu vector liên quan trong bảng catalogue_image_vectors ở Trung tâm Vector AI
    let deletedVectorsCount = 0;
    try {
      const key = serverKey(env);
      const base = baseUrl(env);
      if (key && base) {
        const delVecRes = await fetch(`${base}/rest/v1/catalogue_image_vectors?record_id=eq.${encodeURIComponent(imageId)}`, {
          method: "DELETE",
          headers: {
            ...headersForKey(key),
            "Prefer": "return=representation"
          }
        });
        if (delVecRes.ok) {
          const delVecs = await delVecRes.json().catch(() => []);
          deletedVectorsCount = Array.isArray(delVecs) ? delVecs.length : 0;
        }
      }
    } catch (vecErr) {
      console.warn("Lỗi dọn vector khi delete-part:", vecErr);
    }

    // 3. Xóa object ảnh trên Cloudflare R2 (đối xứng bulk-delete) — chỉ chạy
    // sau khi DB đã xóa thành công, tránh xóa ảnh của mã còn tồn tại.
    let r2DeletedKeysCount = 0;
    if (env.CATALOGUE_BUCKET && r2Keys.length > 0) {
      try {
        for (let i = 0; i < r2Keys.length; i += 500) {
          const chunk = r2Keys.slice(i, i + 500);
          await env.CATALOGUE_BUCKET.delete(chunk);
          r2DeletedKeysCount += chunk.length;
        }
      } catch (r2Err) {
        console.warn("R2 delete keys error khi delete-part:", r2Err);
      }
    }

    return json({
      ok: true,
      image_id: imageId,
      deleted_vectors_count: deletedVectorsCount,
      r2_deleted_keys_count: r2DeletedKeysCount,
      message: `Đã xóa thành công mã linh kiện và ${deletedVectorsCount} vector AI liên quan.`
    });
  } catch (error) {
    return errorResponse(error);
  }
}
