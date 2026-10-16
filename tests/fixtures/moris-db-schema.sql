-- Minimal isolated fixture, matching inspected production columns/index; no production data.
CREATE EXTENSION vector;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE public.image_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid NOT NULL,
 asset_type text NOT NULL, image_path text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.catalogue_image_vectors (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 record_id text NOT NULL, asset_type text NOT NULL, object_key text NOT NULL,
 view_variant text NOT NULL DEFAULT 'canonical', embedding_model text NOT NULL,
 embedding_model_version text NOT NULL, preprocess_version text NOT NULL, embedding_profile text NOT NULL,
 embedding halfvec(384) NOT NULL, foreground_status text NOT NULL DEFAULT 'unknown', quality_score real,
 is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(record_id,asset_type,object_key,view_variant,embedding_model,embedding_model_version,preprocess_version,embedding_profile)
);
