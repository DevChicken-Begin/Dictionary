// Local, no-network evidence linker. Default prints only a summary; --write updates the review queue.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {resolveReviewQueue,attachDevelopmentEvidence} from '../evaluation/moris-v6/reviewAssets.js';
import {validateHardNegativeCases} from '../evaluation/moris-v6/hardNegatives.js';
const priv='evaluation/moris-v6/private/';
const [queue,records,assets,fronts]=await Promise.all([
 readFile('evaluation/moris-v6/hard-negative-review-queue.json','utf8').then(JSON.parse),
 readFile(priv+'catalogue-snapshot.json','utf8').then(JSON.parse),
 readFile(priv+'catalogue-assets.json','utf8').then(JSON.parse),
 readFile(priv+'catalogue-front-manifest.json','utf8').then(JSON.parse)
]);
const hashes=new Map();
for(const front of fronts){
 const bytes=await readFile(resolve(priv+'catalogue-front',front.local_file));
 hashes.set(front.local_file,{sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
}
const recordsWithLegacyRef=records.map(row=>({...row,record_ref:createHash('md5').update(row.id).digest('hex')}));
let resolved=resolveReviewQueue(queue,recordsWithLegacyRef,assets,fronts,hashes);
if(process.argv.includes('--development')){
 const [devManifest,global]=await Promise.all([
  readFile('evaluation/moris-v6/private/camera124-v1-development.jsonl','utf8').then(s=>s.trim().split('\n').map(JSON.parse)),
  readFile('evaluation/moris-v6/private/ablation-development/global-snapshot.json','utf8').then(JSON.parse)
 ]);
 resolved=attachDevelopmentEvidence(resolved,devManifest,global.predictions);
}
if(resolved.length!==57)throw Error('Review queue scope changed: expected 57 cases');
const counts=validateHardNegativeCases(resolved);
const summary={
 cases:resolved.length,
 record_refs_resolved:resolved.filter(x=>x.record_ref).length,
 pair_cases:resolved.filter(x=>x.sku_pair).length,
 front_hashes_verified:resolved.flatMap(x=>x.review_assets).filter(x=>x.downloaded_front).length,
 approved:counts.approved,
 rejected:counts.rejected||0,
 unlabelled_pending:counts.pending,
 development_query_linked:resolved.filter(x=>x.development_evidence?.queries?.length).length,
 no_development_query:resolved.filter(x=>x.development_evidence&&!x.development_evidence.queries.length).length,
 network_calls:0,
 production_writes:0
};
if(process.argv.includes('--write'))await writeFile('evaluation/moris-v6/hard-negative-review-queue.json',JSON.stringify(resolved,null,2)+'\n');
console.log(JSON.stringify({...summary,updated:process.argv.includes('--write')},null,2));
