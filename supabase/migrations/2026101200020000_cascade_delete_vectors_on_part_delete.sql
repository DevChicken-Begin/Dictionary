-- =============================================================================
-- Migration: 2026101200020000_cascade_delete_vectors_on_part_delete.sql
-- Đảm bảo xóa sạch toàn bộ vector trong catalogue_image_vectors khi xóa mã
-- linh kiện ở main chính (xóa đơn lẻ app_delete_part và xóa hàng loạt app_bulk_delete_parts).
-- =============================================================================

-- 1. Trigger cascade khi xóa bản ghi image_library
CREATE OR REPLACE FUNCTION public.kim_cleanup_vectors_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.catalogue_image_vectors
  WHERE record_id = old.id::text;
  RETURN old;
END;
$$;

DROP TRIGGER IF EXISTS trg_kim_cleanup_vectors_on_delete ON public.image_library;

CREATE TRIGGER trg_kim_cleanup_vectors_on_delete
  AFTER DELETE ON public.image_library
  FOR EACH ROW
  EXECUTE FUNCTION public.kim_cleanup_vectors_on_delete();

-- 2. Cập nhật app_bulk_delete_parts xóa trực tiếp vector
CREATE OR REPLACE FUNCTION public.app_bulk_delete_parts(
  p_session_token text,
  p_image_ids uuid[]
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_r2_keys text[];
  v_deleted_count int;
  v_id_texts text[];
BEGIN
  v_role := public.app_session_role(p_session_token);
  IF v_role IS NULL OR lower(v_role) <> 'admin' THEN
    RAISE EXCEPTION 'Chỉ admin có quyền xóa hàng loạt mã linh kiện.';
  END IF;

  IF p_image_ids IS NULL OR cardinality(p_image_ids) = 0 THEN
    RETURN json_build_object('ok', true, 'deleted_count', 0, 'r2_keys', '[]'::json);
  END IF;

  SELECT array_agg(id::text) INTO v_id_texts FROM unnest(p_image_ids) AS id;

  -- 1. Thu thập toàn bộ object key trên R2 của các mã cần xóa
  SELECT coalesce(array_agg(DISTINCT k), ARRAY[]::text[])
  INTO v_r2_keys
  FROM (
    SELECT a.image_path AS k
    FROM public.image_assets a
    WHERE a.image_id = ANY(p_image_ids) AND a.image_path IS NOT NULL AND a.image_path <> ''
    UNION
    SELECT i.image_path AS k
    FROM public.image_library i
    WHERE i.id = ANY(p_image_ids) AND i.image_path IS NOT NULL AND i.image_path <> ''
  ) s;

  -- 2. Xóa triệt để các vector trong catalogue_image_vectors ở Trung tâm Vector AI
  DELETE FROM public.catalogue_image_vectors
  WHERE record_id = ANY(v_id_texts);

  -- 3. Xóa bản ghi trong image_library (cascade image_assets)
  DELETE FROM public.image_library
  WHERE id = ANY(p_image_ids);
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN json_build_object(
    'ok', true,
    'deleted_count', v_deleted_count,
    'r2_keys', coalesce(to_json(v_r2_keys), '[]'::json)
  );
END;
$$;

-- 3. Cập nhật app_delete_part xóa trực tiếp vector
CREATE OR REPLACE FUNCTION public.app_delete_part(
  p_session_token text,
  p_image_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_deleted int;
BEGIN
  v_role := public.app_session_role(p_session_token);
  IF v_role IS NULL OR lower(v_role) <> 'admin' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_image_id IS NULL THEN
    RETURN json_build_object('ok', false, 'message', 'Thiếu p_image_id');
  END IF;

  -- Xóa vector trong catalogue_image_vectors
  DELETE FROM public.catalogue_image_vectors
  WHERE record_id = p_image_id::text;

  -- Xóa image_assets liên quan
  DELETE FROM public.image_assets
  WHERE image_id = p_image_id;

  -- Xóa image_library
  DELETE FROM public.image_library
  WHERE id = p_image_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN json_build_object('ok', false, 'message', 'Không tìm thấy mã linh kiện để xóa');
  END IF;

  RETURN json_build_object('ok', true, 'deleted_id', p_image_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.app_bulk_delete_parts(text, uuid[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_delete_part(text, uuid) TO anon, authenticated, service_role;
