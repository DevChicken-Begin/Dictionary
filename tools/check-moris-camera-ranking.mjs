// Verification only: catalogue hydration uses a read-only snapshot adapter (no user auth).
// Vector retrieval uses the existing read-only match RPC; all other network calls blocked.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { runMorisSearch } from '../functions/_lib/moris/v5/orchestrator.js';
import { readMorisConfig } from '../functions/_lib/moris/v5/runtime/config.js';
import { validateMorisQuery } from '../functions/_lib/moris/v5/schemas/query.js';
import { headersForKey } from '../functions/_lib/moris/v5/connectors/supabaseService.js';
const root=resolve(import.meta.dirname,'..');
const input=JSON.parse(await readFile(process.argv[2],'utf8'));
const files=(await readdir(input.input_directory)).filter(f=>/\.(png|jpe?g|webp)$/i.test(f));
if(input.results.length!==files.length || input.results.some(r=>!r.ok)) throw new Error('Inference snapshot incomplete');
const env={};
for(const line of (await readFile(resolve(root,'.env'),'utf8')).split('\n')) {
 const m=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);if(m) env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');
}
const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
if(base!=='https://vhsikdgkzecdfopkpzum.supabase.co') throw new Error('Unexpected project; abort');
const nativeFetch=globalThis.fetch;
const headers=headersForKey(env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY);
const catalogue=[];
for(let offset=0;;offset+=500) {
 const q=new URLSearchParams({select:'id,code,part_id,usage_side,view_mode,is_symmetric,identifying_features,confusing_note,image_path,updated_at',order:'id.asc',limit:'500',offset:String(offset)});
 const res=await nativeFetch(`${base}/rest/v1/image_library?${q}`,{headers});
 if(!res.ok) throw new Error(`Catalogue read HTTP ${res.status}`);
 const rows=await res.json();catalogue.push(...rows);if(rows.length<500)break;
}
const calls=[];
globalThis.fetch=async(url,options={})=>{
 const path=new URL(url).pathname;
 if(new URL(url).origin!==base) throw new Error('External request blocked by benchmark');
 if(path==='/rest/v1/rpc/app_search_catalogue') {
  const a=JSON.parse(options.body);
  if(a.p_search || !['all',undefined].includes(a.p_usage_side) || !['all',undefined].includes(a.p_view_mode)) throw new Error('Snapshot adapter only supports unfiltered image queries');
  return Response.json(catalogue.slice(a.p_offset||0,(a.p_offset||0)+Math.min(a.p_limit||50,300)));
 }
 if(path==='/rest/v1/rpc/match_catalogue_image_vectors' && options.method==='POST') {
  calls.push(path);return nativeFetch(url,options);
 }
 throw new Error(`Non-read benchmark request blocked: ${path}`);
};
try {
 const config=readMorisConfig(env);const results=[];
 for(const q of input.results) {
  const probes=q.result.probes;
  const query=validateMorisQuery({message:'',query_embedding:probes[0].embedding,embedding_profile:probes[0].profile,query_embeddings:probes.map(p=>({probe_id:p.probe_id,embedding:p.embedding,embedding_profile:p.profile})),geometry:q.result.geometry},config);
  const ctx={warnings:[],trace:[]};const start=performance.now();
  const out=await runMorisSearch(env,config,{token:'snapshot.readonly.adapter',query,ctx});
  const rank=out.candidates.findIndex(c=>c.code===q.expected_sku);
  const row={query_id:q.query_id,expected_sku:q.expected_sku,sha256:q.sha256,probe_count:probes.length,inference_ms:q.latency_ms,search_ms:Math.round(performance.now()-start),rank:rank<0?null:rank+1,mode:out.mode,top10:out.candidates.map(c=>({code:c.code,score:c.match_score??c.final_score??null})),detected_holes:q.result.geometry?.hole_count,trace:ctx.trace.map(s=>s.stage)};
  results.push(row);console.log(JSON.stringify({query_id:q.query_id,rank:row.rank,top1:row.top10[0]?.code}));
 }
 const n=results.length;
 const report={created_at:new Date().toISOString(),n,catalogue_skus:catalogue.length,catalogue_snapshot_sha256:createHash('sha256').update(JSON.stringify(catalogue)).digest('hex'),profile:config.vector,top1:results.filter(r=>r.rank===1).length,recall10:results.filter(r=>r.rank!==null).length,mrr10:results.reduce((s,r)=>s+(r.rank?1/r.rank:0),0)/n,read_only_vector_rpc_calls:calls.length,production_writes:0,scope:'Actual browser RGB+gray query probes and unmodified V5 orchestrator, live read-only vector RPC, catalogue snapshot hydration adapter. No indexed gray created. Not deployed HTTP/auth/UI or full staging E2E. Six owner camera files; labels from filenames; no unknown negatives/holdout.',results};
 await writeFile(resolve(root,'docs/moris-v6/evidence/phase-a-camera-orchestrator.json'),JSON.stringify(report,null,2)+'\n');
}finally{globalThis.fetch=nativeFetch;}
