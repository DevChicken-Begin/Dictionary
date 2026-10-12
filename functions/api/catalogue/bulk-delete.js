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
    const e = new Error("Chỉ admin mới có quyền xóa hàng loạt mã linh kiện.");
    e.status = 403;
    throw e;
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request, { maxBytes: 500_000 });
    const authHeader = request.headers.get("authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const token = String(body?.session_token || request.headers.get("x-session-token") || bearer || "").trim();

    const me = await validateSession(env, token);
    requireAdmin(me);

    const rawIds = Array.isArray(body?.image_ids) ? body.image_ids : [];
    const imageIds = rawIds
      .map(id => String(id || "").trim())
      .filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));

    if (!imageIds.length) {
      return json({
        ok: true,
        deleted_count: 0,
        message: "Không có mã hợp lệ nào được chọn để xóa."
      });
    }

    const out = await rpc(env, "app_bulk_delete_parts", {
      p_session_token: token,
      p_image_ids: imageIds
    });

    // Xóa triệt để toàn bộ vector liên quan trong bảng catalogue_image_vectors ở Trung tâm Vector AI
    let deletedVectorsCount = 0;
    try {
      const key = serverKey(env);
      const base = baseUrl(env);
      if (key && base && imageIds.length > 0) {
        // Cắt mảng thành các chunk tối đa 50 ID để xóa qua PostgREST in filter
        for (let i = 0; i < imageIds.length; i += 50) {
          const chunk = imageIds.slice(i, i + 50);
          const inParam = `(${chunk.map(id => `"${id}"`).join(",")})`;
          const delVecRes = await fetch(`${base}/rest/v1/catalogue_image_vectors?record_id=in.${encodeURIComponent(inParam)}`, {
            method: "DELETE",
            headers: {
              ...headersForKey(key),
              "Prefer": "return=representation"
            }
          });
          if (delVecRes.ok) {
            const delRows = await delVecRes.json().catch(() => []);
            deletedVectorsCount += Array.isArray(delRows) ? delRows.length : 0;
          }
        }
      }
    } catch (vecErr) {
      console.warn("Lỗi dọn vector khi bulk-delete:", vecErr);
    }

    // Xóa file ảnh trên Cloudflare R2 bucket nếu có binding
    const r2Keys = Array.isArray(out?.r2_keys) ? out.r2_keys : [];
    if (env.CATALOGUE_BUCKET && r2Keys.length > 0) {
      const validKeys = r2Keys.map(k => String(k || "").trim()).filter(Boolean);
      for (let i = 0; i < validKeys.length; i += 500) {
        const chunk = validKeys.slice(i, i + 500);
        try {
          await env.CATALOGUE_BUCKET.delete(chunk);
        } catch (r2Err) {
          console.warn("R2 bulk delete keys error:", r2Err);
        }
      }
    }

    return json({
      ok: true,
      deleted_count: out?.deleted_count || imageIds.length,
      deleted_vectors_count: deletedVectorsCount,
      r2_deleted_keys_count: r2Keys.length,
      message: `Đã xóa thành công ${out?.deleted_count || imageIds.length} mã linh kiện, làm sạch file ảnh R2 và xóa sạch vector AI liên quan.`
    });
  } catch (error) {
    return errorResponse(error);
  }
}
