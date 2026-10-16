import { normalizeGeometry } from "../schemas/geometry.js";
import { searchCatalogue, scanCatalogue } from "./supabase.js";

function norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

export async function exactLookup(env, token, query) {
  const q = norm(query?.message);
  if (!q) return [];

  const rows = await searchCatalogue(env, token, {
    search:q,
    usageSide:query?.filters?.usage_side || "all",
    viewMode:query?.filters?.view_mode || "all",
    limit:20,
    offset:0
  });

  return rows.filter(row =>
    [row?.code, row?.part_id, row?.id]
      .some(v => norm(v) === q)
  );
}

export async function hydrateVectorHits(env, token, hits, {maxRows=1500,filters={}}={}) {
  // Bridge implementation that preserves existing RPC/schema.
  // Replace with a dedicated safe hydration RPC after physical schema review.
  const all = await scanCatalogue(env, token, {maxRows,usageSide:filters.usage_side||"all",viewMode:filters.view_mode||"all"});
  const byId = new Map(all.map(row => [String(row?.id ?? ""), row]));

  // LỌC BỎ ORPHAN VECTORS: các vector có record_id không còn tồn tại trong
  // catalogue (bản ghi đã bị xóa nhưng vector chưa được dọn).
  // Nếu không lọc, chúng tạo candidate rỗng → UI hiển thị "ID: --- · Chưa xác định".
  return (hits || [])
    .filter(hit => {
      const row=byId.get(String(hit.record_id));
      return row && (!filters.usage_side || filters.usage_side==='all' || row.usage_side===filters.usage_side) &&
        (!filters.view_mode || filters.view_mode==='all' || row.view_mode===filters.view_mode);
    })
    .map(hit => {
      const row = byId.get(String(hit.record_id));
      const geometry = normalizeGeometry(hit);
      return {
        ...row,
        id:row?.id ?? hit.record_id,
        record_id:String(hit.record_id),
        vector_similarity:Number(hit.raw_vector_similarity ?? hit.similarity ?? 0),
        retrieval_score:hit.retrieval_score ?? null,
        view_evidence:hit.view_evidence || [],
        probe_ids:hit.probe_ids || [],
        raw_vector_similarity:Number(hit.raw_vector_similarity ?? hit.similarity ?? 0),
        probe_consensus:Number(hit.probe_consensus ?? 0),
        probe_rrf:Number(hit.probe_rrf ?? 0),
        probe_count:Number(hit.probe_count ?? 1),
        vector_object_key:hit.object_key || "",
        vector_asset_type:hit.asset_type || "",
        best_view_evidence:{asset_type:hit.asset_type||null,object_key:hit.object_key||null,raw_similarity:hit.raw_vector_similarity??hit.similarity,selection:"highest_raw_cosine"},
        hole_count:geometry.hole_count,
        aspect_ratio:geometry.aspect_ratio,
        hole_centroids:geometry.hole_centroids,
        contour_signature:geometry.contour_signature || null,
        geometry_version:geometry.geometry_version,
        quality:geometry.quality,
        provenance:geometry.provenance
      };
    });
}
