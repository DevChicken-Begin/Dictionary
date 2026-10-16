import {describe,it,expect} from 'vitest';
import {orientationPolicy,transformPoint} from '../src/moris/geometry/orientationPolicy.js';
import {computeHoleSimilarity} from '../functions/_lib/moris/v5/retrieval/geometricReranker.js';
import {computeOrientationPCA} from '../src/moris/geometry/pcaAligner.js';
const points=[{x:.15,y:.2},{x:.35,y:.65},{x:.8,y:.35}];
describe('M13 chirality policy',()=>{
 it('default permits rotation, never reflection',()=>expect(orientationPolicy().transforms).toEqual(['identity','rotate180']));
 it('180 degrees preserves the same part',()=>{
  expect(computeHoleSimilarity({hole_count:3,hole_centroids:points},{hole_count:3,hole_centroids:points.map(p=>transformPoint(p,'rotate180'))})).toBeCloseTo(1);
 });
 it('asymmetric mirrored layouts are not geometrically identical by default',()=>{
  const mirrored=points.map(p=>transformPoint(p,'mirrorX'));
  expect(computeHoleSimilarity({hole_count:3,hole_centroids:points},{hole_count:3,hole_centroids:mirrored})).toBeLessThan(1);
  expect(orientationPolicy({usage_side:'left'},{usage_side:'right',is_symmetric:true,symmetry_verified:true}).compatible).toBe(false);
 });
 it('front/back reflection requires explicit same side and dual-face view evidence',()=>{
  const q={view:'front',view_mode:'dual_face',usage_side:'left'};
  expect(orientationPolicy(q,{view:'back',view_mode:'dual_face',usage_side:'left'}).allow_mirror).toBe(true);
  expect(orientationPolicy(q,{view:'back',view_mode:'dual_face',usage_side:'unknown'}).allow_mirror).toBe(false);
 });
 it('does not treat unaudited symmetry flags as ground truth',()=>{
  expect(orientationPolicy({},{is_symmetric:true}).allow_mirror).toBe(false);
  expect(orientationPolicy({},{is_symmetric:false}).allow_mirror).toBe(false);
  expect(orientationPolicy({},{is_symmetric:true,symmetry_verified:true}).allow_mirror).toBe(true);
 });
 it('PCA handles binary 0/1 and 0/255 masks identically, without mirror',()=>{
  const mask=new Uint8Array(64*64);for(let y=25;y<35;y++)for(let x=8;x<56;x++)mask[y*64+x]=1;
  expect(computeOrientationPCA(mask,64,64)).toEqual(computeOrientationPCA(mask.map(v=>v*255),64,64));
  expect(computeOrientationPCA(mask,64,64).valid).toBe(true);
 });
});
