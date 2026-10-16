// Isolated LOCAL Docker-only check. Never connects to Supabase.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const container='moris-v6-test',db=`moris_paging_${Date.now()}`;
const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8'}).trim();
execFileSync('docker',['exec',container,'createdb','-U','postgres',db]);
try{
 sql(readFileSync('tests/fixtures/moris-catalogue-paging.sql','utf8'));
 sql(readFileSync('supabase/migrations/20261016033020_moris_v6_catalogue_stable_paging.sql','utf8'));
 const rows=[];
 for(let offset=0;offset<1000;offset+=300) rows.push(...sql(`SELECT id FROM app_search_catalogue('fixture-valid','','left','single_face',300,${offset});`).split('\n').filter(Boolean));
 if(rows.length!==1000||new Set(rows).size!==1000||rows.join()!==[...rows].sort().join())throw Error('Unstable/incomplete paging');
 if(sql("SELECT code FROM app_search_catalogue('fixture-valid','17 lỗ tròn','left','single_face',300,0);")!=='sku-1000')throw Error('Feature boundary mismatch');
 if(sql("SELECT count(*) FROM app_search_catalogue('fixture-valid','','right','all',300,0);")!=='0')throw Error('Filter ignored');
 sql("DO $$ BEGIN PERFORM * FROM app_search_catalogue('invalid'); RAISE EXCEPTION 'invalid token accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'UNAUTHORIZED' THEN RAISE; END IF; END $$;");
 console.log('PASS: 1,000 tied timestamps -> ordered 1,000 unique IDs; last-page feature/usage filter and auth guard pass (auth function fixture).');
 console.log(sql("EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM app_search_catalogue('fixture-valid','','all','all',300,900);"));
}finally{execFileSync('docker',['exec',container,'dropdb','-U','postgres',db]);}
