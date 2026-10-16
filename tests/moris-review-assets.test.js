import {describe,it,expect} from 'vitest';
import {resolveReviewQueue,attachDevelopmentEvidence} from '../evaluation/moris-v6/reviewAssets.js';
const record={id:'12345678-1234-1234-1234-123456789abc',record_ref:'0123456789abcdef0123456789abcdef',code:'SKU1'};
const row={id:'audit-1',record_ref:record.record_ref,status:'pending',expected_outcome:null};
describe('hard-negative review evidence linking',()=>{
 it('links a legacy reference to actual catalogue paths and verified local front hash without labelling',()=>{
  const asset={image_id:record.id,asset_type:'front',image_path:'front/SKU1/image.webp'};
  const linked=resolveReviewQueue([row],[record],[asset],[{image_id:record.id,local_file:'abc.webp',sha256:'a'.repeat(64),bytes:12}],new Map([['abc.webp',{sha256:'a'.repeat(64),bytes:12}]]))[0];
  expect(linked.review_assets[0]).toMatchObject({sku:'SKU1',record_id:record.id,downloaded_front:{sha256:'a'.repeat(64),bytes:12}});
  expect(linked.status).toBe('pending');expect(linked.expected_outcome).toBeNull();
 });
 it('rejects unresolved and ambiguous legacy refs or altered local bytes',()=>{
  const asset={image_id:record.id,asset_type:'front',image_path:'front/SKU1/image.webp'},front={image_id:record.id,local_file:'abc.webp',sha256:'a'.repeat(64),bytes:12};
  expect(()=>resolveReviewQueue([row],[],[asset],[front],new Map())).toThrow(/Unresolved/);
  expect(()=>resolveReviewQueue([row],[record,record],[asset],[front],new Map())).toThrow(/Ambiguous/);
  expect(()=>resolveReviewQueue([row],[record],[asset],[front],new Map([['abc.webp',{sha256:'b'.repeat(64),bytes:12}]]))).toThrow(/hash mismatch/);
 });
 it('resolves specified pairs by SKU and rejects unknown codes',()=>{
  const pair={id:'pair',sku_pair:['SKU1','SKU2'],status:'pending',expected_outcome:null},other={...record,id:'2',record_ref:'11111111111111111111111111111111',code:'SKU2'};
  const assets=[record,other].map(r=>({image_id:r.id,asset_type:'front',image_path:`front/${r.code}/image.webp`}));
  expect(resolveReviewQueue([pair],[record,other],assets,[],new Map())[0].review_assets.map(x=>x.sku)).toEqual(['SKU1','SKU2']);
  expect(()=>resolveReviewQueue([{...pair,sku_pair:['missing']}],[record],assets,[],new Map())).toThrow(/Unresolved SKU/);
 });
 it('attaches pair priority from development predictions without approving the label',()=>{
  const cases=[{id:'pair',sku_pair:['SKU1','SKU2'],status:'pending',expected_outcome:null}];
  const manifest=[{query_id:'q1',expected_sku:'SKU1',sha256:'1'.repeat(64),split:'development'},{query_id:'q2',expected_sku:'SKU2',sha256:'2'.repeat(64),split:'development'}];
  const predictions=[{query_id:'q1',sha256:'1'.repeat(64),candidates:[{sku:'SKU2'},{sku:'SKU1'}],retrieval_candidates:['SKU2','SKU1']},{query_id:'q2',sha256:'2'.repeat(64),candidates:[{sku:'SKU2'}],retrieval_candidates:['SKU2']}];
  const [linked]=attachDevelopmentEvidence(cases,manifest,predictions);
  expect(linked.development_evidence.queries[0]).toMatchObject({expected_sku:'SKU1',target_sku:'SKU2',target_rank:1,top1:false});
  expect(linked.status).toBe('pending');expect(linked.expected_outcome).toBeNull();
 });
 it('refuses holdout rows, missing queries and changed image hashes',()=>{
  const manifest=[{query_id:'q',expected_sku:'SKU1',sha256:'1'.repeat(64),split:'development'}],prediction={query_id:'q',sha256:'2'.repeat(64),candidates:[],retrieval_candidates:[]};
  expect(()=>attachDevelopmentEvidence([],manifest,[prediction])).toThrow(/identity\/hash/);
  expect(()=>attachDevelopmentEvidence([],[{...manifest[0],split:'holdout'}],[prediction])).toThrow(/development/);
  expect(()=>attachDevelopmentEvidence([],manifest,[])).toThrow(/coverage/);
 });
});
