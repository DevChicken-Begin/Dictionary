import {it,expect} from 'vitest';
import {validateMorisQuery} from '../functions/_lib/moris/v5/schemas/query.js';
import {readMorisConfig} from '../functions/_lib/moris/v5/runtime/config.js';
const config=readMorisConfig({});
it('rejects malformed JSON vector values before coercion can manufacture valid evidence',()=>{
 for(const value of [null,'0.1',true,NaN,Infinity]){
  const embedding=Array(384).fill(.1);embedding[3]=value;
  expect(()=>validateMorisQuery({query_embedding:embedding},config)).toThrow(/không hợp lệ/);
  expect(()=>validateMorisQuery({query_embeddings:[{embedding}]},config)).toThrow(/không hợp lệ/);
 }
 expect(()=>validateMorisQuery({query_embedding:Array(384).fill(0)},config)).toThrow(/zero/);
});
it('preserves valid finite vectors and source input, allows text-only query',()=>{
 const v=Array(384).fill(.1);const q=validateMorisQuery({query_embedding:v},config);
 expect(q.query_embedding).toEqual(v);expect(q.query_embedding).not.toBe(v);
 expect(validateMorisQuery({message:'part123'},config).query_embedding).toBeNull();
});
