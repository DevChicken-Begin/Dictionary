import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {validateHardNegativeCases} from '../evaluation/moris-v6/hardNegatives.js';
import {rerankCandidatesByGeometry} from '../functions/_lib/moris/v5/retrieval/geometricReranker.js';
const cases=JSON.parse(readFileSync(new URL('../evaluation/moris-v6/hard-negative-review-queue.json',import.meta.url),'utf8'));
describe('hard-negative evidence and synthetic behavior',()=>{
 it('tracks specified pairs and55 audit leads without pretending curator approval',()=>{
  expect(validateHardNegativeCases(cases)).toEqual({cases:57,approved:0,pending:57});
  expect(()=>validateHardNegativeCases(cases,{requireApproved:true})).toThrow(/Unapproved/);
  expect(cases[0].sku_pair).toEqual(['3405030101','3427740001']);
 });
 it('approved regression requires actual images and before/after outputs',()=>{
  expect(()=>validateHardNegativeCases([{...cases[0],status:'approved'}])).toThrow(/curator/);
 });
 it('rejects placeholder snapshot hashes in otherwise complete curator evidence',()=>{
  const approved={...cases[0],status:'approved',curator:'fixture-reviewer',reviewed_at:'2026-10-16T00:00:00Z',expected_outcome:'fixture only',images:[{sku:'a',sha256:'a'.repeat(64)},{sku:'b',sha256:'b'.repeat(64)}],before_snapshot_sha256:'c'.repeat(64),after_snapshot_sha256:'d'.repeat(64)};
  expect(validateHardNegativeCases([approved],{requireApproved:true}).approved).toBe(1);
  for(const key of ['before_snapshot_sha256','after_snapshot_sha256'])for(const value of ['passed','',null,123,'g'.repeat(64),'a'.repeat(63)])expect(()=>validateHardNegativeCases([{...approved,[key]:value}],{requireApproved:true})).toThrow(/SHA-256/);
 });
 it('synthetic17-versus5 uses generic geometric evidence, neverSKU-specific logic',()=>{
  const rows=rerankCandidatesByGeometry([{id:'wrong',similarity:.92,hole_count:5,quality:{reliable:true}},{id:'right',similarity:.9,hole_count:17,quality:{reliable:true}}],{hole_count:17,quality:{reliable:true}});
  expect(rows[0].id).toBe('right');
 });
 it('same count alone cannot establish a3-versus3 identity',()=>{
  const rows=rerankCandidatesByGeometry([{id:'a',similarity:.8,hole_count:3},{id:'b',similarity:.8,hole_count:3}],{hole_count:3});
  expect(rows[0].final_score).toBe(rows[1].final_score);
 });
 it('validates rejected status requiring curator, reviewed_at and rejection_reason',()=>{
  expect(()=>validateHardNegativeCases([{...cases[0],status:'rejected'}])).toThrow(/rejection_reason/);
  const rejected={...cases[0],id:'rejected-lead-1',status:'rejected',curator:'fixture-curator',reviewed_at:'2026-10-16T00:00:00Z',rejection_reason:'False alarm: specular reflection on hole 4'};
  expect(validateHardNegativeCases([rejected])).toEqual({cases:1,approved:0,pending:0,rejected:1});
  expect(validateHardNegativeCases([cases[0],rejected])).toEqual({cases:2,approved:0,pending:1,rejected:1});
 });
 it('review cli tool reports correct summary without mutating state',()=>{
  const out=execSync('node tools/review-moris-hard-negatives.mjs',{encoding:'utf8'});
  expect(out).toContain('Total Cases:           57');
  expect(out).toContain('Pending:               57');
  const inspect=execSync('node tools/review-moris-hard-negatives.mjs --inspect specified-17-vs-5',{encoding:'utf8'});
  expect(JSON.parse(inspect).sku_pair).toEqual(['3405030101','3427740001']);
 });
});
