import {describe,it,expect} from 'vitest';
import {minimumAssignment,matchHoleTopology} from '../functions/_lib/moris/v5/retrieval/holeMatcher.js';
const geom=points=>({hole_count:points.length,hole_centroids:points,quality:{reliable:true}});
function brute(cost,used=[],i=0){if(i===cost.length)return 0;return Math.min(...cost[i].map((v,j)=>used.includes(j)?Infinity:v+brute(cost,[...used,j],i+1)));}
describe('M14 optimal bounded hole assignment',()=>{
 it('matches brute-force optimum for deterministic small matrices',()=>{
  for(let n=1;n<=5;n++)for(let seed=1;seed<8;seed++){
   const cost=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>((i+3)*(j+seed+1)%13)/13));
   expect(minimumAssignment(cost).cost).toBeCloseTo(brute(cost),12);
  }
 });
 it('matches identical X/different Y independent of array order',()=>{
  const p=[{x:.4,y:.2},{x:.4,y:.8},{x:.7,y:.3}];
  const r=matchHoleTopology(geom(p),geom([...p].reverse()));expect(r.similarity).toBe(1);expect(r.matched_pairs).toHaveLength(3);
 });
 it('reports missing/extra holes with a soft cost',()=>{
  const p=[{x:.2,y:.2},{x:.5,y:.5},{x:.8,y:.3}];
  const r=matchHoleTopology(geom(p),geom(p.slice(0,2)));expect(r.unmatched_query).toHaveLength(1);expect(r.similarity).toBeGreaterThan(0);expect(r.similarity).toBeLessThan(1);
 });
 it('compares radius/size evidence and suppresses unreliable masks',()=>{
  const q=geom([{x:.2,y:.2,radius:.1,is_big:true}]);
  expect(matchHoleTopology(q,geom([{x:.2,y:.2,radius:.02,is_big:false}])).similarity).toBeLessThan(1);
  expect(matchHoleTopology({...q,quality:{reliable:false}},q).available).toBe(false);
 });
 it('17 versus 5 does not become a perfect spatial match',()=>{
  const p=Array.from({length:17},(_,i)=>({x:(i+1)/18,y:.3}));
  const r=matchHoleTopology(geom(p),geom(p.slice(0,5)));expect(r.similarity).toBeLessThan(.3);expect(r.unmatched_query).toHaveLength(12);
 });
 it('bounds work at 64 holes, refuses larger inputs, is deterministic',()=>{
  const p=Array.from({length:64},(_,i)=>({x:(i%8)/8,y:Math.floor(i/8)/8}));
  const start=performance.now();const a=matchHoleTopology(geom(p),geom([...p].reverse()));
  expect(a.similarity).toBe(1);expect(performance.now()-start).toBeLessThan(1000);
  expect(a).toEqual(matchHoleTopology(geom(p),geom([...p].reverse())));
  expect(matchHoleTopology({hole_count:65},{hole_count:65}).available).toBe(false);
 });
});
