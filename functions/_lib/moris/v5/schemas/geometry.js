// Nullable evidence: absence and a measured zero are different observations.
export function normalizeGeometry(input) {
  const g=input && typeof input==='object' ? input : {};
  const quality=g.quality || g.mask_quality || null;
  const reliable=quality?.reliable !== false;
  const count=v=>typeof v==='number' && Number.isInteger(v) && v>=0 && v<=128 ? v : null;
  const positive=v=>typeof v==='number' && Number.isFinite(v) && v>0 ? v : null;
  const total=count(g.hole_count),big=count(g.big_hole_count),small=count(g.small_hole_count);
  const inconsistent=total!=null && big!=null && small!=null && total!==big+small;
  const holes=reliable && !inconsistent ? total : null;
  const points=Array.isArray(g.hole_centroids) && g.hole_centroids.length<=128 &&
    g.hole_centroids.every(p=>p && typeof p.x==='number' && typeof p.y==='number' &&
      Number.isFinite(p.x) && Number.isFinite(p.y) && p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1)
    ? g.hole_centroids : null;
  return {
    ...g, geometry_version:g.geometry_version || 'legacy_unknown',
    provenance:g.provenance || 'unspecified', quality,
    hole_count:holes, big_hole_count:holes!=null?big:null, small_hole_count:holes!=null?small:null,
    hole_centroids:holes!=null && points && points.length===holes ? points : null,
    aspect_ratio:reliable ? positive(g.aspect_ratio) : null,
    solidity:reliable && typeof g.solidity==='number' && g.solidity>0 && g.solidity<=1 ? g.solidity : null,
    count_conflict:inconsistent,
    coordinate_space:g.coordinate_space || 'unknown',
    scale:g.scale || null
  };
}
