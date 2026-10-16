import {describe,it,expect,vi} from 'vitest';
import {readMorisConfig} from '../functions/_lib/moris/v5/runtime/config.js';
import {runMorisSearch} from '../functions/_lib/moris/v5/orchestrator.js';

vi.mock('../functions/_lib/moris/v5/connectors/catalogue.js',()=>({
 exactLookup:vi.fn(async()=>[]),
 hydrateVectorHits:vi.fn(async()=>[
  {id:'visual',part_id:'A',raw_vector_similarity:.94,hole_count:5,quality:{reliable:true}},
  {id:'geometry',part_id:'B',raw_vector_similarity:.90,hole_count:17,quality:{reliable:true}}
 ])
}));
vi.mock('../functions/_lib/moris/v5/connectors/supabase.js',()=>({searchCatalogue:vi.fn(async()=>[]),scanCatalogue:vi.fn(async()=>[])}));
vi.mock('../functions/_lib/moris/v5/vector/encoder.js',()=>({encodeQueryImage:vi.fn(async()=>({vector:[1],source:'fixture'}))}));
vi.mock('../functions/_lib/moris/v5/vector/search.js',()=>({searchVectorIndex:vi.fn(async()=>[
 {record_id:'visual',similarity:.94},{record_id:'geometry',similarity:.90}
])}));

async function search({enabled,message=''}={}){
 const config=readMorisConfig({MORIS_VECTOR_SEARCH_ENABLED:'true'});
 if(enabled!==undefined)config.features.geometryVerification=enabled;
 return runMorisSearch({},config,{token:'fixture',ctx:{trace:[],warnings:[]},query:{
  message,query_embedding:[1],query_embeddings:[],filters:{usage_side:'all',view_mode:'all'},hints:{},
  geometry:{hole_count:17,quality:{reliable:true}}
 }});
}
describe('M22 measured geometry release gate',()=>{
 it('defaults to visual ordering without automatic hole or structural fallback votes',async()=>{
  expect(readMorisConfig({}).features.geometryVerification).toBe(false);
  const result=await search();
  expect(result.candidates.map(r=>r.id)).toEqual(['visual','geometry']);
  for(const r of result.candidates)expect(r.score_breakdown.signals.map(s=>s.name)).toEqual(['vector']);
  expect(result.candidates[0].final_score).toBe(.94);
 });
 it('retains the experimental geometry path for explicitly configured evaluation',async()=>{
  const result=await search({enabled:true});
  expect(result.candidates[0].id).toBe('geometry');
  expect(result.candidates[0].score_breakdown.signals.some(s=>s.name==='holes')).toBe(true);
 });
 it('preserves explicitly typed hole constraints while image geometry is off',async()=>{
  const result=await search({message:'17 lỗ'});
  expect(result.candidates[0].id).toBe('geometry');
  expect(result.candidates[0].score_breakdown.signals.some(s=>s.name==='structural')).toBe(true);
 });
});
