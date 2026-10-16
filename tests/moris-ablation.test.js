import {it,expect} from 'vitest';
import {rankAblation} from '../evaluation/moris-v6/ablation.js';
const vector=Array(384).fill(0);vector[0]=1;
const probes=[{embedding:vector,profile:{version:'fixture'}}];
it('exact retrieval and all ablations retain uniqueSKU/real vector units',()=>{
 const q={probes,geometry:{hole_count:17,quality:{reliable:true}}};
 const rows=[{sku:'wrong',probes,geometry:{hole_count:5,quality:{reliable:true}}},{sku:'right',probes,geometry:{hole_count:17,quality:{reliable:true}}}];
 expect(rankAblation(q,rows,'holes').candidates[0].sku).toBe('right');
 expect(rankAblation(q,[...rows,rows[0]],'global').retrieval).toHaveLength(2);
 for(const mode of ['global','holes','contour','patch'])expect(rankAblation(q,rows,mode).candidates.every(r=>Number.isFinite(r.final_score))).toBe(true);
});
it('rejects incompatible candidate profile and invalid query, never mixes legacy vectors',()=>{
 expect(()=>rankAblation({probes},[{sku:'x',probes:[{embedding:vector,profile:{version:'old'}}]}],'global')).toThrow(/mismatch/);
 expect(()=>rankAblation({probes:[{embedding:Array(384).fill(0)}]},[],'global')).toThrow(/Invalid/);
});
