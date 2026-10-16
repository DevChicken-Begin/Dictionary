-- M04 proposal: apply only to an isolated test DB until Gate D approval.
-- Additive provenance; existing vectors remain unknown until manually rebuilt.
ALTER TABLE public.catalogue_image_vectors ADD COLUMN IF NOT EXISTS source_etag text;

CREATE OR REPLACE FUNCTION public.kim_write_catalogue_vector_v6(p_vector jsonb, p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_id bigint;
  v_existing public.catalogue_image_vectors%ROWTYPE;
  v_record text := p_vector->>'p_record_id';
  v_type text := p_vector->>'p_asset_type';
  v_key text := p_vector->>'p_object_key';
  v_variant text := p_vector->>'p_view_variant';
  v_etag text := p_vector->>'source_etag';
BEGIN
  IF p_mode NOT IN ('skip','replace') OR p_mode IS NULL OR
     coalesce(v_record,'') = '' OR coalesce(v_key,'') = '' OR
     coalesce(v_type,'') = '' OR coalesce(v_variant,'') = '' OR coalesce(v_etag,'') = '' THEN
    RAISE EXCEPTION 'Invalid vector identity, source ETag or write mode';
  END IF;
  -- Serialize requests for a SKU; composite unique key still provides final protection.
  PERFORM pg_advisory_xact_lock(hashtextextended('moris-v6:' || v_record, 0));
  -- Hold current asset rows against concurrent catalogue replacement during this write.
  PERFORM 1 FROM public.image_assets WHERE image_id::text=v_record FOR SHARE;
  IF NOT EXISTS (SELECT 1 FROM public.image_assets
    WHERE image_id::text=v_record AND asset_type=v_type AND image_path=v_key) THEN
    RAISE EXCEPTION 'Image asset no longer belongs to this SKU; refresh Center';
  END IF;
  SELECT * INTO v_existing FROM public.catalogue_image_vectors
  WHERE record_id=v_record AND asset_type=v_type AND object_key=v_key
    AND view_variant=v_variant
    AND embedding_model=p_vector->>'p_embedding_model'
    AND embedding_model_version=p_vector->>'p_embedding_model_version'
    AND preprocess_version=p_vector->>'p_preprocess_version'
    AND embedding_profile=p_vector->>'p_embedding_profile'
  FOR UPDATE;
  IF FOUND AND p_mode='skip' THEN
    IF v_existing.is_active AND v_existing.source_etag=v_etag THEN
      RETURN jsonb_build_object('id',v_existing.id,'action','skipped');
    END IF;
    RAISE EXCEPTION 'Existing vector needs explicit replace';
  END IF;
  -- Do not silently replace older source/profile rows in create-missing mode.
  IF p_mode='skip' AND EXISTS (SELECT 1 FROM public.catalogue_image_vectors v
    WHERE v.record_id=v_record AND v.asset_type=v_type AND v.is_active
      AND (v.object_key=v_key OR NOT EXISTS (SELECT 1 FROM public.image_assets a
        WHERE a.image_id::text=v_record AND a.asset_type=v_type AND a.image_path=v.object_key))) THEN
    -- A distinct variant of the same source/profile is a separate identity.
    IF EXISTS (SELECT 1 FROM public.catalogue_image_vectors v
      WHERE v.record_id=v_record AND v.asset_type=v_type AND v.is_active
        AND ((v.object_key=v_key AND v.view_variant=v_variant)
          OR NOT EXISTS (SELECT 1 FROM public.image_assets a
            WHERE a.image_id::text=v_record AND a.asset_type=v_type AND a.image_path=v.object_key))) THEN
      RAISE EXCEPTION 'Previous source/profile needs explicit replace';
    END IF;
  END IF;
  v_id := public.kim_upsert_catalogue_image_vector(
    v_record,v_type,v_key,v_variant,
    p_vector->>'p_embedding_model',p_vector->>'p_embedding_model_version',
    p_vector->>'p_preprocess_version',p_vector->>'p_embedding_profile',
    (p_vector->>'p_embedding')::halfvec,
    p_vector->>'p_foreground_status',(p_vector->>'p_quality_score')::real,
    (p_vector->>'p_hole_count')::integer,(p_vector->>'p_aspect_ratio')::real,
    coalesce(p_vector->'p_hole_centroids','[]'::jsonb));
  UPDATE public.catalogue_image_vectors SET source_etag=v_etag WHERE id=v_id;
  IF p_mode='replace' THEN
    -- Retain history without keeping obsolete images active. Preserve other current detail assets.
    UPDATE public.catalogue_image_vectors v SET is_active=false,updated_at=now()
    WHERE v.record_id=v_record AND v.asset_type=v_type AND v.id<>v_id AND v.is_active
      AND ((v.object_key=v_key AND v.view_variant=v_variant)
        OR NOT EXISTS (SELECT 1 FROM public.image_assets a
          WHERE a.image_id::text=v_record AND a.asset_type=v_type AND a.image_path=v.object_key));
  END IF;
  RETURN jsonb_build_object('id',v_id,'action',CASE WHEN v_existing.id IS NULL THEN 'created' ELSE 'replaced' END);
END;
$$;
REVOKE ALL ON FUNCTION public.kim_write_catalogue_vector_v6(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kim_write_catalogue_vector_v6(jsonb,text) TO service_role;
