import {validateManifest} from './manifest.js';
const ratio=(a,b)=>b?a/b:null;
export function quantile(values,p){
 if(!values.length)return null;
 const v=[...values].sort((a,b)=>a-b),x=(v.length-1)*p,lo=Math.floor(x),hi=Math.ceil(x);
 return v[lo]+(v[hi]-v[lo])*(x-lo);
}
function bootstrap(values,seed,iterations){
 if(values.length<30)return null;
 let state=seed>>>0;
 const random=()=>{state=(1664525*state+1013904223)>>>0;return state/4294967296;};
 const means=[];
 for(let i=0;i<iterations;i++){let sum=0;for(let j=0;j<values.length;j++)sum+=values[Math.floor(random()*values.length)];means.push(sum/values.length);}
 return {low:quantile(means,.025),high:quantile(means,.975),method:'percentile_bootstrap',iterations,seed};
}
function candidates(list,label){
 if(!Array.isArray(list))throw Error(`Missing ${label}`);
 const ids=list.map(x=>typeof x==='string'?x:x?.sku);
 if(ids.some(x=>typeof x!=='string'||!x)||new Set(ids).size!==ids.length)throw Error(`Invalid/duplicate SKU in ${label}`);
 return ids;
}
export function evaluateSnapshots(manifest,predictions,{allowProvisional=false,seed=6,bootstrapIterations=1000}={}){
 const dataset=validateManifest(manifest,{requireApproved:!allowProvisional});
 if(!Number.isInteger(bootstrapIterations)||bootstrapIterations<100||bootstrapIterations>10000)throw Error('Invalid bootstrap budget');
 if(!Array.isArray(predictions)||predictions.length!==manifest.length)throw Error('Prediction coverage mismatch');
 const byId=new Map();
 for(const p of predictions){if(byId.has(p.query_id))throw Error('Repeated query prediction');byId.set(p.query_id,p);}
 const observations=[];
 for(const q of manifest){
  const p=byId.get(q.query_id);if(!p)throw Error(`Missing prediction ${q.query_id}`);
  if(p.sha256!==q.sha256)throw Error('Query image hash mismatch');
  const ranked=candidates(p.candidates,'candidates');
  if((p.accepted!=null && typeof p.accepted!=='boolean')||p.accepted===true&&!ranked.length)throw Error('Explicit accepted/abstained decision required');
  if(p.latency_ms!=null && (typeof p.latency_ms!=='number'||!Number.isFinite(p.latency_ms)||p.latency_ms<0))throw Error('Invalid latency');
  const retrieval=p.retrieval_candidates==null?null:candidates(p.retrieval_candidates,'retrieval candidates');
  const measured50=retrieval!==null && p.retrieval_k>=50 && p.retrieval_complete===true;
  const rank=q.known?ranked.indexOf(q.expected_sku)+1:null;
  const retrieved=q.known&&measured50?retrieval.slice(0,50).includes(q.expected_sku):null;
  observations.push({query_id:q.query_id,known:q.known,source_kind:q.source_kind,split:q.split,
   rank:rank||null,top1:q.known?Number(rank===1):null,recall10:q.known?Number(rank>0&&rank<=10):null,
   recall50:retrieved===null?null:Number(retrieved),mrr10:q.known?(rank>0&&rank<=10?1/rank:0):null,
   abstained:p.accepted==null?null:!p.accepted,false_accept:!q.known?(p.accepted??null):null,
   retrieval_miss:retrieved===null?null:!retrieved,
   rerank_miss:retrieved===true?rank!==1:null,latency_ms:p.latency_ms??null});
 }
 const known=observations.filter(o=>o.known),unknown=observations.filter(o=>!o.known);
 const top50=known.filter(o=>o.recall50!==null),rerank=known.filter(o=>o.rerank_miss!==null);
 const latencies=observations.flatMap(o=>o.latency_ms==null?[]:[o.latency_ms]);
 const decisions=observations.filter(o=>o.abstained!==null),knownDecisions=known.filter(o=>o.abstained!==null);
 const sum=(rows,key)=>rows.reduce((s,r)=>s+Number(r[key]),0);
 return {dataset,n:observations.length,known_n:known.length,unknown_n:unknown.length,
  parameters:{seed,bootstrap_iterations:bootstrapIterations,allow_provisional:allowProvisional},
  metrics:{top1:ratio(sum(known,'top1'),known.length),recall10:ratio(sum(known,'recall10'),known.length),
   recall50:top50.length===known.length?ratio(sum(top50,'recall50'),known.length):null,
   recall50_measured_n:top50.length,mrr10:ratio(sum(known,'mrr10'),known.length),
   unknown_false_accept:unknown.every(o=>o.false_accept!==null)?ratio(sum(unknown,'false_accept'),unknown.length):null,
   abstain_rate:ratio(sum(decisions,'abstained'),decisions.length),decision_measured_n:decisions.length,
   known_abstain_rate:ratio(sum(knownDecisions,'abstained'),knownDecisions.length),
   retrieval_misses:top50.length?sum(top50,'retrieval_miss'):null,
   rerank_misses:rerank.length?sum(rerank,'rerank_miss'):null,
   latency_p50_ms:quantile(latencies,.5),latency_p95_ms:quantile(latencies,.95),latency_measured_n:latencies.length},
  confidence_intervals:{top1:bootstrap(known.map(o=>o.top1),seed,bootstrapIterations),recall10:bootstrap(known.map(o=>o.recall10),seed,bootstrapIterations)},
  strata:Object.fromEntries([...new Set(observations.map(o=>o.source_kind))].map(kind=>{const r=known.filter(o=>o.source_kind===kind);return[kind,{n:observations.filter(o=>o.source_kind===kind).length,known_n:r.length,top1:ratio(sum(r,'top1'),r.length),recall10:ratio(sum(r,'recall10'),r.length)}];})),
  observations};
}
