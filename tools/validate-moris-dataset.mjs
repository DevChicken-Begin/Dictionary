// Offline only: checks a manifest and optionally verifies private image bytes.
import {readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {validateManifest} from '../evaluation/moris-v6/manifest.js';
const [manifest,assetRoot]=process.argv.slice(2).filter(a=>!a.startsWith('--'));
if(!manifest)throw Error('Usage: node tools/validate-moris-dataset.mjs manifest.jsonl [asset-root] [--approved]');
const rows=(await readFile(manifest,'utf8')).trim().split('\n').map(JSON.parse);
const report=validateManifest(rows,{requireApproved:process.argv.includes('--approved')});
if(assetRoot){
 for(const row of rows){
  const file=resolve(assetRoot,row.asset_path),rel=relative(resolve(assetRoot),file);
  if(rel.startsWith('..')||isAbsolute(rel))throw Error('Asset outside allowed root');
  const sha=createHash('sha256').update(await readFile(file)).digest('hex');
  if(sha!==row.sha256)throw Error(`Hash mismatch: ${row.query_id}`);
 }
 report.verified_image_bytes=rows.length;
}
console.log(JSON.stringify(report,null,2));
