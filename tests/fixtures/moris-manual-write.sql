-- Run only on the disposable local fixture DB; rolled back even when successful.
BEGIN;
INSERT INTO image_assets(image_id,asset_type,image_path) VALUES
 ('00000000-0000-0000-0000-000000000001','front','one.webp'),
 ('00000000-0000-0000-0000-000000000001','detail','detail1.webp'),
 ('00000000-0000-0000-0000-000000000001','detail','detail2.webp');
DO $$
DECLARE v jsonb; r jsonb; first_id bigint; n integer;
BEGIN
 v=jsonb_build_object('p_record_id','00000000-0000-0000-0000-000000000001','p_asset_type','front','p_object_key','one.webp','p_view_variant','canon_rgb_v2','p_embedding_model','test','p_embedding_model_version','1','p_preprocess_version','1','p_embedding_profile','test','p_embedding',array_fill(0.1::real,ARRAY[384])::text,'source_etag','v1');
 -- Postgres array text uses braces; vector literal uses square brackets.
 v=jsonb_set(v,'{p_embedding}',to_jsonb(replace(replace(v->>'p_embedding','{','['),'}',']')));
 r=kim_write_catalogue_vector_v6(v,'skip'); first_id=(r->>'id')::bigint;
 r=kim_write_catalogue_vector_v6(v,'skip');
 IF r->>'action'<>'skipped' OR (r->>'id')::bigint<>first_id THEN RAISE EXCEPTION 'retry failed'; END IF;
 r=kim_write_catalogue_vector_v6(v,'replace');
 SELECT count(*) INTO n FROM catalogue_image_vectors; IF n<>1 THEN RAISE EXCEPTION 'row growth'; END IF;
 -- Distinct variant is never mistaken for the original. Public API keeps gray disabled.
 r=kim_write_catalogue_vector_v6(jsonb_set(v,'{p_view_variant}','"canon_gray_v2"'),'skip');
 SELECT count(*) INTO n FROM catalogue_image_vectors; IF n<>2 THEN RAISE EXCEPTION 'variant identity'; END IF;
 -- ETag change requires explicit replacement.
 BEGIN
  PERFORM kim_write_catalogue_vector_v6(jsonb_set(v,'{source_etag}','"v2"'),'skip');
  RAISE EXCEPTION 'EXPECTED_REJECTION';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='EXPECTED_REJECTION' THEN RAISE; END IF; END;
 r=kim_write_catalogue_vector_v6(jsonb_set(v,'{source_etag}','"v2"'),'replace');
 IF (r->>'id')::bigint<>first_id THEN RAISE EXCEPTION 'same key must retain ID'; END IF;
 -- Source replacement retires old source only after successful insertion.
 UPDATE image_assets SET image_path='new.webp' WHERE asset_type='front';
 v=jsonb_set(v,'{p_object_key}','"new.webp"');
 BEGIN
  PERFORM kim_write_catalogue_vector_v6(v,'skip'); RAISE EXCEPTION 'EXPECTED_REJECTION';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='EXPECTED_REJECTION' THEN RAISE; END IF; END;
 r=kim_write_catalogue_vector_v6(v,'replace');
 SELECT count(*) INTO n FROM catalogue_image_vectors WHERE is_active; IF n<>1 THEN RAISE EXCEPTION 'old source still active'; END IF;
 -- Invalid embedding rolls back and does not retire active source.
 BEGIN
  PERFORM kim_write_catalogue_vector_v6(jsonb_set(v,'{p_embedding}','"[1,2]"'),'replace'); RAISE EXCEPTION 'EXPECTED_REJECTION';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='EXPECTED_REJECTION' THEN RAISE; END IF; END;
 SELECT count(*) INTO n FROM catalogue_image_vectors WHERE is_active; IF n<>1 THEN RAISE EXCEPTION 'atomicity'; END IF;
 v=jsonb_set(v,'{p_asset_type}','"detail"');v=jsonb_set(v,'{p_object_key}','"detail1.webp"');
 PERFORM kim_write_catalogue_vector_v6(v,'skip');v=jsonb_set(v,'{p_object_key}','"detail2.webp"');PERFORM kim_write_catalogue_vector_v6(v,'replace');
 SELECT count(*) INTO n FROM catalogue_image_vectors WHERE is_active AND asset_type='detail'; IF n<>2 THEN RAISE EXCEPTION 'sibling detail retired'; END IF;
 IF has_function_privilege('anon','kim_write_catalogue_vector_v6(jsonb,text)','EXECUTE') OR has_function_privilege('authenticated','kim_write_catalogue_vector_v6(jsonb,text)','EXECUTE') THEN RAISE EXCEPTION 'public privilege'; END IF;
 RAISE NOTICE 'PASS: retry, replace, distinct variant, changed ETag, changed key, atomic rollback, sibling assets, privileges';
END $$;
ROLLBACK;
