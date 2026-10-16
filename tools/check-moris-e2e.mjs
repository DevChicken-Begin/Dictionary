// Isolated browser/API/Postgres integration; auth, model and R2 are explicit fixtures.
// Never point this harness at production. It uses only Docker container moris-v6-test.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { onRequestPost as upsert } from '../functions/api/moris/vector-upsert.js';
import { onRequestGet as items } from '../functions/api/moris/vector-items.js';
const root=resolve(import.meta.dirname,'..');
const id='00000000-0000-0000-0000-000000000003';
const sql=q=>execFileSync('docker',['exec','-i','moris-v6-test','psql','-U','postgres','-At','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8'}).trim();
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
sql(`DELETE FROM catalogue_image_vectors WHERE record_id='${id}'; DELETE FROM image_assets WHERE image_id='${id}'; INSERT INTO image_assets(image_id,asset_type,image_path) VALUES ('${id}','front','front.png'),('${id}','thumb','thumb.png');`);
const assetList=[{asset_type:'front',image_path:'front.png'},{asset_type:'thumb',image_path:'thumb.png'}];
const row={id,code:'TEST-E2E',part_id:'TEST',usage_side:'left',view_mode:'single_face',thumb_path:'thumb.png',assets:assetList};
const events=[];let sourceVersion='"v1"', failThumb=false, origin,env;
const count=()=>Number(sql(`SELECT count(*) FROM catalogue_image_vectors WHERE record_id='${id}';`));
const active=()=>Number(sql(`SELECT count(*) FROM catalogue_image_vectors WHERE record_id='${id}' AND is_active;`));
const server=createServer(async(req,res)=>{
 try {
  let body='';for await(const chunk of req) body+=chunk;
  const url=new URL(req.url,origin);const path=url.pathname;let data;
  if(path.startsWith('/api/moris/vector-')) {
   if(req.method==='POST') events.push(path);
   const request=new Request(url,{method:req.method,headers:req.headers,...(body?{body}:{})});
   const response=path.endsWith('vector-upsert')?await upsert({request,env}):await items({request,env});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
  }
  if(path.startsWith('/rest/v1/rpc/')) {
   const fn=path.split('/').pop();const args=body?JSON.parse(body):{};
   if(fn==='app_me') data={ok:true,role_name:'admin',id:'test-user',username:'test'};
   else if(fn==='app_list_catalogue_vector_items') data={items:[row]};
   else if(fn==='app_search_catalogue') data=[row];
   else if(fn==='app_get_part_assets') data=assetList;
   else if(fn==='app_upsert_part_metadata'||fn==='app_replace_part_assets') {events.push(fn);data={ok:true,id};}
   else if(fn==='kim_write_catalogue_vector_v6_provenance') {
    if(failThumb && args.p_vector.p_asset_type==='thumb') {res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({message:'fixture thumb failure'}));return;}
    data=JSON.parse(sql(`SELECT kim_write_catalogue_vector_v6_provenance(${quote(JSON.stringify(args.p_vector))}::jsonb,${quote(args.p_mode)});`));
   } else throw new Error(`Unsupported fixture RPC ${fn}`);
  } else if(path==='/rest/v1/catalogue_image_vectors') {
   data=JSON.parse(sql(`SELECT coalesce(json_agg(v),'[]') FROM (SELECT record_id,asset_type,object_key,view_variant,embedding_model,embedding_model_version,preprocess_version,embedding_profile,is_active,source_etag FROM catalogue_image_vectors WHERE record_id='${id}' AND is_active ORDER BY id) v;`));
  } else if(path==='/api/moris/reindex-status') data={status:{distinct_records:count()?1:0,active_vectors:active()}};
  else if(path.startsWith('/api/media/')) {res.writeHead(200,{'Content-Type':'image/png',etag:sourceVersion});res.end(await readFile(resolve(root,'assets/icon-book.png')));return;}
  if(data!==undefined) {res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(data));return;}
  const file=resolve(root,'.'+(path==='/'?'/index.html':path==='/tools/moris-vector-center'?'/tools/moris-vector-center.html':path));
  if(!['/src/','/tools/','/assets/'].some(p=>path.startsWith(p)) && !['/','/index.html','/config.js','/manifest.webmanifest','/version.json','/sw.js'].includes(path)) {res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.png':'image/png','.json':'application/json'})[extname(file)]||'text/plain');
  res.end(path==='/config.js'?'':await readFile(file));
 } catch(e) {console.error('Fixture server:',e.message);res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({message:e.message}));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
env={SUPABASE_URL:origin,SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture',CATALOGUE_BUCKET:{head:async()=>({httpEtag:sourceVersion})}};
let browser;const checks=[];
try {
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({serviceWorkers:"block"});
 page.on("pageerror",e=>console.error("PAGE ERROR",e.message));
 const vue=await readFile('/tmp/moris-phase-a/vue.global.prod.js','utf8');
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url.includes('vue.global.prod.js')) return route.fulfill({contentType:'text/javascript',body:vue});
  if(url.includes('supabase-js')) return route.fulfill({contentType:'text/javascript',body:`window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'a.b.c'}}})},rpc:async(fn,args)=>{const r=await fetch('/rest/v1/rpc/'+fn,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});return {data:await r.json(),error:null};}})};`});
  if(url.includes('tailwindcss')) return route.fulfill({contentType:'text/javascript',body:'window.tailwind={config:{}};'});
  if(url.includes('lucide')) return route.fulfill({contentType:'text/javascript',body:'window.lucide={createIcons(){}};'});
  if(!url.startsWith(origin)) return route.abort();
  if(url.endsWith('/src/moris/vector/browserDinov2.js')) return route.fulfill({contentType:'text/javascript',body:`export const onDinov2Progress=()=>()=>{};export const initDinov2=async()=>({runtime:{device:'fixture'}});export const embedImageDinov2=async()=>{};export async function embedImageDinov2Variants(){await new Promise(r=>setTimeout(r,window.__embeddingDelay||0));window.__modelCalls=(window.__modelCalls||0)+1;return {geometry:{geometry_version:'geometry_v1',quality:{reliable:true},hole_count:0,aspect_ratio:2},probes:[{view_variant:'canon_rgb_v2',embedding:Array(384).fill(.1),profile:{model:'onnx-community/dinov2-small',model_version:'ef1fb10',preprocess_version:'kim_canon_v3_letterbox',profile:'hybrid_gem3_edge_55_45_pseudorgb_u8_v1',dimension:384}}]};}`});
  return route.continue();
 });
 await page.addInitScript(()=>{localStorage.setItem('catalogue_access_token','a.b.c');window.MORIS_PUBLIC_CONFIG={PUBLIC_SUPABASE_URL:location.origin,PUBLIC_SUPABASE_ANON_KEY:'fixture',PUBLIC_R2_MEDIA_BASE_URL:'/api/media'};});
 page.on('pageerror',e=>console.error('Browser exception:',e.message));
 const center=async()=>{await page.goto(origin+'/tools/moris-vector-center.html');await page.addStyleTag({content:'.hidden{display:none!important}'});await expect(page.locator('.btn-vectorize-item')).toHaveCount(1);};
 await center();await page.locator('#btnPreviewBatch').click();await expect(page.locator('#batchPreview')).toContainText('2 ảnh RGB');expect(count()).toBe(0);expect(events).toEqual([]);expect(await page.evaluate(()=>window.__modelCalls||0)).toBe(0);checks.push('mount: zero writes/model');
 await page.locator('#btnBatchVectorize').click();await expect(page.locator('#confirmMessage')).toContainText('1 mã, 2 ảnh');expect(count()).toBe(0);await page.locator('#btnConfirmCancel').click();expect(count()).toBe(0);checks.push('batch preview/cancel: zero writes');
 failThumb=true;
 await page.locator('.btn-vectorize-item').click();await page.locator('#btnConfirmOk').click();await expect(page.locator('#itemsTableBody')).toContainText('Chưa đủ ảnh');expect(count()).toBe(1);checks.push('partial SQL failure: one row, SKU partial');
 failThumb=false;
 await page.locator('.btn-vectorize-item').click();await page.locator('#btnConfirmOk').click();await expect(page.locator('#itemsTableBody tr td:nth-child(4) > span')).toHaveText('Sẵn sàng');expect(count()).toBe(2);checks.push('retry missing view: exactly two rows');
 await page.locator('#vectorWriteMode').selectOption('replace');
 await page.locator('.btn-vectorize-item').click();await page.locator('#btnConfirmOk').click();await expect.poll(()=>events.filter(e=>e==='/api/moris/vector-upsert').length).toBe(6);await expect(page.locator('#itemsTableBody tr td:nth-child(4) > span')).toHaveText('Sẵn sàng');expect(count()).toBe(2);checks.push('explicit rebuild: zero row growth');
 sourceVersion='"v2"';await page.locator('#btnRefreshItems').click();await expect(page.locator('#itemsTableBody')).toContainText('Cần cập nhật');expect(count()).toBe(2);checks.push('same-key changed ETag: stale without writes');
 await page.locator('#vectorWriteMode').selectOption('stale');
 await page.evaluate(()=>window.__embeddingDelay=250);
 await page.locator('#btnBatchVectorize').click();await page.locator('#btnConfirmOk').click();
 await page.locator('#btnPauseBatch').click();await expect(page.locator('#btnPauseBatch')).toHaveText('Tiếp tục');
 await expect(page.locator('#batchProgressLabel')).toHaveText('1/2 ảnh');
 await page.waitForTimeout(300);expect(events.filter(e=>e==='/api/moris/vector-upsert').length).toBe(7);
 await page.locator('#btnPauseBatch').click();
 await expect(page.locator('#itemsTableBody tr td:nth-child(4) > span')).toHaveText('Sẵn sàng');expect(count()).toBe(2);
 expect(events.filter(e=>e==='/api/moris/vector-upsert').length).toBe(8);
 await page.evaluate(()=>window.__embeddingDelay=0);
 checks.push('stale-only batch pause/resume: no replay, same row count');
 // Real Vue Editor methods and DOM, fixture auth/catalogue transport only.
 await page.goto(origin+'/');await page.waitForFunction(()=>window._catalogueApp?.session?.user);
 const writes=events.filter(e=>e==='/api/moris/vector-upsert').length;
 await page.evaluate(async row=>{await window._catalogueApp.openEditor(row);},row);
 await expect(page.getByRole('button',{name:'Tạo vector',exact:true})).toHaveCount(0);
 await expect(page.getByText('Lưu ảnh xong, mở Trung tâm Vector AI để tạo/cập nhật vector thủ công')).toBeVisible();
 await page.getByRole('button',{name:'Lưu vào Hệ Thống'}).click();
 await expect.poll(()=>events.filter(e=>e==='app_replace_part_assets').length).toBe(1);
 expect(events.filter(e=>e==='/api/moris/vector-upsert').length).toBe(writes);expect(count()).toBe(2);expect(await page.evaluate(()=>window.__modelCalls||0)).toBe(0);checks.push('Vue Editor save: metadata/assets only, zero model/index calls');
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:844});
  await page.evaluate(row=>{const app=window._catalogueApp;app.closeDetail();app.editor.open=false;app.moris.open=true;app.moris.messages=[{role:'assistant',text:'Điểm so khớp không phải xác suất đúng.',candidates:[{...row,final_score:0,vector_similarity:.99,query_quality:{reliable:false},best_view_evidence:{asset_type:'back'}}]}];},row);
  await expect(page.locator('.moris-candidate')).toContainText('Điểm 0/100');
  await expect(page.locator('.moris-candidate')).toContainText('mặt sau');
  await expect(page.locator('.moris-candidate')).toContainText('cần chụp lại');
  await page.locator('.moris-candidate').click();
  await page.waitForFunction(id=>window._catalogueApp.detail.open && window._catalogueApp.detail.item.id===id && !window._catalogueApp.moris.open,id);
  checks.push(`Moris ${width}px: ranking score/evidence and correct detail click`);
 }
 await page.setViewportSize({width:390,height:844});await center();
 expect(events.filter(e=>e==='/api/moris/vector-upsert').length).toBe(writes);expect(count()).toBe(2);
 await expect(page.locator('.btn-vectorize-asset')).toHaveCount(2);checks.push('mobile Center exposes per-asset actions without mount writes');
 sourceVersion='"v3"';await page.locator('#btnRefreshItems').click();
 await expect(page.locator('#itemsTableBody tr td:nth-child(4) > span')).toHaveText('Cần cập nhật');
 await page.locator('#vectorWriteMode').selectOption('replace');
 await page.locator('.btn-vectorize-asset[data-type="front"]').click();
 await expect(page.locator('#confirmMessage')).toContainText('1 ảnh RGB');await page.locator('#btnConfirmOk').click();
 await expect(page.locator('#itemsTableBody tr td:nth-child(4) > span')).toHaveText('Chưa đủ ảnh');
 expect(count()).toBe(2);
 expect(sql(`SELECT source_etag FROM catalogue_image_vectors WHERE record_id='${id}' AND asset_type='front';`)).toBe('"v3"');
 expect(sql(`SELECT source_etag FROM catalogue_image_vectors WHERE record_id='${id}' AND asset_type='thumb';`)).toBe('"v2"');
 checks.push('per-asset click updates only selected front, leaves thumb stale and row count unchanged');
 const report={passed:checks.length,checks,scope:'Local Chromium + real API handlers + real pgvector RPC. Auth/R2/model are fixtures; not staging authentication or camera accuracy.',production_writes:0,local_vector_rows:count()};
 await writeFile(resolve(root,'docs/moris-v6/evidence/phase-a-e2e.json'),JSON.stringify(report,null,2)+'\n');console.log(report);
}catch(error){console.error('E2E failure:',error.message);for(const p of browser?.contexts().flatMap(c=>c.pages())||[])console.error('Toasts:',await p.locator('#toastContainer').textContent().catch(()=>''));throw error;}finally{await browser?.close();server.close();}
