function baseUrl(env) {
  return String(env.SUPABASE_URL || "").replace(/\/+$/,"");
}

function anonKey(env) {
  return String(env.SUPABASE_ANON_KEY || "");
}

export async function rpc(env, fn, args) {
  const url = baseUrl(env);
  const anon = anonKey(env);

  if (!url || !anon) {
    const e = new Error("Thiếu SUPABASE_URL hoặc SUPABASE_ANON_KEY.");
    e.status = 503;
    throw e;
  }

  // Supabase xác định người dùng qua header Authorization (auth.jwt()).
  // Trước đây luôn gửi Bearer <anon> -> các hàm SECURITY DEFINER không thấy
  // user -> app_me trả ok:false -> 401 cho cả khi đăng nhập hợp lệ.
  // Nếu args có p_session_token thì gửi chính nó (JWT) làm bearer.
  const userToken =
    args && typeof args.p_session_token === "string" ? args.p_session_token : "";

  const res = await fetch(`${url}/rest/v1/rpc/${encodeURIComponent(fn)}`, {
    method:"POST",
    headers:{
      "content-type":"application/json",
      "apikey":anon,
      "authorization":`Bearer ${userToken || anon}`
    },
    body:JSON.stringify(args || {})
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const e = new Error(data?.message || `Supabase RPC ${fn} HTTP ${res.status}`);
    e.status = res.status;
    e.details = data;
    throw e;
  }

  return data;
}

export async function validateSession(env, token) {
  if (!token) {
    const e = new Error("Thiếu session token.");
    e.status = 401;
    throw e;
  }

  // Token không phải JWT (thiếu 2 dấu chấm) -> chặn TRƯỚC khi gửi xuống
  // PostgREST: Bearer rác sẽ làm Supabase trả lỗi 400 và thành 500/1101.
  if (String(token).split(".").length !== 3) {
    const e = new Error("Session không hợp lệ hoặc đã hết hạn.");
    e.status = 401;
    throw e;
  }

  const data = await rpc(env, "app_me", {p_session_token:token});
  const row = Array.isArray(data) ? data[0] : data;

  if (!row?.ok) {
    const e = new Error(row?.message || "Session không hợp lệ hoặc đã hết hạn.");
    e.status = 401;
    throw e;
  }

  return row;
}

export async function searchCatalogue(env, token, {
  search="",
  usageSide="all",
  viewMode="all",
  limit=50,
  offset=0
}={}) {
  const data = await rpc(env, "app_search_catalogue", {
    p_session_token:token,
    p_search:String(search || ""),
    p_usage_side:usageSide || "all",
    p_view_mode:viewMode || "all",
    p_limit:limit,
    p_offset:offset
  });

  return Array.isArray(data) ? data : [];
}

export async function scanCatalogue(env, token, {maxRows=1500,usageSide="all",viewMode="all"}={}) {
  const rows = new Map();
  const budget=Math.max(1,Math.min(10000,Math.floor(maxRows)||1500));
  const pageSize = 300;
  for (let offset=0; offset<budget; offset+=pageSize) {
    const limit=Math.min(pageSize,budget-offset);
    const page = await searchCatalogue(env, token, {
      search:"", usageSide, viewMode, limit, offset
    });
    let added=0;
    for(const row of page) if(row?.id!=null && !rows.has(String(row.id))) {
      rows.set(String(row.id),row);added++;
    }
    if (page.length < limit) return [...rows.values()];
    if (!added) throw new Error("Catalogue pagination made no progress.");
  }
  // A full last page does not prove completeness. One bounded read distinguishes it.
  const more=await searchCatalogue(env,token,{search:"",usageSide,viewMode,limit:1,offset:budget});
  if(more.length) throw new Error("Catalogue scan budget exceeded; results would be incomplete.");
  return [...rows.values()];
}
