import {describe,it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {isFreshSignature,OFFLINE_PROFILE,OFFLINE_TTL_MS,serializeSignature,deserializeSignature,saveSignature,getAllSignatures,clearAllSignatures} from '../src/moris/moris-idb.js';
const signature=()=>({skuId:'a',version:2,offlineProfile:OFFLINE_PROFILE,enrolledAt:Date.now(),aspectRatio:2,solidity:.8,holeCount:0,canonicalEmbedding:new Float32Array(768),perspectiveCentroid:new Float32Array(768),holeConstellation:[],efdCoefficients:new Float32Array(16),keyPatches:[]});
afterEach(()=>vi.unstubAllGlobals());
describe('M11 offline isolation',()=>{
 it('version/TTL survive serialization; old/expired/future entries unavailable',async()=>{
  await clearAllSignatures();const sig=signature();
  expect(isFreshSignature(deserializeSignature(serializeSignature(sig)))).toBe(true);
  for(const extra of [{offlineProfile:'legacy'},{enrolledAt:undefined},{enrolledAt:Date.now()-OFFLINE_TTL_MS},{enrolledAt:Date.now()+60000}]){
   await saveSignature({...sig,...extra});expect(await getAllSignatures()).toEqual([]);
  }
  await saveSignature(sig);expect(await getAllSignatures()).toHaveLength(1);
 });
 it.each([200,503])('server HTTP %i cannot be replaced by old local results',async status=>{
  let options;vm.runInNewContext(readFileSync('src/app.js','utf8'),{Vue:{createApp(o){options=o;return{mount(){}};}},window:{addEventListener(){}},atob,console});
  const applied=vi.fn();const ctx={...options.methods,moris:{busy:false,input:'',imageDataUrl:'data:image/png;base64,eA==',messages:[]},morisSearch:{},filters:{usage:'all',viewMode:'all'},parts:[{id:'local'}],clearMorisSearch(){this.morisSearch={};},scrollMorisToBottom(){},freshAuth:async()=> 'a.b.c',fetchWithTimeout:async()=>Response.json({ok:status===200,candidates:[]},{status}),applyMorisSearchResults:applied,clearMorisImage(){},toast:vi.fn(),$nextTick:fn=>fn(),renderIcons(){}};
  await ctx.sendMorisMessage(null,{embedding:[1],probes:[],profile:{},v2SearchResult:{top10:[{skuId:'local',finalScore:1}]}});
  if(status===200)expect(applied).toHaveBeenCalledWith(expect.objectContaining({candidates:[]}));
  else{expect(applied).not.toHaveBeenCalled();expect(ctx.moris.messages.at(-1).text).toContain('chưa thể xử lý');}
 });
 it('online query has no offline search side effect',()=>{
  const source=readFileSync('src/app.js','utf8');
  expect(source).not.toContain('searchPartTop10V2');expect(source).not.toContain('v2SearchResult');
 });
 it('worker refuses local enrollment before model/IDB without Center intent',async()=>{
  const self={postMessage:vi.fn()};vi.stubGlobal('self',self);
  await import('../src/moris/vector/dinov2.worker.js');
  for(const type of ['enroll-signature-v2','reindex-batch-v2']){
   await self.onmessage({data:{type,requestId:type}});
   expect(self.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({type:'error',error:expect.objectContaining({message:expect.stringContaining('Center confirmation')})}));
  }
 });
});
