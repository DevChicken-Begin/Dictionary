import {describe,it,expect} from 'vitest';
import { classifyAsset, summarizeAssets } from '../functions/_lib/moris/v5/vector/assetStatus.js';
const profile={model:'test',modelVersion:'1',preprocessVersion:'1',profile:'cls'};
const asset={asset_type:'front',image_path:'a.webp'};
const vector={asset_type:'front',object_key:'a.webp',is_active:true,view_variant:'canon_rgb_v2',embedding_model:'test',embedding_model_version:'1',preprocess_version:'1',embedding_profile:'cls',source_etag:'"v1"'};
const options={etag:'"v1"',currentKeys:['a.webp']};
describe('M05 asset freshness',()=>{
 it('missing index is missing',()=>expect(classifyAsset(asset,[],profile,options).vector_status).toBe('missing'));
 it('matching profile and measured ETag is ready',()=>expect(classifyAsset(asset,[vector],profile,options).vector_status).toBe('ready'));
 it.each([{source_etag:null},{source_etag:'"old"'},{embedding_profile:'other'},{view_variant:'canon_gray_v2'},{object_key:'old.webp'}])('stale evidence %j',change=>expect(classifyAsset(asset,[{...vector,...change}],profile,options).vector_status).toBe('stale'));
 it('same key content change is stale regardless of metadata date',()=>expect(classifyAsset(asset,[vector],profile,{...options,etag:'"v2"'}).vector_reason).toBe('source_changed'));
 it('unknown source version never becomes ready',()=>expect(classifyAsset(asset,[vector],profile,{}).vector_status).toBe('failed'));
 it('read failure never pretends missing',()=>expect(classifyAsset(asset,[],profile,{...options,failed:true}).vector_status).toBe('failed'));
 it('sibling current detail is not stale evidence for a new detail',()=>expect(classifyAsset({...asset,asset_type:'detail'},[{...vector,asset_type:'detail',object_key:'b.webp'}],profile,{...options,currentKeys:['a.webp','b.webp']}).vector_status).toBe('missing'));
 it('one ready view cannot mark an incomplete SKU ready',()=>expect(summarizeAssets([{vector_status:'ready'},{vector_status:'missing'}])).toBe('partial'));
 it('failed reads are surfaced on the SKU',()=>expect(summarizeAssets([{vector_status:'ready'},{vector_status:'failed'}])).toBe('failed'));
});
