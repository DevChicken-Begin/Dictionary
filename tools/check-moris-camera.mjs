// Read-only browser inference. Results contain embeddings: keep output outside public/git data.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const output=process.argv[2];
const includeGray=process.argv.includes("--query-probes");
const includeSpatial=process.argv.includes("--spatial");
const manifestArg=process.argv.indexOf('--manifest');
const manifest=manifestArg<0?null:(await readFile(process.argv[manifestArg+1],'utf8')).trim().split('\n').map(JSON.parse);
if(manifest?.some(r=>r.split==='holdout') && !process.argv.includes('--final-holdout'))throw Error('Holdout requires explicit final evaluation flag after config freeze');
const input=resolve(process.argv[3] || resolve(root,"image 2"));
if(!output) throw new Error('Usage: node tools/check-moris-camera.mjs /tmp/moris-camera-results.json [input_dir]');
if(!existsSync(input)) throw new Error(`Input directory not found: ${input}`);
const server=createServer(async(req,res)=>{
 try {
  if(req.method!=='GET') {res.writeHead(405).end();return;}
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(path==='/') {res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Read-only Moris inference</title>');return;}
  const file=resolve(root,'.'+path);
  if(!file.startsWith(root+'/src/')&&!file.startsWith(input+'/')) {res.writeHead(404).end();return;}
  res.setHeader('Content-Type',extname(file)==='.js'?'text/javascript':'image/png');res.end(await readFile(file));
 }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
const resumeArg=process.argv.indexOf('--resume');
const resumed=resumeArg<0?null:JSON.parse(await readFile(process.argv[resumeArg+1],'utf8'));
if(resumed && resumed.input_directory!==input)throw Error('Resume source directory mismatch');
const results=resumed?.results||[];
const completed=new Map(results.map(r=>[r.query_id,r]));
try {
 browser=await chromium.launch({headless:true,args:['--disable-gpu']});
 const page=await browser.newPage({userAgent:'Moris validation Android (WASM)'});
 page.on('console',m=>{if(m.type()==='error') console.error(m.text().slice(0,300));});
 await page.route('**/*',route=>route.request().method()==='GET'?route.continue():route.abort());
 await page.goto(origin);
 await page.evaluate(async()=>{globalThis.moris=await import('/src/moris/vector/browserDinov2.js');});
 const files=manifest?manifest.map(r=>r.asset_path):(await readdir(input)).filter(f=>/\.(png|jpe?g|webp)$/i.test(f)).sort();
 for(const file of files) {
  const label=manifest?.find(r=>r.asset_path===file);
  if(label && createHash('sha256').update(await readFile(resolve(input,file))).digest('hex')!==label.sha256)throw Error('Manifest image hash mismatch');
  const existing=completed.get(label?.query_id||basename(file,extname(file)));
  if(existing){
   if(existing.sha256!==createHash('sha256').update(await readFile(resolve(input,file))).digest('hex'))throw Error('Resume image hash mismatch');
   if(existing.ok && existing.result.probes[0].profile.preprocess_version!=='kim_canon_v3_letterbox')throw Error('Resume profile mismatch');
   continue;
  }
  const started=Date.now();
  const result=await page.evaluate(async ({url,includeGray,includeSpatial})=>{
   try {return {ok:true,result:await globalThis.moris.embedImageDinov2Variants(url,{includeGray,includeSpatial})};}
   catch(e){return {ok:false,error:e.message};}
  },{url:`${origin}/${encodeURIComponent(input.slice(root.length+1))}/${encodeURIComponent(file)}`,includeGray,includeSpatial});
  const row={query_id:label?.query_id||basename(file,extname(file)),expected_sku:label?.expected_sku||basename(file,extname(file)),sha256:createHash('sha256').update(await readFile(resolve(input,file))).digest('hex'),latency_ms:Date.now()-started,...result};
  results.push(row);await writeFile(output+".tmp",JSON.stringify({created_at:new Date().toISOString(),runtime:'Chromium WASM',requested_gray_query_probe:includeGray,include_gray_query_probe:results.some(r=>r.result?.probes?.some(p=>p.view_variant==="canon_gray_v2")),input_directory:input,label_source:manifest?'explicit supplied manifest':'filename; not approved ground truth',manifest_path:manifestArg<0?null:process.argv[manifestArg+1],results}));await rename(output+".tmp",output);
  console.log(JSON.stringify({query_id:row.query_id,ok:row.ok,latency_ms:row.latency_ms,error:row.error}));
 }
}finally{await browser?.close();server.close();}
