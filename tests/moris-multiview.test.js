import {describe,it,expect,vi,afterEach} from 'vitest';
import {fuseProbeHits} from '../functions/_lib/moris/v5/retrieval/multiProbeSearch.js';
import {finalizeCandidatePool} from '../functions/_lib/moris/v5/retrieval/candidatePool.js';
import {hydrateVectorHits} from '../functions/_lib/moris/v5/connectors/catalogue.js';
import {publicCandidate} from '../functions/_lib/moris/v5/schemas/candidate.js';
afterEach(()=>vi.unstubAllGlobals());
describe('SKU multi-view result contract',()=>{
 it('keeps a correct SKU found only on back and exposes selected view',async()=>{
  const hits=fuseProbeHits([{probe_id:'rgb',hits:[{record_id:'a',asset_type:'front',similarity:.5},{record_id:'a',asset_type:'back',similarity:.93}]}]);
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json([{id:'a',part_id:'123',usage_side:'left'}])));
  const [row]=await hydrateVectorHits({SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'fixture'},'a.b.c',hits);
  expect(row.vector_asset_type).toBe('back');expect(row.raw_vector_similarity).toBe(.93);
  expect(publicCandidate(row).best_view_evidence.asset_type).toBe('back');expect(row.view_evidence).toHaveLength(2);
 });
 it('duplicate probe records do not multiply consensus or view evidence',()=>{
  const hit={record_id:'a',asset_type:'back',similarity:.9};
  const [row]=fuseProbeHits([{probe_id:'rgb',hits:[hit,hit]},{probe_id:'rgb',hits:[hit,hit]}]);
  expect(row.probe_count).toBe(1);expect(row.view_evidence).toHaveLength(1);
 });
 it('chooses best final score per SKU even when lower view arrives first',async()=>{
  const {candidates}=await finalizeCandidatePool([{id:'a',part_id:'sku',final_score:.3},{id:'b',part_id:'sku',final_score:.9},{id:'c',part_id:'other',final_score:.8}]);
  expect(candidates.map(r=>r.id)).toEqual(['b','c']);
 });
 it('caps Top10 unique SKUs, drops nonfinite scores and sorts one score unit',async()=>{
  const rows=Array.from({length:20},(_,i)=>({id:String(i),part_id:String(i%12),final_score:i/20,vector_similarity:1-i/20}));
  const {candidates}=await finalizeCandidatePool([...rows,{id:'bad',final_score:NaN}]);
  expect(candidates).toHaveLength(10);expect(new Set(candidates.map(r=>r.part_id)).size).toBe(10);
  expect(candidates[0].final_score).toBe(.95);
 });
});
