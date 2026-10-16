import {describe,it,expect} from 'vitest';
import {evaluateSnapshots,quantile} from '../evaluation/moris-v6/metrics.js';
const query=(id,known=true)=>({query_id:id,expected_sku:known?'A':null,known,asset_path:`${id}.png`,sha256:id.padStart(64,'0'),source_kind:'synthetic',source_group:id,physical_shot_id:id,split:'development',label_status:'synthetic',view:'front',lighting:'uniform',angle:'0'});
const prediction=(q,candidates,extra={})=>({query_id:q.query_id,sha256:q.sha256,candidates,accepted:candidates.length>0,latency_ms:10,...extra});
describe('M20 offline metric contracts',()=>{
 it('computes known ranking/unknown rejection and separates retrieval vs rerank misses',()=>{
  const q=[query('a'),query('b'),query('c'),query('d',false),query('e',false)];
  const p=[prediction(q[0],['A']),prediction(q[1],['B','A']),prediction(q[2],[]),prediction(q[3],['B']),prediction(q[4],[])];
  p.forEach((r,i)=>Object.assign(r,{retrieval_candidates:i===2?['B']:['A','B'],retrieval_k:50,retrieval_complete:true,latency_ms:10*(i+1)}));
  const r=evaluateSnapshots(q,p);
  expect(r.metrics).toMatchObject({top1:1/3,recall10:2/3,recall50:2/3,mrr10:.5,unknown_false_accept:.5,abstain_rate:.4,retrieval_misses:1,rerank_misses:1,latency_p50_ms:30,latency_p95_ms:48});
  expect(r.confidence_intervals.top1).toBeNull();
 });
 it('does not invent unknown FAR, Top50 or abstention from a truncated legacy Top10',()=>{
  const q=query('a'),r=evaluateSnapshots([q],[prediction(q,['B'],{accepted:null})]);
  expect(r.metrics).toMatchObject({top1:0,recall50:null,unknown_false_accept:null,abstain_rate:null,decision_measured_n:0});
 });
 it('Top10 boundary, shrink/no-answer and hash mismatch are explicit',()=>{
  const q=query('a'),p=prediction(q,Array.from({length:10},(_,i)=>String(i)).concat('A'));
  expect(evaluateSnapshots([q],[p]).metrics).toMatchObject({recall10:0,mrr10:0});
  expect(evaluateSnapshots([q],[prediction(q,[])]).metrics.abstain_rate).toBe(1);
  expect(()=>evaluateSnapshots([q],[{...p,sha256:'f'.repeat(64)}])).toThrow(/hash/);
 });
 it('rejects repeated predictions, duplicate SKU and missing query coverage',()=>{
  const q=[query('a'),query('b')];
  expect(()=>evaluateSnapshots(q,[prediction(q[0],['A']),prediction(q[0],['A'])])).toThrow(/Repeated/);
  expect(()=>evaluateSnapshots([q[0]],[prediction(q[0],['A','A'])])).toThrow(/duplicate/);
  expect(()=>evaluateSnapshots(q,[])).toThrow(/coverage/);
 });
 it('seeded bootstrap is deterministic with enough synthetic samples',()=>{
  const q=Array.from({length:40},(_,i)=>query(i.toString(16))),p=q.map((r,i)=>prediction(r,[i%2?'A':'B']));
  const a=evaluateSnapshots(q,p,{seed:17,bootstrapIterations:200}),b=evaluateSnapshots(q,p,{seed:17,bootstrapIterations:200});
  expect(a.confidence_intervals).toEqual(b.confidence_intervals);expect(a.confidence_intervals.top1.low).toBeLessThan(.5);expect(a.confidence_intervals.top1.high).toBeGreaterThan(.5);
 });
 it('uses observed latency only and rejects invalid measurements',()=>{
  const q=query('a');expect(evaluateSnapshots([q],[prediction(q,['A'],{latency_ms:null})]).metrics.latency_p95_ms).toBeNull();
  expect(()=>evaluateSnapshots([q],[prediction(q,['A'],{latency_ms:-1})])).toThrow(/latency/);
  expect(quantile([10,20],.95)).toBe(19.5);
 });
});
