import {createHash} from 'node:crypto';
export const manifestHash=rows=>createHash('sha256').update(rows.map(row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))))).sort().join('\n')).digest('hex');
export function validateManifest(rows,{requireApproved=false}={}){
 const ids=new Set(),hashes=new Set(),groups=new Map(),shots=new Map();
 if(!Array.isArray(rows)||!rows.length)throw Error('Manifest must contain rows');
 for(const row of rows){
  for(const key of ['query_id','sha256','source_group','physical_shot_id','view','lighting','angle','source_kind','split','label_status'])if(typeof row[key]!=='string'||!row[key].trim())throw Error(`Missing ${key}`);
  if(ids.has(row.query_id))throw Error('Duplicate query_id');ids.add(row.query_id);
  if(!/^[a-f0-9]{64}$/.test(row.sha256))throw Error('Invalid SHA256');
  if(hashes.has(row.sha256))throw Error('Duplicate image hash');hashes.add(row.sha256);
  if(!['development','holdout'].includes(row.split))throw Error('Invalid split');
  if(!['same_asset','cross_view','camera','synthetic'].includes(row.source_kind))throw Error('Invalid source_kind');
  if(typeof row.known!=='boolean')throw Error('Missing known/unknown label');
  if(row.known ? typeof row.expected_sku!=='string'||!row.expected_sku.trim() : row.expected_sku!==null)throw Error('Invalid expected_sku');
  if(!['approved','filename_pending','synthetic'].includes(row.label_status))throw Error('Invalid label_status');
  if(row.source_kind==='synthetic' && row.label_status!=='synthetic')throw Error('Synthetic source must be labelled synthetic');
  if(row.source_kind!=='synthetic' && row.label_status==='synthetic')throw Error('Real source cannot be labelled synthetic');
  if(row.label_status==='approved' && (!row.curator || !row.labelled_at))throw Error('Approved label needs curator/time');
  if((requireApproved || row.split==='holdout') && !['approved','synthetic'].includes(row.label_status))throw Error('Unapproved label cannot certify evaluation/holdout');
  if(typeof row.asset_path!=='string'||!row.asset_path||row.asset_path.startsWith('/')||row.asset_path.includes('..')||/[?:\\]/.test(row.asset_path))throw Error('Asset path must be relative and token-free');
  if(/https?:|bearer |token=|secret=/i.test(JSON.stringify(row)))throw Error('Potential remote URL/credential in manifest');
  for(const [map,key] of [[groups,row.source_group],[shots,row.physical_shot_id]]){
   if(map.has(key)&&map.get(key)!==row.split)throw Error('Source/physical shot leaks across splits');map.set(key,row.split);
  }
  if(row.hole_count_label!=null && (!Number.isInteger(row.hole_count_label)||row.hole_count_label<0))throw Error('Invalid hole label');
 }
 return {schema_version:'moris_dataset_v1',rows:rows.length,sha256:manifestHash(rows),camera:rows.filter(r=>r.source_kind==='camera').length,holdout:rows.filter(r=>r.split==='holdout').length,approved:rows.filter(r=>r.label_status==='approved').length,provisional:rows.filter(r=>r.label_status==='filename_pending').length};
}
