// Disposable LOCAL database and restore clone. No remote connection is accepted.
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const container='moris-v6-test',database=`moris_provenance_${Date.now()}`,clone=database+'_restore';
const command=(args,input)=>execFileSync('docker',['exec','-i',container,...args],{input,encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const sql=(q,db=database)=>command(['psql','-U','postgres','-d',db,'-qAt','-v','ON_ERROR_STOP=1'],q);
command(['createdb','-U','postgres',database]);let cloneCreated=false;
try{
 let schema=await readFile('tests/fixtures/moris-db-schema.sql','utf8');schema=schema.replace(/CREATE ROLE (\w+);/g,(_,r)=>`DO $$ BEGIN IF NOT EXISTS(SELECT1 FROM pg_roles WHERE rolname='${r}') THEN CREATE ROLE ${r}; END IF; END $$;`.replace('SELECT1','SELECT 1'));
 sql(schema);sql(await readFile('supabase/migrations/2026101000050000_add_geometry_metadata_to_vectors.sql','utf8'));sql(await readFile('supabase/migrations/20261016024931_moris_v6_manual_vector_write.sql','utf8'));sql(await readFile('supabase/migrations/20261016040525_moris_v6_nullable_provenance.sql','utf8'));
 sql("GRANT SELECT,UPDATE ON catalogue_image_vectors TO service_role; ALTER TABLE catalogue_image_vectors ENABLE ROW LEVEL SECURITY; CREATE POLICY local_service_fixture ON catalogue_image_vectors TO service_role USING(true) WITH CHECK(true);");
 const id='00000000-0000-0000-0000-000000000004';sql(`INSERT INTO image_assets(image_id,asset_type,image_path) VALUES('${id}','front','nullable.webp');`);
 const v={p_record_id:id,p_asset_type:'front',p_object_key:'nullable.webp',p_view_variant:'canon_rgb_v2',p_embedding_model:'test',p_embedding_model_version:'1',p_preprocess_version:'1',p_embedding_profile:'test',p_embedding:JSON.stringify(Array(384).fill(.1)),source_etag:'v1',geometry_evidence:{geometry_version:'geometry_v1',quality:{reliable:false},hole_count:null,aspect_ratio:null,hole_centroids:null}};
 const quote=x=>"'"+JSON.stringify(x).replaceAll("'","''")+"'::jsonb";
 const call=(value,mode='skip')=>JSON.parse(sql(`SET ROLE service_role; SELECT kim_write_catalogue_vector_v6_provenance(${quote(value)},'${mode}');`));
 const a=call(v),b=call(v);if(a.action!=='created'||b.action!=='skipped'||a.id!==b.id)throw Error('Retry/idempotency');
 if(sql('SELECT (hole_count IS NULL AND aspect_ratio IS NULL AND hole_centroids IS NULL)::text FROM catalogue_image_vectors;')!=='true')throw Error('Unknown geometry not null');
 const measured={...v,geometry_evidence:{geometry_version:'geometry_v1',quality:{reliable:true},hole_count:0,aspect_ratio:2,hole_centroids:[]}};call(measured,'replace');
 if(sql('SELECT (hole_count=0 AND aspect_ratio=2)::text FROM catalogue_image_vectors;')!=='true')throw Error('Measuredzero lost');
 const result=JSON.parse(sql(`SET ROLE service_role; SELECT row_to_json(r) FROM match_catalogue_image_vectors_v6('${v.p_embedding}'::halfvec,'test','1','1','test',10) r;`));
 if(result.hole_count!==0||result.geometry_version!=='geometry_v1'||result.quality.reliable!==true)throw Error('Read contract');
 for(const bad of [{...v,p_view_variant:'canon_gray_v2'},{...v,geometry_evidence:{...v.geometry_evidence,patch_signature:Array(50000).fill(1)}},{...v,geometry_evidence:{...v.geometry_evidence,geometry_version:'invented'}}]){
  let rejected=false;try{call(bad,'replace');}catch{rejected=true;}if(!rejected)throw Error('Unsafe payload accepted');
 }
 const privileges=sql("SELECT has_function_privilege('anon','kim_write_catalogue_vector_v6_provenance(jsonb,text)','EXECUTE') OR has_function_privilege('authenticated','match_catalogue_image_vectors_v6(halfvec,text,text,text,text,integer)','EXECUTE');");if(privileges!=='f')throw Error('Public RPC privilege');
 const expected=sql('SELECT row_to_json(v)::text FROM catalogue_image_vectors v;');
 const dump=command(['pg_dump','-U','postgres','--no-owner',database]);command(['createdb','-U','postgres',clone]);cloneCreated=true;sql(dump,clone);
 if(sql("SELECT has_function_privilege('anon','kim_write_catalogue_vector_v6_provenance(jsonb,text)','EXECUTE');",clone)!=='f')throw Error('Restore ACL mismatch');
 if(sql('SELECT row_to_json(v)::text FROM catalogue_image_vectors v;',clone)!==expected)throw Error('Restore data mismatch');
 sql('BEGIN; DROP FUNCTION match_catalogue_image_vectors_v6(halfvec,text,text,text,text,integer); DROP FUNCTION kim_write_catalogue_vector_v6_provenance(jsonb,text); ALTER TABLE catalogue_image_vectors DROP CONSTRAINT moris_v6_geometry_budget,DROP COLUMN geometry_evidence,DROP COLUMN embedding_signature_version,DROP COLUMN geometry_processed_at; ROLLBACK;');
 if(sql('SELECT row_to_json(v)::text FROM catalogue_image_vectors v;')!==expected)throw Error('Transactional rollback mismatch');
 console.log(JSON.stringify({null_geometry:true,measured_zero:true,idempotent:true,service_invoker:true,public_rpc_denied:true,invalid_payloads_rejected:3,rows:Number(sql('SELECT count(*) FROM catalogue_image_vectors;')),row_bytes:Number(sql('SELECT pg_column_size(v) FROM catalogue_image_vectors v;')),backup_restore_equal:true,rollback_equal:true,production_writes:0}));
}finally{if(cloneCreated)command(['dropdb','-U','postgres',clone]);command(['dropdb','-U','postgres',database]);}
