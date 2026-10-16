import {describe,it,expect} from 'vitest';
import {makePatchSignature,comparePatches} from '../src/moris/geometry/patchVerifier.js';
import {comparePatches as serverCompare} from '../functions/_lib/moris/v5/retrieval/patchVerifier.js';
const tokens=()=>({isSpatial:true,patchTokens:Float32Array.from({length:256*384},(_,i)=>i%384===Math.floor(i/384)%384?1:0)});
const mask=new Float32Array(256).fill(1),edge=Float32Array.from({length:256},(_,i)=>(i+1)/256);
const signature=()=>makePatchSignature(tokens(),mask,edge,true);
describe('bounded spatial verifier',()=>{
 it('is opt in, rejects pooled output and malformed shapes',()=>{
  expect(makePatchSignature(tokens(),mask,edge)).toBeNull();
  expect(makePatchSignature({...tokens(),isSpatial:false},mask,edge,true)).toBeNull();
  expect(makePatchSignature(tokens(),mask.slice(1),edge,true)).toBeNull();
 });
 it('selects actual highest edge patches, at most 32 with bounded payload',()=>{
  const s=signature();expect(s.patches).toHaveLength(32);expect(s.patches[0].vec[255]).toBe(1);
  expect(s.patches.at(-1).vec[224]).toBe(1);expect(s.patches.length*384*4).toBe(49152);
  expect(makePatchSignature(tokens(),mask,new Float32Array(256),true)).toBeNull();
 });
 it('matches identical spatial detail above contrasting descriptors on both runtimes',()=>{
  const q={patch_signature:signature()},bad=structuredClone(q);
  bad.patch_signature.patches.forEach(p=>p.vec=p.vec.map(x=>-x));
  expect(comparePatches(q,q).similarity).toBe(1);
  expect(comparePatches(q,bad).similarity).toBeLessThan(comparePatches(q,q).similarity);
  expect(serverCompare(q,bad)).toEqual(comparePatches(q,bad));
 });
 it('falls back neutrally for missing spatial evidence, bad masks and oversized payload',()=>{
  const q={patch_signature:signature()};expect(comparePatches(q,{}).available).toBe(false);
  expect(comparePatches({...q,quality:{reliable:false}},q).available).toBe(false);
  const bad=structuredClone(q);bad.patch_signature.patches.push(bad.patch_signature.patches[0]);
  expect(comparePatches(q,bad).similarity).toBeNull();
 });
 it('rejects invalid norms and preserves handedness',()=>{
  const q={patch_signature:signature()},bad=structuredClone(q);bad.patch_signature.patches[0].vec[0]=NaN;
  expect(comparePatches(q,bad).available).toBe(false);
  expect(comparePatches({...q,usage_side:'left'},{...q,usage_side:'right'}).available).toBe(false);
 });
});
