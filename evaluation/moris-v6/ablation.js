import {collectGeometryEvidence} from '../../functions/_lib/moris/v5/retrieval/geometricReranker.js';
import {fuseCandidateScore} from '../../functions/_lib/moris/v5/retrieval/scoreFusion.js';
import {compareContour} from '../../functions/_lib/moris/v5/retrieval/contourVerifier.js';
import {comparePatches} from '../../functions/_lib/moris/v5/retrieval/patchVerifier.js';
export const ABLATIONS=['global','holes','contour','patch'];
export function rankAblation(query,candidates,mode){
 if(!ABLATIONS.includes(mode))throw Error('Unknown ablation');
 const vector=query?.probes?.[0]?.embedding;
 const valid=v=>Array.isArray(v)&&v.length===384&&v.every(Number.isFinite)&&Math.abs(Math.hypot(...v)-1)<.01;
 if(!valid(vector))throw Error('Invalid query vector');
 const identity=JSON.stringify(query.probes[0].profile);
 if(candidates.some(c=>JSON.stringify(c.probes?.[0]?.profile)!==identity||!valid(c.probes[0].embedding)))throw Error('Candidate embedding profile/vector mismatch');
 const ranked=candidates.map(c=>({...c,raw_vector_similarity:vector.reduce((sum,v,i)=>sum+v*c.probes[0].embedding[i],0)})).sort((a,b)=>b.raw_vector_similarity-a.raw_vector_similarity||a.sku.localeCompare(b.sku));
 const unique=[...new Map(ranked.map(r=>[r.sku,ranked.find(x=>x.sku===r.sku)])).values()];
 const pool=unique.slice(0,100).map((r,index)=>{
  const g=mode==='global'?{}:collectGeometryEvidence(r.geometry||{},query.geometry||{});
  if(mode==='contour'||mode==='patch')g.contour=compareContour(query.geometry||{},r.geometry||{});
  if(mode==='patch'&&index<10)g.patch=comparePatches(query.geometry||{},r.geometry||{});
  return {...r,...fuseCandidateScore({raw_vector_similarity:r.raw_vector_similarity,geometry_evidence:g})};
 }).sort((a,b)=>b.final_score-a.final_score||a.sku.localeCompare(b.sku));
 return {retrieval:unique.slice(0,50),candidates:pool.slice(0,10)};
}
