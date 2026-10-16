import {describe,it,expect,vi,afterEach} from 'vitest';
import {fuseProbeHits,searchMultiProbeVectorIndex} from '../functions/_lib/moris/v5/retrieval/multiProbeSearch.js';
import {collapseBestVectorHitPerRecord} from '../functions/_lib/moris/v5/retrieval/vectorHitCollapse.js';
import {hydrateVectorHits} from '../functions/_lib/moris/v5/connectors/catalogue.js';
import {validateMorisQuery} from '../functions/_lib/moris/v5/schemas/query.js';
import {readMorisConfig} from '../functions/_lib/moris/v5/runtime/config.js';
const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
afterEach(()=>vi.unstubAllGlobals());
describe('M09 candidate retrieval contract',()=>{
 it('collapses views without losing evidence or best-view geometry',()=>{
  const hits=['thumb','front','detail'].map((asset_type,i)=>({record_id:'a',asset_type,object_key:asset_type,similarity:.7+i*.1,hole_count:i}));
  const [result]=collapseBestVectorHitPerRecord(hits);
  expect(result.asset_type).toBe('detail');expect(result.hole_count).toBe(2);expect(result.view_evidence).toHaveLength(3);
 });
 it('RRF has a separate unit, only one contribution per SKU/probe',()=>{
  const hits=[{record_id:'a',asset_type:'front',similarity:.8},{record_id:'a',asset_type:'thumb',similarity:.7}];
  const [result]=fuseProbeHits([{probe_id:'rgb',hits},{probe_id:'gray',hits:[{record_id:'a',similarity:.85}]}]);
  expect(result.similarity).toBe(.85);expect(result.raw_vector_similarity).toBe(.85);
  expect(result.probe_rrf).toBe(1);expect(result.retrieval_score).not.toBe(result.similarity);
  expect(result.probe_ids).toEqual(['rgb','gray']);expect(result.view_evidence).toHaveLength(3);
 });
 it('identical query vectors cannot manufacture consensus',async()=>{
  const fetch=vi.fn(async()=>Response.json([{record_id:'a',similarity:.6}]));vi.stubGlobal('fetch',fetch);
  const hits=await searchMultiProbeVectorIndex(env,readMorisConfig({}),[{probe_id:'a',vector:[1]},{probe_id:'b',vector:[1]}]);
  expect(fetch).toHaveBeenCalledTimes(1);expect(hits[0].probe_count).toBe(1);expect(hits[0].similarity).toBe(.6);
 });
 it('sends filters and checks returned metadata, excludes orphan/missing metadata',async()=>{
  const fetch=vi.fn(async(_,o)=>{
   expect(JSON.parse(o.body)).toMatchObject({p_usage_side:'left',p_view_mode:'dual_face'});
   return Response.json([{id:'a',usage_side:'left',view_mode:'dual_face'},{id:'b',usage_side:'right',view_mode:'dual_face'},{id:'c',usage_side:'left',view_mode:'single_face'}]);
  });vi.stubGlobal('fetch',fetch);
  const hits=['a','b','c','orphan'].map(record_id=>({record_id,similarity:.8,view_evidence:[{asset_type:'front'}]}));
  const rows=await hydrateVectorHits(env,'a.b.c',hits,{filters:{usage_side:'left',view_mode:'dual_face'}});
  expect(rows.map(r=>r.id)).toEqual(['a']);expect(rows[0].hole_count).toBeNull();expect(rows[0].view_evidence).toHaveLength(1);
 });
 it('rejects invalid filters rather than silently broadening retrieval',()=>{
  expect(()=>validateMorisQuery({message:'x',filters:{usage_side:'LEFT OR true'}},readMorisConfig({}))).toThrow(/lọc/);
 });
 it('discards invalid identity/score and keeps deterministic ties',()=>{
  expect(collapseBestVectorHitPerRecord([{similarity:1},{record_id:'x',similarity:NaN},{record_id:'b',similarity:.7},{record_id:'a',similarity:.7}]).map(x=>x.record_id)).toEqual(['a','b']);
 });
});
