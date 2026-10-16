import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {assessImageResult} from '../functions/_lib/moris/v5/presentation/imageDecision.js';
import {toPublicMorisResult} from '../functions/_lib/moris/v5/presentation/publicResult.js';
const candidates=[{id:'a',code:'A',final_score:.8},{id:'b',code:'B',final_score:.79}];
describe('evidence-based operator guidance',()=>{
 it('empty/unknown results do not claim a match',()=>{
  expect(assessImageResult([])).toMatchObject({accepted:false,status:'no_match',calibrated:false});
 });
 it('near scores, unreliable mask OR uncertain orientation require review',()=>{
  for(const options of [{},{quality:{reliable:false}},{orientationAmbiguous:true}])expect(assessImageResult(candidates,options)).toMatchObject({accepted:false,status:'needs_review'});
  expect(assessImageResult([candidates[0]],{orientationAmbiguous:true}).reasons).toContain('orientation_uncertain');
  expect(assessImageResult([candidates[0]])).toMatchObject({accepted:null,calibrated:false});
 });
 it('public image message explains ranking and retake without fabricated probability',()=>{
  const decision=assessImageResult(candidates,{quality:{reliable:false}});
  const out=toPublicMorisResult({mode:'MORIS_VECTOR_AMBIGUOUS',candidates,decision});
  expect(out.user_message).toContain('không phải xác suất đúng');expect(out.user_message).toContain('chụp lại');expect(out.candidates[0].id).toBe('a');
 });
 it('Vue honors zero final score over a high vector score and describes evidence',()=>{
  let options;vm.runInNewContext(readFileSync('src/app.js','utf8'),{Vue:{createApp(o){options=o;return{mount(){}};}},window:{addEventListener(){}},atob,console});
  const m=options.methods;expect(m.morisCandidatePercent({final_score:0,vector_similarity:.99})).toBe(0);
  expect(m.morisCandidatePercent({final_score:NaN})).toBeNull();expect(m.morisCandidatePercent({is_feature_match:true,final_score:1})).toBeNull();
  expect(m.morisCandidateEvidence({query_quality:{reliable:false},best_view_evidence:{asset_type:'back'}})).toContain('mặt sau');
 });
});
