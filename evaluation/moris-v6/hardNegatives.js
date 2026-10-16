// Curated image regressions must carry provenance; metadata mismatches are review leads, not labels.
export function validateHardNegativeCases(cases,{requireApproved=false}={}) {
  if(!Array.isArray(cases)||!cases.length)throw Error('Missing regression cases');
  const ids=new Set();
  for(const c of cases){
    if(!c.id||ids.has(c.id))throw Error('Missing/duplicate case id');ids.add(c.id);
    if(!['catalogue','camera','synthetic'].includes(c.source_kind))throw Error('Missing source kind');
    if(!['pending','approved','rejected','synthetic'].includes(c.status))throw Error('Invalid review status');
    if(!Array.isArray(c.tags)||!c.tags.length)throw Error('Missing regression tags');
    if(c.status==='approved'){
      if(!c.curator||!c.reviewed_at||!c.expected_outcome)throw Error('Missing curator/outcome');
      if(!Array.isArray(c.images)||c.images.length<2||c.images.some(i=>!i.sku||!/^[a-f0-9]{64}$/.test(i.sha256)))throw Error('Missing real image evidence');
      if(![c.before_snapshot_sha256,c.after_snapshot_sha256].every(hash=>typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)))throw Error('Missing or invalid before/after snapshot SHA-256');
    }
    if(c.status==='rejected'){
      if(!c.curator||!c.reviewed_at||!c.rejection_reason)throw Error('Missing curator/rejection_reason');
    }
    if(requireApproved&&c.status!=='approved')throw Error('Unapproved regression cannot certify release');
  }
  const res={cases:cases.length,approved:cases.filter(c=>c.status==='approved').length,pending:cases.filter(c=>c.status==='pending').length};
  const rejected=cases.filter(c=>c.status==='rejected').length;
  if(rejected)res.rejected=rejected;
  return res;
}
