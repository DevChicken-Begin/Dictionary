// Exact-versus-HNSW audit in a disposable LOCAL database; never connects to production.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
const [indexPath,queryPath,out]=process.argv.slice(2);if(!out)throw Error('Usage: index-inference query-inference output.json');
const index=JSON.parse(await readFile(indexPath,'utf8')),queries=JSON.parse(await readFile(queryPath,'utf8'));
const container='moris-v6-test',database=`moris_ann_${Date.now()}`;
const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d',database,'-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const vector=r=>{
 const v=r.result.probes[0].embedding;
 if(v.length!==384||!v.every(Number.isFinite))throw Error('Invalid embedding');
 return `'${JSON.stringify(v)}'::halfvec(384)`;
};
const rows=index.results.filter(r=>r.ok),qs=queries.results.filter(r=>r.ok);
const profile=JSON.stringify(rows[0].result.probes[0].profile);
if([...rows,...qs].some(r=>JSON.stringify(r.result.probes[0].profile)!==profile))throw Error('Profile mismatch');
if(rows.some(r=>!/^[a-f0-9-]+$/.test(r.query_id)))throw Error('Invalid reference id');
execFileSync('docker',['exec',container,'createdb','-U','postgres',database]);
try{
 sql('CREATE EXTENSION vector; CREATE TABLE items(id text PRIMARY KEY, embedding halfvec(384));');
 sql('INSERT INTO items VALUES '+rows.map(r=>`('${r.query_id}',${vector(r)})`).join(',')+';');
 sql('CREATE INDEX items_hnsw ON items USING hnsw (embedding halfvec_cosine_ops); ANALYZE items;');
 const observations=[];
 for(const q of qs){
  const query=`SELECT id FROM items ORDER BY embedding <=> ${vector(q)} LIMIT 50;`;
  const exact=sql('SET enable_indexscan=off; SET enable_bitmapscan=off; '+query).split('\n');
  const approximate=sql('SET enable_seqscan=off; SET hnsw.ef_search=100; '+query).split('\n');
  const overlap=approximate.filter(id=>exact.includes(id)).length;
  observations.push({query_id:q.query_id,exact_count:exact.length,ann_count:approximate.length,overlap50:overlap,recall_vs_exact:overlap/exact.length});
 }
 const plan=sql('SET enable_seqscan=off; SET hnsw.ef_search=100; EXPLAIN (FORMAT JSON) SELECT id FROM items ORDER BY embedding <=> '+vector(qs[0])+' LIMIT50;'.replace('LIMIT50','LIMIT 50'));
 if(!plan.includes('items_hnsw'))throw Error('HNSW plan not used');
 const report={timestamp:new Date().toISOString(),scope:'LOCAL halfvec384 exact versus HNSW, one front/reference perSKU, actual development queries; no production ANN inference',index_rows:rows.length,queries:qs.length,profile:JSON.parse(profile),hnsw_ef_search:100,pgvector_version:sql("SELECT extversion FROM pg_extension WHERE extname='vector';"),mean_recall_vs_exact:observations.reduce((s,r)=>s+r.recall_vs_exact,0)/observations.length,min_recall_vs_exact:Math.min(...observations.map(r=>r.recall_vs_exact)),all_top50_complete:observations.every(r=>r.ann_count===50),index_plan_verified:true,production_writes:0,observations};
 await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,observations:undefined},null,2));
}finally{execFileSync('docker',['exec',container,'dropdb','-U','postgres',database]);}
