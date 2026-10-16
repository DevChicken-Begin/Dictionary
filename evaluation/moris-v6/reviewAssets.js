// Resolves historical M08 MD5 record references to current read-only catalogue evidence.
export function resolveReviewQueue(cases,records,assets,downloadedFronts,fileHashes){
 const byReference=new Map();
 for(const row of records){
  const ref=row.record_ref;
  if(typeof ref!=='string'||!/^[a-f0-9]{32}$/.test(ref))throw Error('Invalid legacy record reference');
  if(byReference.has(ref))throw Error('Ambiguous legacy record reference');
  byReference.set(ref,row);
 }
 const byId=new Map(),byCode=new Map(),byAssets=new Map(),byFront=new Map();
 for(const row of records){byId.set(row.id,row);if(row.code)byCode.set(String(row.code),row);}
 for(const asset of assets){if(!byAssets.has(asset.image_id))byAssets.set(asset.image_id,[]);byAssets.get(asset.image_id).push(asset);}
 for(const front of downloadedFronts)byFront.set(front.image_id,front);
 return cases.map(item=>{
  let selected=[];
  if(item.record_ref){const record=byReference.get(item.record_ref);if(!record)throw Error(`Unresolved legacy reference ${item.id}`);selected=[record];}
  else if(Array.isArray(item.sku_pair)){selected=item.sku_pair.map(code=>byCode.get(String(code)));if(selected.some(row=>!row))throw Error(`Unresolved SKU pair ${item.id}`);}
  else throw Error(`Review item has no catalogue identity ${item.id}`);
  const review_assets=selected.map(record=>{
   const catalogue_assets=byAssets.get(record.id)||[];
   if(!catalogue_assets.length)throw Error(`No catalogue assets for ${record.id}`);
   const front=byFront.get(record.id)||null;
   let local_front=null;
   if(front){
    const actual=fileHashes.get(front.local_file);
    if(!actual||actual.sha256!==front.sha256||actual.bytes!==front.bytes)throw Error(`Downloaded front hash mismatch for ${record.id}`);
    local_front={path:`evaluation/moris-v6/private/catalogue-front/${front.local_file}`,sha256:actual.sha256,bytes:actual.bytes};
   }
   return {sku:String(record.code||record.part_id||''),record_id:record.id,catalogue_assets:catalogue_assets.map(({asset_type,image_path})=>({asset_type,image_path})),downloaded_front:local_front};
  });
  return {...item,review_assets};
 });
}

// Adds prioritization context only. Development rankings never certify a curator label.
export function attachDevelopmentEvidence(cases,manifest,predictions){
 if(!Array.isArray(manifest)||manifest.some(q=>q.split!=='development'))throw Error('Only frozen development queries may be attached');
 if(predictions.length!==manifest.length)throw Error('Development prediction coverage mismatch');
 const byId=new Map();
 for(const prediction of predictions){
  const q=manifest.find(row=>row.query_id===prediction.query_id);
  if(!q||q.sha256!==prediction.sha256||byId.has(q.query_id))throw Error('Development prediction identity/hash mismatch');
  const top=prediction.candidates.map(x=>x.sku),retrieved=prediction.retrieval_candidates;
  if(new Set(top).size!==top.length||new Set(retrieved).size!==retrieved.length)throw Error('Duplicate SKU in development ranking');
  byId.set(q.expected_sku,{query_id:q.query_id,expected_sku:q.expected_sku,query_sha256:q.sha256,top1:top[0]===q.expected_sku,expected_rank:top.indexOf(q.expected_sku)+1||null,expected_retrieval_rank:retrieved.indexOf(q.expected_sku)+1||null});
 }
 return cases.map(item=>{
  let entries=[];
  if(item.sku_pair?.length===2){
   for(const [querySku,targetSku] of [[item.sku_pair[0],item.sku_pair[1]],[item.sku_pair[1],item.sku_pair[0]]]){
    const evidence=byId.get(querySku);if(!evidence)continue;
    const prediction=predictions.find(p=>p.query_id===evidence.query_id);
    entries.push({...evidence,target_sku:targetSku,target_rank:prediction.candidates.findIndex(x=>x.sku===targetSku)+1||null,target_retrieval_rank:prediction.retrieval_candidates.indexOf(targetSku)+1||null});
   }
  }else{
   for(const asset of item.review_assets||[]){const evidence=byId.get(asset.sku);if(evidence)entries.push(evidence);}
  }
  return {...item,development_evidence:{source:'frozen development split; exact local global ablation',scope:item.sku_pair?'pairwise candidate visibility, not a curated hard-negative label':'same-SKU query ranking only, not a front/thumb geometry verdict',queries:entries}};
 });
}
