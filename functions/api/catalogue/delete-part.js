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

    return json({
      ok: true,
      image_id: imageId,
      deleted_vectors_count: deletedVectorsCount,
      message: `Đã xóa thành công mã linh kiện và ${deletedVectorsCount} vector AI liên quan.`
    });
  } catch (error) {
    return errorResponse(error);
  }
}
