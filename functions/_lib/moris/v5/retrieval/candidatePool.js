import { stableHash } from "../../../shared/hash.js";

export async function finalizeCandidatePool(rows, {limit=10}={}) {
  const map = new Map();

  for (const row of rows || []) {
    const id = String(row?.id ?? row?.record_id ?? "");
    if (!id || map.has(id)) continue;
    map.set(id,row);
  }

  const candidates = [...map.values()]
    .sort((a, b) => {
      const scoreA = Number(a?.geometric_score ?? a?.match_score ?? a?.final_score ?? a?.vector_similarity ?? 0);
      const scoreB = Number(b?.geometric_score ?? b?.match_score ?? b?.final_score ?? b?.vector_similarity ?? 0);
      return scoreB - scoreA;
    })
    .slice(0, limit);

  const hash = await stableHash(
    candidates.map(x => ({
      id:String(x?.id ?? x?.record_id),
      score:Number(x?.final_score || 0)
    }))
  );

  return {candidates,hash};
}
