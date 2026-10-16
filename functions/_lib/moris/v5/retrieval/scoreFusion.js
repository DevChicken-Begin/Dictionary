const clamp01=v=>Math.max(0,Math.min(1,Number(v)||0));

// Sole owner of image candidate final_score. Scores are rankings, not probabilities.
export function fuseCandidateScore(candidate) {
  const geometry=candidate.geometry_evidence||{};
  const signals=[];
  const add=(name,score,weight,available=true,reliability=1)=>{
    const r=typeof reliability==='number' && Number.isFinite(reliability)?clamp01(reliability):0;
    if(available && r>0 && typeof score==='number' && Number.isFinite(score))signals.push({name,score:clamp01(score),base_weight:weight,reliability:r,weight:weight*r});
  };
  add('vector',candidate.raw_vector_similarity??candidate.vector_similarity??candidate.similarity,.65,true,candidate.vector_reliability??1);
  add('holes',geometry.s_holes,.20,true,geometry.hole_match?.reliability??.25);
  add('aspect',geometry.s_ratio,.10,true,geometry.aspect_reliability??.25);
  add('patch',geometry.patch?.similarity,.15,geometry.patch?.available===true,geometry.patch?.reliability??0);
  add('contour',geometry.contour?.similarity,.15,geometry.contour?.available===true,geometry.contour?.reliability??0);
  add('metadata',candidate.metadata_score,.10,candidate.metadata_available===true,candidate.metadata_reliability??.5);
  // Count comparison is already represented by holes; never include it twice.
  add('structural',candidate.structural_score,.20,geometry.s_holes==null && candidate.structural_available===true,candidate.structural_reliability??.25);
  const totalWeight=signals.reduce((s,x)=>s+x.weight,0);
  const conflicts=[...new Set(candidate.conflicts||[])].filter(c=>c!=='structural_conflict');
  const conflictEvidence=conflicts.map(name=>({name,reliability:clamp01(candidate.conflict_reliability?.[name]??.25)}));
  const penalty=Math.min(.24,conflictEvidence.reduce((sum,c)=>sum+.08*c.reliability,0));
  const weighted=signals.length===1?signals[0].score:totalWeight?signals.reduce((s,x)=>s+x.score*x.weight,0)/totalWeight:0;
  const score=clamp01(weighted-penalty);
  return {...candidate,final_score:score,match_score:score,score_source:'moris_v6_fusion_v1',
    geometric_warning:geometry.geometric_warning||null,
    score_breakdown:{signals:signals.map(x=>({...x,normalized_weight:x.weight/totalWeight})),
      weighted_score:weighted,conflicts,conflict_evidence:conflictEvidence,conflict_penalty:penalty,final_score:score,unit:'ranking_score'}};
}
