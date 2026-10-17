import { buildMorisUserMessage } from "./userMessage.js";

export function toPublicMorisResult(result,{debug=false}={}){
  const rawList = Array.isArray(result?.candidates) ? [...result.candidates] : [];
  const isFeatureMode = result?.mode === 'feature_filter' || result?.match_source === 'identifying_features';

  const processedList = rawList.map(c => {
    if (isFeatureMode || c?.match_source === 'identifying_features' || c?.score_source === 'identifying_features_match' || c?.is_feature_match) {
      return {
        ...c,
        is_feature_match: true,
        badge_label: 'Khớp'
      };
    }
    return c;
  });

  const sortedCandidates = processedList
    .sort((a, b) => {
      const scoreA = Number(a?.match_score ?? a?.final_score ?? a?.geometric_score ?? a?.vector_similarity ?? 0);
      const scoreB = Number(b?.match_score ?? b?.final_score ?? b?.geometric_score ?? b?.vector_similarity ?? 0);
      return scoreB - scoreA;
    })
    .slice(0, 10);

  const out = {
    ok:true,
    user_message:buildMorisUserMessage({ ...result, candidates: sortedCandidates }),
    candidates:sortedCandidates,
    decision:result?.decision || null
  };

  if(result?.size_evidence) out.size_evidence = result.size_evidence;

  if(debug){
    out.debug = {
      mode:result?.mode || null,
      summary:result?.summary || null,
      warnings:result?.warnings || [],
      ai_calls:result?.ai_calls ?? null,
      candidate_pool_hash:result?.candidate_pool_hash || null,
      size_evidence:result?.size_evidence || null
    };
  }
  return out;
}
