import {describe,it,expect} from 'vitest';
import {makeContourSignature,compareContour} from '../src/moris/geometry/contourVerifier.js';
import {computeEllipticFourierDescriptors} from '../src/moris/moris-layer3-rerank.js';
import {fuseCandidateScore} from '../functions/_lib/moris/v5/retrieval/scoreFusion.js';
import {readMorisConfig} from '../functions/_lib/moris/v5/runtime/config.js';
const l=[{x:0,y:0},{x:1,y:0},{x:1,y:.2},{x:.25,y:.2},{x:.25,y:.7},{x:0,y:.7}];
const u=[{x:0,y:0},{x:1,y:0},{x:1,y:.7},{x:.75,y:.7},{x:.75,y:.2},{x:.25,y:.2},{x:.25,y:.7},{x:0,y:.7}];
const sig=p=>makeContourSignature(p,computeEllipticFourierDescriptors(p),{reliable:true});
describe('M15 bounded contour evidence (experimental OFF)',()=>{
 it('matches uniform scale/translation/rotation without reflection',()=>{
  const angle=.7,c=Math.cos(angle),s=Math.sin(angle);
  const transformed=l.map(p=>({x:3+2*(p.x*c-p.y*s),y:8+2*(p.x*s+p.y*c)}));
  expect(compareContour({contour_signature:sig(l)},{contour_signature:sig(transformed)}).similarity).toBeCloseTo(1,5);
 });
 it('distinguishes L/U and a small notch in same outline',()=>{
  const notch=[...l.slice(0,2),{x:1,y:.05},{x:.9,y:.05},{x:.9,y:.15},{x:1,y:.15},...l.slice(2)];
  const a={contour_signature:sig(l)};
  expect(compareContour(a,{contour_signature:sig(u)}).similarity).toBeLessThan(.95);
  expect(compareContour(a,{contour_signature:sig(notch)}).similarity).toBeLessThan(1);
 });
 it('rejects unreliable, degenerate and oversized outlines',()=>{
  expect(makeContourSignature(l,Array(16).fill(1),{reliable:false})).toBeNull();
  expect(makeContourSignature(Array(4097).fill({x:0,y:0}),[],{reliable:true})).toBeNull();
  expect(compareContour({contour_signature:sig(l),quality:{reliable:false}},{contour_signature:sig(l)}).available).toBe(false);
  expect(compareContour({},{}).available).toBe(false);
 });
 it('chirality remains distinct and cloud storage is not enabled',()=>{
  const a={contour_signature:sig(l),usage_side:'left'},b={contour_signature:sig(l.map(p=>({x:1-p.x,y:p.y}))),usage_side:'right'};
  expect(compareContour(a,b).available).toBe(false);
  expect(readMorisConfig({}).features.contourVerification).toBe(false);
  expect(sig(l).points).toHaveLength(64);expect(sig(l).efd).toHaveLength(16);
 });
 it('can resolve a synthetic equal-vector hard negative only with available evidence',()=>{
  const q={contour_signature:sig(l)},right=compareContour(q,q),wrong=compareContour(q,{contour_signature:sig(u)});
  expect(fuseCandidateScore({vector_similarity:.8,geometry_evidence:{contour:right}}).final_score).toBeGreaterThan(fuseCandidateScore({vector_similarity:.8,geometry_evidence:{contour:wrong}}).final_score);
  expect(fuseCandidateScore({vector_similarity:.8,geometry_evidence:{contour:{available:false,similarity:1}}}).final_score).toBe(.8);
 });
});
