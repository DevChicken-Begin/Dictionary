import {rankMetadata} from '../functions/_lib/moris/v5/retrieval/metadataFilter.js';
import {describe,it,expect} from 'vitest';
import {fuseCandidateScore} from '../functions/_lib/moris/v5/retrieval/scoreFusion.js';
import {collectGeometryEvidence,rerankCandidatesByGeometry} from '../functions/_lib/moris/v5/retrieval/geometricReranker.js';
import {publicCandidate} from '../functions/_lib/moris/v5/schemas/candidate.js';
import {finalizeCandidatePool} from '../functions/_lib/moris/v5/retrieval/candidatePool.js';
describe('M12 sole final scoring owner',()=>{
 it('metadata conflict survives geometry, public serialization and pool sorting',async()=>{
  const base={id:'a',similarity:.9,hole_count:3,aspect_ratio:2};
  const query={hole_count:3,aspect_ratio:2};
  const [plain]=rerankCandidatesByGeometry([base],query);
  const [conflict]=rerankCandidatesByGeometry([{...base,id:'b',conflicts:['side:left'],conflict_reliability:{'side:left':1}}],query);
  expect(conflict.final_score).toBeLessThan(plain.final_score);
  expect(conflict.score_breakdown.conflict_penalty).toBe(.08);
  expect(publicCandidate({...conflict,geometric_score:1}).final_score).toBe(conflict.final_score);
  const pool=await finalizeCandidatePool([conflict,plain]);expect(pool.candidates[0].id).toBe('a');
 });
 it('unknown evidence does not award points or consume weight',()=>{
  const c=fuseCandidateScore({vector_similarity:.8,geometry_evidence:collectGeometryEvidence({},{}),probe_consensus:1});
  expect(c.final_score).toBe(.8);expect(c.score_breakdown.signals.map(x=>x.name)).toEqual(['vector']);
 });
 it('one count signal only; no duplicate structural votes',()=>{
  const base={vector_similarity:.9,geometry_evidence:{s_holes:.5}};
  expect(fuseCandidateScore({...base,structural_score:1,structural_available:true}).final_score).toBe(fuseCandidateScore(base).final_score);
 });
 it('image metadata path excludes count already owned by structural/geometry',()=>{
  const [row]=rankMetadata([{id:'a',identifying_features:'17 lỗ'}],'17 lỗ',{excludeHoleEvidence:true});
  expect(row.metadata_available).toBe(false);expect(row.conflicts).toEqual([]);
 });
 it('strong 17-versus-5 hole evidence can correct a slightly worse vector',()=>{
  const q={hole_count:17};
  const out=rerankCandidatesByGeometry([{id:'wrong',similarity:.94,hole_count:5},{id:'right',similarity:.9,hole_count:17}],q);
  expect(out[0].id).toBe('right');expect(out[1].s_holes).toBe(0);
 });
 it('deterministic finite bounded score and conflict deduplication',()=>{
  const c={vector_similarity:.8,conflicts:['side:left','side:left'],conflict_reliability:{'side:left':1}};
  expect(fuseCandidateScore(c)).toEqual(fuseCandidateScore(c));expect(fuseCandidateScore(c).score_breakdown.conflict_penalty).toBe(.08);
  expect(fuseCandidateScore({vector_similarity:NaN}).final_score).toBe(0);
 });
});
