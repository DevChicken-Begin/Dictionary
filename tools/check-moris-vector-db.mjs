// Disposable database inside the explicitly named LOCAL test container only.
import { spawn, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const container='moris-v6-test';
const database=`moris_check_${Date.now()}`;
function sql(query) {
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d',database,'-At','-v','ON_ERROR_STOP=1']);
  let output='',error='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>error+=d);
  child.on('error',reject);child.on('close',code=>code?reject(new Error(error)):resolve(output.trim()));child.stdin.end(query);
 });
}
execFileSync('docker',['exec',container,'createdb','-U','postgres',database]);
try {
 let schema=await readFile('tests/fixtures/moris-db-schema.sql','utf8');
 schema=schema.replace(/CREATE ROLE (\w+);/g,(_,role)=>`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role}; END IF; END $$;`);
 await sql(schema);
 await sql(await readFile('supabase/migrations/2026101000050000_add_geometry_metadata_to_vectors.sql','utf8'));
 await sql(await readFile('supabase/migrations/20261016024931_moris_v6_manual_vector_write.sql','utf8'));
 await sql(await readFile('tests/fixtures/moris-manual-write.sql','utf8'));
 console.log('PASS: transactional SQL fixture (retry, replace, variants, ETag, source change, atomic rollback, sibling assets, privileges)');
 const id='00000000-0000-0000-0000-000000000002';
 await sql(`INSERT INTO image_assets(image_id,asset_type,image_path) VALUES ('${id}','front','concurrent.webp');`);
 const vector={p_record_id:id,p_asset_type:'front',p_object_key:'concurrent.webp',p_view_variant:'canon_rgb_v2',p_embedding_model:'test',p_embedding_model_version:'1',p_preprocess_version:'1',p_embedding_profile:'test',p_embedding:JSON.stringify(Array(384).fill(.1)),source_etag:'concurrent'};
 const query=`SELECT kim_write_catalogue_vector_v6('${JSON.stringify(vector)}'::jsonb,'skip');`;
 const results=await Promise.all(Array.from({length:8},()=>sql(query).then(JSON.parse)));
 const count=Number(await sql('SELECT count(*) FROM catalogue_image_vectors;'));
 if(count!==1 || results.filter(r=>r.action==='created').length!==1 || results.filter(r=>r.action==='skipped').length!==7) throw new Error('Concurrency invariant failed');
 console.log('PASS: 8 concurrent requests -> 1 created, 7 skipped, 1 total row');
 await sql('BEGIN; DROP FUNCTION kim_write_catalogue_vector_v6(jsonb,text); ALTER TABLE catalogue_image_vectors DROP COLUMN source_etag; ROLLBACK;');
 if(await sql("SELECT count(*) FROM information_schema.columns WHERE table_name='catalogue_image_vectors' AND column_name='source_etag';")!=='1') throw new Error('Schema rollback rehearsal failed');
 console.log('PASS: transactional schema rollback rehearsal; source_etag restored after ROLLBACK');
} finally {execFileSync('docker',['exec',container,'dropdb','-U','postgres',database]);}
