import { minimumAssignment } from './holeMatcher.js';
import { orientationPolicy, transformPoint } from './orientationPolicy.js';
export const PATCH_VERSION = 'spatial32_384_v1';
// Temporary descriptors only; no persistence or inference is performed here.
export function makePatchSignature(tokens, mask, edge, enabled = false) {
  if (!enabled || tokens?.isSpatial !== true || tokens.patchTokens?.length !== 256 * 384 ||
      mask?.length !== 256 || edge?.length !== 256) return null;
  if (![...mask, ...edge].every(Number.isFinite) || !tokens.patchTokens.every(Number.isFinite)) return null;
  const indices = Array.from({ length:256 }, (_, i) => i)
    .filter(i => mask[i] >= .15 && edge[i] > .05)
    .sort((a,b) => mask[b]*edge[b]-mask[a]*edge[a] || a-b).slice(0,32);
  const patches = indices.map(i => {
    const v = Array.from(tokens.patchTokens.slice(i*384,(i+1)*384));
    const norm = Math.hypot(...v);
    return norm > 1e-8 ? { x:(i%16+.5)/16, y:(Math.floor(i/16)+.5)/16, vec:v.map(x=>x/norm) } : null;
  }).filter(Boolean);
  return patches.length >= 2 ? { version:PATCH_VERSION, patches } : null;
}
function valid(s) {
  return s?.version === PATCH_VERSION && Array.isArray(s.patches) && s.patches.length >= 2 && s.patches.length <= 32 &&
    s.patches.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1 &&
      Array.isArray(p.vec) && p.vec.length===384 && p.vec.every(Number.isFinite) && Math.abs(Math.hypot(...p.vec)-1)<.001);
}
export function comparePatches(query, candidate) {
  const a=query?.patch_signature,b=candidate?.patch_signature,policy=orientationPolicy(query,candidate);
  const none={available:false,similarity:null,reliability:0,version:PATCH_VERSION};
  if(!valid(a)||!valid(b)||!policy.compatible||query.quality?.reliable===false||candidate.quality?.reliable===false)return none;
  const n=Math.max(a.patches.length,b.patches.length);
  let best=Infinity,transform='identity';
  for(const t of policy.transforms){
    const points=a.patches.map(p=>transformPoint(p,t));
    const costs=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>{
      if(i>=points.length||j>=b.patches.length)return .75;
      const p=points[i],q=b.patches[j];
      const cosine=p.vec.reduce((s,v,k)=>s+v*q.vec[k],0);
      return .8*(1-Math.max(-1,Math.min(1,cosine)))/2+.2*Math.hypot(p.x-q.x,p.y-q.y)/Math.SQRT2;
    }));
    const cost=minimumAssignment(costs).cost/n;
    if(cost<best){best=cost;transform=t;}
  }
  return {available:true,similarity:1-best,reliability:1,transform,version:PATCH_VERSION};
}
