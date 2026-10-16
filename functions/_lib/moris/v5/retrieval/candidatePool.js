import { stableHash } from "../../../shared/hash.js";

export async function finalizeCandidatePool(rows, {limit=10}={}) {
  const map = new Map();

  for (const row of rows || []) {
    const id = String(row?.id ?? row?.record_id ?? "");
    if (!id) continue;
    const key=String(row.part_id || row.code || id);
    const score=Number(row.final_score ?? row.match_score ?? row.vector_similarity ?? 0);
    if(!Number.isFinite(score))continue;
    const prior=map.get(key);
    const priorScore=Number(prior?.final_score ?? prior?.match_score ?? prior?.vector_similarity ?? -Infinity);
    if(!prior || score>priorScore)map.set(key,row);
  }

  const candidates = [...map.values()]
    .sort((a, b) => {
      const scoreA = Number(a?.final_score ?? a?.match_score ?? a?.vector_similarity ?? 0);
      const scoreB = Number(b?.final_score ?? b?.match_score ?? b?.vector_similarity ?? 0);
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
