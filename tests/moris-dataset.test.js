import {describe,it,expect} from 'vitest';
import {validateManifest,manifestHash} from '../evaluation/moris-v6/manifest.js';
const row=(extra={})=>({query_id:'q',expected_sku:'A',known:true,asset_path:'a.png',sha256:'a'.repeat(64),source_kind:'camera',source_group:'session-a',physical_shot_id:'shot-a',split:'development',label_status:'filename_pending',view:'unknown',lighting:'unknown',angle:'unknown',...extra});
describe('M19 dataset integrity',()=>{
 it('reports provisional captures honestly',()=>expect(validateManifest([row()])).toMatchObject({rows:1,camera:1,approved:0,provisional:1,holdout:0}));
 it.each(['query_id','sha256','source_group','physical_shot_id','view','lighting','angle'])('rejects missing %s',key=>{const r=row();delete r[key];expect(()=>validateManifest([r])).toThrow();});
 it('rejects duplicates and cross-split physical/source leakage',()=>{
  expect(()=>validateManifest([row(),row({query_id:'q2'})])).toThrow(/hash/);
  for(const fields of [{source_group:'session-a',physical_shot_id:'shot-b'},{source_group:'session-b',physical_shot_id:'shot-a'}]){
   expect(()=>validateManifest([row(),row({query_id:'q2',sha256:'b'.repeat(64),split:'holdout',label_status:'approved',curator:'fixture',labelled_at:'2026-10-16',...fields})])).toThrow(/leaks/);
  }
 });
 it('requires approved holdout labels and independent unknown labels',()=>{
  expect(()=>validateManifest([row({split:'holdout'})])).toThrow(/Unapproved/);
  expect(()=>validateManifest([row()],{requireApproved:true})).toThrow(/Unapproved/);
  expect(()=>validateManifest([row({known:false})])).toThrow(/expected_sku/);
  expect(validateManifest([row({known:false,expected_sku:null})]).rows).toBe(1);
 });
 it.each(['/private/a.png','../a.png','https://host/x?token=x','a\\b.png'])('rejects unsafe path %s',asset_path=>expect(()=>validateManifest([row({asset_path})])).toThrow());
 it('hash is stable over object/row ordering and changes with labels',()=>{
  const a=row(),b=row({query_id:'q2',sha256:'b'.repeat(64)});
  expect(manifestHash([a,b])).toBe(manifestHash([Object.fromEntries(Object.entries(b).reverse()),a]));
  expect(manifestHash([a])).not.toBe(manifestHash([row({expected_sku:'B'})]));
 });
});
