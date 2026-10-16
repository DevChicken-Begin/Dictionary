// Offline exact retrieval over local inference snapshots only; never writes an app index.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ABLATIONS,rankAblation} from '../evaluation/moris-v6/ablation.js';
import {validateManifest} from '../evaluation/moris-v6/manifest.js';
import {evaluateSnapshots} from '../evaluation/moris-v6/metrics.js';
import {assessImageResult} from '../functions/_lib/moris/v5/presentation/imageDecision.js';
const [manifestPath,queryPath,indexPath,indexManifestPath,out]=process.argv.slice(2);
if(!out)throw Error('Usage: manifest queries index index-manifest output-dir [--final-holdout]');
const manifest=(await readFile(manifestPath,'utf8')).trim().split('\n').map(JSON.parse);validateManifest(manifest,{requireApproved:true});
if(manifest.some(r=>r.split==='holdout')&&!process.argv.includes('--final-holdout'))throw Error('Holdout is reserved for final evaluation');
const queryBytes=await readFile(queryPath),indexBytes=await readFile(indexPath),query=JSON.parse(queryBytes),index=JSON.parse(indexBytes);
const refs=JSON.parse(await readFile(indexManifestPath,'utf8'));
if(index.results.length!==refs.length)throw Error('Catalogue inference incomplete');
if(query.results.length!==manifest.length)throw Error('Query inference incomplete');
const byId=new Map(refs.map(r=>[r.image_id,r]));
const candidates=index.results.filter(r=>r.ok).map(r=>{
 const ref=byId.get(r.query_id);if(!ref||ref.sha256!==r.sha256)throw Error('Reference hash mismatch');
 return {sku:ref.code||ref.part_id,record_id:ref.image_id,geometry:r.result.geometry,probes:r.result.probes};
});
await mkdir(out,{recursive:true});const summaries=[];
const implementationHash=createHash('sha256');
for(const path of ['evaluation/moris-v6/ablation.js','functions/_lib/moris/v5/retrieval/scoreFusion.js','functions/_lib/moris/v5/retrieval/geometricReranker.js','functions/_lib/moris/v5/retrieval/holeMatcher.js','functions/_lib/moris/v5/retrieval/contourVerifier.js','functions/_lib/moris/v5/retrieval/patchVerifier.js','functions/_lib/moris/v5/presentation/imageDecision.js','src/moris/vector/dinov2.worker.js','src/moris/vector/imageCanonicalizer.js'])implementationHash.update(await readFile(path));
const algorithm_sha256=implementationHash.digest('hex');
for(const mode of ABLATIONS){
 const predictions=[],review=[];
 for(const m of manifest){
  const q=query.results.find(r=>r.query_id===m.query_id);if(!q||q.sha256!==m.sha256)throw Error('Query hash mismatch');
  const start=performance.now();const ranked=q.ok?rankAblation(q.result,candidates,mode):{retrieval:[],candidates:[]};
  review.push(assessImageResult(ranked.candidates,{quality:q.result?.geometry?.quality}));
  predictions.push({query_id:m.query_id,sha256:m.sha256,candidates:ranked.candidates.map(r=>({sku:r.sku,score:r.final_score})),retrieval_candidates:ranked.retrieval.map(r=>r.sku),retrieval_k:50,retrieval_complete:true,accepted:q.ok?null:false,latency_ms:q.latency_ms+performance.now()-start});
 }
 const snapshot={created_at:new Date().toISOString(),profile:query.results.find(r=>r.ok)?.result.probes[0].profile,algorithm:`local_exact_front_reference_${mode}_v1`,latency_scope:'Observed Chromium WASM inference (includes optional descriptor extraction) plus local Node exact retrieval/rerank; concurrent local jobs, not isolated production p95',predictions};
 const report=evaluateSnapshots(manifest,predictions);
 report.review_guidance={calibrated:false,automatic_accepts:0,needs_review:review.filter(r=>r.status==='needs_review').length,no_match:review.filter(r=>r.status==='no_match').length,suggestions:review.filter(r=>r.status==='suggestions').length,scope:'Conservative UI guidance only; suggestions are not accepted identities and unknown false-accept is unmeasured'};
 report.provenance={algorithm_sha256,algorithm:snapshot.algorithm,profile:snapshot.profile,latency_scope:snapshot.latency_scope,query_sha256:createHash('sha256').update(queryBytes).digest('hex'),index_sha256:createHash('sha256').update(indexBytes).digest('hex'),index_expected:refs.length,index_success:candidates.length,index_failures:index.results.filter(r=>!r.ok).length,commit_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),timestamp:snapshot.created_at,production_writes:0};
 await writeFile(`${out}/${mode}-snapshot.json`,JSON.stringify(snapshot,null,2)+'\n');await writeFile(`${out}/${mode}-report.json`,JSON.stringify(report,null,2)+'\n');summaries.push({mode,n:report.n,metrics:report.metrics,review_guidance:report.review_guidance,confidence_intervals:report.confidence_intervals,provenance:report.provenance,dataset:report.dataset});
}
await writeFile(`${out}/summary.json`,JSON.stringify(summaries,null,2)+'\n');console.log(JSON.stringify(summaries.map(r=>({mode:r.mode,n:r.n,metrics:r.metrics})),null,2));
