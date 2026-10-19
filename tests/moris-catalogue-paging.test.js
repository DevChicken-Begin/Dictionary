import {describe,it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {scanCatalogue} from '../functions/_lib/moris/v5/connectors/supabase.js';
function app(n){
 let options;
 vm.runInNewContext(readFileSync('src/app.js','utf8'),{Vue:{createApp(o){options=o;return{mount(){}};}},window:{addEventListener(){}},atob,console});
 const rows=Array.from({length:n},(_,i)=>({id:String(i),code:i===n-1?'LAST-CODE':`code-${i}`,part_id:i===n-1?'LAST-ID':String(i),identifying_features:i===n-1?'17 lỗ tròn':'2 lỗ tròn',updated_at:'same timestamp'}));
 const ctx={...options.methods,session:{token:'a.b.c'},filters:{target:'part_id',search:'LAST-ID',usage:'all',viewMode:'all'},page:0,catalogueRequestSeq:0,parts:[],toast:vi.fn(),readError:e=>e.message,renderIcons:vi.fn(),rpcRows:vi.fn(async(_,args)=>{expect(args.p_limit).toBeLessThanOrEqual(300);return rows.slice(args.p_offset,args.p_offset+args.p_limit);})};
 return {ctx,rows};
}
afterEach(()=>vi.unstubAllGlobals());
describe('M10 bounded complete catalogue scan',()=>{
 it.each([301,545,1000])('finds last-page ID/code/features among %i tied timestamps',async n=>{
  for(const [target,search] of [['part_id','LAST-ID'],['code','last-code'],['all','17 lỗ tròn']]){
   const {ctx}=app(n);ctx.filters.target=target;ctx.filters.search=search;
   await ctx.loadParts();expect(ctx.toast).not.toHaveBeenCalled();expect(ctx.parts.map(x=>x.id)).toEqual([String(n-1)]);
   expect(ctx.rpcRows).toHaveBeenCalledTimes(Math.ceil(n/300));
  }
 });
 it('normal paging remains one bounded RPC',async()=>{
  const {ctx}=app(545);ctx.filters={target:'all',search:'',usage:'all',viewMode:'all'};
  await ctx.loadParts();expect(ctx.rpcRows).toHaveBeenCalledTimes(1);expect(ctx.parts).toHaveLength(36);
 });
 it('stale request stops scanning and never replaces current results',async()=>{
  const {ctx}=app(545);ctx.rpcRows=vi.fn(async()=>{ctx.catalogueRequestSeq++;return [];});ctx.parts=[{id:'current'}];
  await ctx.loadParts();expect(ctx.parts).toEqual([{id:'current'}]);
 });
 it('duplicate/stuck pages error instead of pretending complete results',async()=>{
  const {ctx,rows}=app(545);ctx.rpcRows=vi.fn(async()=>rows.slice(0,300));
  await ctx.loadParts();expect(ctx.toast).toHaveBeenCalledWith('error',expect.stringContaining('không tiến triển'));
 });
 it.each([545,1000])('server reads all %i rows and propagates filters',async n=>{
  const {rows}=app(n);
  vi.stubGlobal('fetch',vi.fn(async(_,o)=>{const a=JSON.parse(o.body);expect(a.p_limit).toBeLessThanOrEqual(300);expect(a.p_usage_side).toBe('left');return Response.json(rows.slice(a.p_offset,a.p_offset+a.p_limit));}));
  expect(await scanCatalogue({SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'x'},'a.b.c',{maxRows:1000,usageSide:'left'})).toHaveLength(n);
 });
 it('server budget overflow is explicit',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(_,o)=>{const a=JSON.parse(o.body);return Response.json(Array.from({length:a.p_limit},(_,i)=>({id:a.p_offset+i})));}));
  await expect(scanCatalogue({SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'x'},'a.b.c',{maxRows:300})).rejects.toThrow(/budget/);
 });
});

describe('Item 7 — nhảy nhanh số trang (jumpToPage)',()=>{
 const ctxAll=()=>{const {ctx,rows}=app(545);ctx.filters={target:'all',search:'',usage:'all',viewMode:'all'};ctx.morisSearch={active:false};return {ctx,rows};};

 it('nhập số trang → đặt page = số-1, render đúng cửa sổ 36 mã, xoá ô nhập',async()=>{
  const {ctx,rows}=ctxAll();
  await ctx.loadParts();
  ctx.rpcRows.mockClear();
  ctx.pageJump='12';
  await ctx.jumpToPage();
  expect(ctx.page).toBe(11);
  expect(ctx.pageJump).toBe('');
  expect(ctx.parts.map(x=>x.id)).toEqual(rows.slice(11*36,12*36).map(r=>r.id));
  expect(ctx.rpcRows).toHaveBeenCalledTimes(1);
 });

 it('số trang không hợp lệ (chữ, 0, âm, rỗng, thập phân ngoài khoảng) → cảnh báo, giữ nguyên trang',async()=>{
  const {ctx}=ctxAll();
  await ctx.loadParts();
  ctx.rpcRows.mockClear();
  for(const bad of ['abc','0','-3','','2.9x']){
   ctx.pageJump=bad;
   await ctx.jumpToPage();
   expect(ctx.page).toBe(0);
   expect(ctx.toast).toHaveBeenCalledWith('info',expect.stringContaining('hợp lệ'));
   ctx.toast.mockClear();
  }
  expect(ctx.rpcRows).not.toHaveBeenCalled();
 });

 it('nhập đúng trang hiện tại → không gọi lại dữ liệu',async()=>{
  const {ctx}=ctxAll();
  await ctx.loadParts();
  ctx.rpcRows.mockClear();
  ctx.pageJump='1';
  await ctx.jumpToPage();
  expect(ctx.page).toBe(0);
  expect(ctx.rpcRows).not.toHaveBeenCalled();
 });
});
