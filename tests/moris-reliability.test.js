import {describe,it,expect} from 'vitest';
import {fuseCandidateScore} from '../functions/_lib/moris/v5/retrieval/scoreFusion.js';
import {collectGeometryEvidence} from '../functions/_lib/moris/v5/retrieval/geometricReranker.js';
import {rankMetadata,evaluateConstraints} from '../functions/_lib/moris/v5/retrieval/metadataFilter.js';
describe('reliability-aware evidence',()=>{
 it('unknown metadata is neutral, known disagreement is evidence',()=>{
  expect(evaluateConstraints({code:'123'},'hình vuông bên trái').conflicts).toEqual([]);
  const [row]=rankMetadata([{code:'123'}],'hình vuông bên trái');expect(row.metadata_available).toBe(false);
 });
 it('keeps measured zero distinct from missing and rejects poor masks',()=>{
  const z={hole_count:0,hole_centroids:[],quality:{reliable:true}};
  expect(collectGeometryEvidence(z,z).hole_match.similarity).toBe(1);
  expect(collectGeometryEvidence(z,{...z,quality:{reliable:false}}).s_holes).toBeNull();
  expect(collectGeometryEvidence(z,{}).s_holes).toBeNull();
 });
 it('zero reliability removes a signal entirely; weak contradictory evidence has less effect',()=>{
  const make=r=>fuseCandidateScore({similarity:.9,geometry_evidence:{s_holes:0,hole_match:{reliability:r}}});
  expect(make(0).final_score).toBe(.9);expect(make(.2).final_score).toBeGreaterThan(make(1).final_score);
  expect(make(1).score_breakdown.signals.reduce((s,x)=>s+x.normalized_weight,0)).toBeCloseTo(1);
 });
 it('limits conflict penalties by observed reliability',()=>{
  const make=r=>fuseCandidateScore({similarity:.9,conflicts:['side:left'],conflict_reliability:{'side:left':r}});
  expect(make(0).final_score).toBe(.9);expect(make(.2).final_score).toBeGreaterThan(make(1).final_score);
 });
 it('is finite and monotone in a measured signal with fixed availability',()=>{
  let previous=0;
  for(let i=0;i<=100;i++){
   const s=fuseCandidateScore({similarity:.8,geometry_evidence:{s_holes:i/100,hole_match:{reliability:.5}}}).final_score;
   expect(Number.isFinite(s)).toBe(true);expect(s).toBeGreaterThanOrEqual(previous);expect(s).toBeLessThanOrEqual(1);previous=s;
  }
 });
});
