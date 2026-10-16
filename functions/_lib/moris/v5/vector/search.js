import { rpcService } from "../connectors/supabaseService.js";

function vectorLiteral(vector) {
  return `[${Array.from(vector).map(v => Number(v).toFixed(8)).join(",")}]`;
}

export async function searchVectorIndex(env, config, vector, matchCount) {
  const matchK = Math.max(
    1,
    Math.min(Number(matchCount || config.vector.topK), 100)
  );
  const vecStr = vectorLiteral(vector);

  const callRpc = async (fnName, model, modelVersion, preprocessVersion, profile) => {
    return await rpcService(env, fnName, {
      p_query_embedding: vecStr,
      p_embedding_model: model,
      p_embedding_model_version: modelVersion,
      p_preprocess_version: preprocessVersion,
      p_embedding_profile: profile,
      p_match_count: matchK
    });
  };

  let data = null;
  try {
    data = await callRpc(
      "match_catalogue_image_vectors_v6",
      config.vector.model,
      config.vector.modelVersion,
      config.vector.preprocessVersion,
      config.vector.profile
    );
  } catch {
    // Fallback to production RPC if v6 migration is not applied
    try {
      data = await callRpc(
        "match_catalogue_image_vectors",
        config.vector.model,
        config.vector.modelVersion,
        config.vector.preprocessVersion,
        config.vector.profile
      );
    } catch (e) {
      console.warn("searchVectorIndex RPC failed:", e?.message);
    }
  }

  // If new profile returns 0 hits, fallback to legacy profile (which matches 1,090 production vectors)
  if ((!Array.isArray(data) || data.length === 0) && config.vector.profile !== "cls_l2_v1") {
    try {
      const fallbackData = await callRpc(
        "match_catalogue_image_vectors",
        config.vector.model,
        config.vector.modelVersion,
        "kim_canon_v2",
        "cls_l2_v1"
      );
      if (Array.isArray(fallbackData) && fallbackData.length > 0) {
        data = fallbackData;
      }
    } catch {}
  }

  return Array.isArray(data) ? data : [];
}
