-- M23 PROPOSAL ONLY. Apply after approved backup/local rehearsal/Gate D.
-- Additive metadata; existing rows are not relabelled or backfilled.
ALTER TABLE public.catalogue_image_vectors
  ADD COLUMN embedding_signature_version text,
  ADD COLUMN geometry_evidence jsonb,
  ADD COLUMN geometry_processed_at timestamptz;
ALTER TABLE public.catalogue_image_vectors ADD CONSTRAINT moris_v6_geometry_budget
  CHECK (geometry_evidence IS NULL OR (jsonb_typeof(geometry_evidence)='object' AND octet_length(geometry_evidence::text)<=16384));

CREATE FUNCTION public.kim_write_catalogue_vector_v6_provenance(p_vector jsonb,p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=public,extensions,pg_temp AS $$
DECLARE
  g jsonb := p_vector->'geometry_evidence';
  result jsonb;
  reliable boolean;
  holes integer;
  ratio real;
BEGIN
  IF p_vector->>'p_view_variant' IS DISTINCT FROM 'canon_rgb_v2' THEN
    RAISE EXCEPTION 'Only approved RGB indexing is enabled';
  END IF;
  IF g IS NULL OR jsonb_typeof(g)<>'object' OR octet_length(g::text)>16384 OR
     g->>'geometry_version' IS DISTINCT FROM 'geometry_v1' OR
     (g - ARRAY['geometry_version','provenance','quality','coordinate_space','scale','hole_count','big_hole_count','small_hole_count','aspect_ratio','solidity','hole_centroids','count_conflict']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid geometry contract or storage budget';
  END IF;
  IF g->'quality' IS NOT NULL AND g->'quality'<>'null'::jsonb AND jsonb_typeof(g->'quality')<>'object' THEN
    RAISE EXCEPTION 'Invalid quality evidence';
  END IF;
  IF g#>'{quality,reliable}' IS NOT NULL AND g#>'{quality,reliable}'<>'null'::jsonb AND
     jsonb_typeof(g#>'{quality,reliable}')<>'boolean' THEN
    RAISE EXCEPTION 'Quality reliability must be boolean or unknown';
  END IF;
  reliable := g#>>'{quality,reliable}' = 'true';
  IF reliable THEN
    IF jsonb_typeof(g->'hole_count') IS DISTINCT FROM 'number' OR
       (g->>'hole_count') !~ '^[0-9]+$' OR (g->>'hole_count')::integer NOT BETWEEN 0 AND 128 OR
       jsonb_typeof(g->'aspect_ratio') IS DISTINCT FROM 'number' OR (g->>'aspect_ratio')::real<=0 THEN
      RAISE EXCEPTION 'Invalid measured geometry';
    END IF;
    holes := (g->>'hole_count')::integer;
    ratio := (g->>'aspect_ratio')::real;
  END IF;
  IF g->'hole_centroids' IS NOT NULL AND g->'hole_centroids'<>'null'::jsonb AND
     (jsonb_typeof(g->'hole_centroids')<>'array' OR jsonb_array_length(g->'hole_centroids')>128) THEN
    RAISE EXCEPTION 'Invalid centroid budget';
  END IF;
  -- Existing service-only writer owns locking, source identity and atomic idempotent replacement.
  result := public.kim_write_catalogue_vector_v6(p_vector,p_mode);
  IF result->>'action'<>'skipped' THEN
    UPDATE public.catalogue_image_vectors SET
      hole_count=holes,aspect_ratio=ratio,
      hole_centroids=CASE WHEN reliable THEN NULLIF(g->'hole_centroids','null'::jsonb) ELSE NULL END,
      geometry_evidence=g,embedding_signature_version='moris384_geometry_v1',geometry_processed_at=now()
    WHERE id=(result->>'id')::bigint;
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.kim_write_catalogue_vector_v6_provenance(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kim_write_catalogue_vector_v6_provenance(jsonb,text) TO service_role;

CREATE FUNCTION public.match_catalogue_image_vectors_v6(
 p_query_embedding halfvec(384),p_embedding_model text,p_embedding_model_version text,
 p_preprocess_version text,p_embedding_profile text,p_match_count integer DEFAULT 30
) RETURNS TABLE(record_id text,asset_type text,object_key text,similarity double precision,
 hole_count integer,aspect_ratio real,hole_centroids jsonb,geometry_version text,
 quality jsonb,provenance text,embedding_signature_version text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,extensions,pg_temp AS $$
 SELECT v.record_id,v.asset_type,v.object_key,1-(v.embedding<=>p_query_embedding),
   v.hole_count,v.aspect_ratio,v.hole_centroids,v.geometry_evidence->>'geometry_version',
   v.geometry_evidence->'quality',v.geometry_evidence->>'provenance',v.embedding_signature_version
 FROM public.catalogue_image_vectors v
 WHERE v.is_active AND v.embedding_model=p_embedding_model AND v.embedding_model_version=p_embedding_model_version
   AND v.preprocess_version=p_preprocess_version AND v.embedding_profile=p_embedding_profile
 ORDER BY v.embedding<=>p_query_embedding
 LIMIT greatest(1,least(coalesce(p_match_count,30),100));
$$;
REVOKE ALL ON FUNCTION public.match_catalogue_image_vectors_v6(halfvec,text,text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.match_catalogue_image_vectors_v6(halfvec,text,text,text,text,integer) TO service_role;
