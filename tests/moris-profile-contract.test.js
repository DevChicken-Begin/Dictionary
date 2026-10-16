import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractDinov2Tokens, computeSupabase384HybridEmbedding } from '../src/moris/moris-layer2-embedding.js';
import { encodeQueryImage } from '../functions/_lib/moris/v5/vector/encoder.js';
import { readMorisConfig } from '../functions/_lib/moris/v5/runtime/config.js';
import { MORIS_DINOV2_PROFILE, embedImageDinov2Variants, disposeDinov2 } from '../src/moris/vector/browserDinov2.js';
const config=readMorisConfig({});
afterEach(()=>{disposeDinov2();vi.unstubAllGlobals();});
describe('M06 representation contract',()=>{
 it('golden spatial tokens produce a finite unit hybrid distinct from CLS',()=>{
  const data=Float32Array.from({length:257*384},(_,i)=>Math.sin(i*.137));
  const tokens=extractDinov2Tokens({data,dims:[1,257,384]});
  const vector=computeSupabase384HybridEmbedding(tokens.patchTokens,new Float32Array(256).fill(1),new Float32Array(256).fill(.5));
  expect(Math.hypot(...vector)).toBeCloseTo(1,5);
  expect(vector.every(Number.isFinite)).toBe(true);
  expect(Array.from(vector)).not.toEqual(Array.from(tokens.clsToken));
 });
 it.each([[1,384],[384],[2,257,384],[1,384,257],[]])('rejects incompatible shape %j',(...dims)=>{
  // Vitest spreads each array; use its complete shape here.
  const data=new Float32Array(dims.reduce((a,b)=>a*b,1)).fill(.1);
  expect(()=>extractDinov2Tokens({data,dims})).toThrow();
 });
 it('rejects truncated and non-finite tensors',()=>{
  expect(()=>extractDinov2Tokens({data:new Float32Array(384),dims:[1,257,384]})).toThrow(/shape/);
  const data=new Float32Array(257*384);data[1000]=NaN;
  expect(()=>extractDinov2Tokens({data,dims:[1,257,384]})).toThrow(/non-finite/);
 });
 it('rejects legacy label with 400 before any search',async()=>{
  await expect(encodeQueryImage({},config,{suppliedEmbedding:Array(384).fill(.1),suppliedProfile:{...MORIS_DINOV2_PROFILE,profile:'cls_l2_v1'}})).rejects.toMatchObject({status:400});
 });
 it('validates real profile and rejects zero/NaN vectors',async()=>{
  const result=await encodeQueryImage({},config,{suppliedEmbedding:Array(384).fill(.1),suppliedProfile:MORIS_DINOV2_PROFILE});
  expect(Math.hypot(...result.vector)).toBeCloseTo(1);
  for(const v of [0,NaN,null])await expect(encodeQueryImage({},config,{suppliedEmbedding:Array(384).fill(v),suppliedProfile:MORIS_DINOV2_PROFILE})).rejects.toThrow();
 });
 it('requires endpoint attestation, never relabels its output',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({embedding:Array(384).fill(.1)}))));
  await expect(encodeQueryImage({},{...config,endpoints:{embedding:'https://fixture.invalid'}},{})).rejects.toMatchObject({status:502});
 });
 it('propagates worker failure without a second CLS request',async()=>{
  const messages=[];
  vi.stubGlobal('Worker',class {postMessage(m){messages.push(m);queueMicrotask(()=>this.onmessage({data:{type:'error',requestId:m.requestId,error:{message:'spatial tokens required'}}}));}terminate(){}});
  await expect(embedImageDinov2Variants('fixture')).rejects.toThrow(/spatial tokens/);
  expect(messages.map(m=>m.type)).toEqual(['embed-variants-v2']);
 });
});
