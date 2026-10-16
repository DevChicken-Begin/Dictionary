-- Minimal isolated schema for the existing catalogue RPC, not production auth.
CREATE TABLE image_library (
 id uuid PRIMARY KEY, code text,part_id text,usage_side text,identifying_features text,
 view_mode text,is_symmetric boolean,confusing_note text,image_path text,
 updated_at timestamptz,created_at timestamptz
);
CREATE TABLE image_assets(image_id uuid,asset_type text,image_path text,storage_provider text,sort_order integer);
CREATE FUNCTION app_session_user_id(text) RETURNS uuid LANGUAGE sql AS $$
 SELECT CASE WHEN $1='fixture-valid' THEN '00000000-0000-0000-0000-000000000001'::uuid END
$$;
INSERT INTO image_library(id,code,part_id,usage_side,identifying_features,view_mode,updated_at,created_at)
SELECT lpad(to_hex(n),32,'0')::uuid,'sku-'||n,n::text,'left',CASE WHEN n=1000 THEN '17 lỗ tròn' ELSE '2 lỗ tròn' END,'single_face','2026-01-01','2026-01-01' FROM generate_series(1,1000) n;
