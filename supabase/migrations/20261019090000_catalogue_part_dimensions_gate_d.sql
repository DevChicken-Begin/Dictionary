-- =============================================================================
-- Migration: 20261019090000_catalogue_part_dimensions_gate_d.sql
-- M28 — GATE D (chủ dự án DUYỆT áp production 2026-10-19).
-- Kế thừa proposal 20261017090000_catalogue_part_dimensions_proposal.sql:
--   * Bảng `catalogue_part_dimensions` lưu cặp (length_mm, width_mm) theo Size
--     Contract S1 (length_mm >= width_mm), additive — KHÔNG sửa bảng hiện hữu.
--   * Ghi/đọc CHỈ qua RPC SECURITY DEFINER (admin); trình duyệt không truy cập
--     trực tiếp bảng (RLS bật, không mở policy anon/authenticated).
--   * Size Gate phía server đọc bằng service role (bỏ qua RLS) — fail-open.
-- =============================================================================

-- 1. Bảng dữ liệu kích thước catalogue
CREATE TABLE IF NOT EXISTS public.catalogue_part_dimensions (
  record_id     uuid PRIMARY KEY,              -- FK logic tới image_library.id
  code          text NOT NULL,
  part_id       text,
  length_mm     real NOT NULL CHECK (length_mm > 0),
  width_mm      real NOT NULL CHECK (width_mm > 0 AND width_mm <= length_mm),
  thickness_mm  real CHECK (thickness_mm IS NULL OR thickness_mm > 0),
  diagonal_mm   real CHECK (diagonal_mm IS NULL OR diagonal_mm > 0),
  hole_diameters_mm jsonb,
  hole_pitches_mm   jsonb,
  method        text NOT NULL CHECK (method IN ('caliper','marker_photo','erp','user')),
  confidence    real NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  measured_by   text,
  measured_at   timestamptz,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalogue_part_dimensions_code_idx
  ON public.catalogue_part_dimensions (code);

ALTER TABLE public.catalogue_part_dimensions ENABLE ROW LEVEL SECURITY;

-- 2. Dọn dims khi xóa mã — mở rộng trigger dọn dẹp đã có trên image_library
--    (đơn lẻ app_delete_part / hàng loạt app_bulk_delete_parts / toàn bộ
--    app_delete_all_parts / mọi đường xóa khác đều đi qua AFTER DELETE này).
CREATE OR REPLACE FUNCTION public.kim_cleanup_vectors_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.catalogue_image_vectors
  WHERE record_id = old.id::text;

  DELETE FROM public.catalogue_part_dimensions
  WHERE record_id = old.id;

  RETURN old;
END;
$$;

DROP TRIGGER IF EXISTS trg_kim_cleanup_vectors_on_delete ON public.image_library;

CREATE TRIGGER trg_kim_cleanup_vectors_on_delete
  AFTER DELETE ON public.image_library
  FOR EACH ROW
  EXECUTE FUNCTION public.kim_cleanup_vectors_on_delete();

-- 3. RPC nhập/cập nhật size từ editor (admin, method='user')
--    - Bắt buộc đủ 2 cạnh, > 0 và <= 5000mm (khớp MORIS_SIZE_MAX_MM phía UI).
--    - Tự hoán vị length_mm >= width_mm (khớp normalizeSizePair).
--    - code/part_id lấy từ image_library tại thời điểm ghi.
CREATE OR REPLACE FUNCTION public.app_upsert_part_dimensions(
  p_session_token text,
  p_image_id uuid,
  p_length_mm real,
  p_width_mm real,
  p_confidence real DEFAULT 0.9
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_code text;
  v_part_id text;
  v_long real;
  v_short real;
  v_confidence real;
BEGIN
  v_role := public.app_session_role(p_session_token);
  IF v_role IS NULL OR lower(v_role) <> 'admin' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_image_id IS NULL THEN
    RETURN json_build_object('ok', false, 'message', 'Thiếu p_image_id');
  END IF;

  IF p_length_mm IS NULL OR p_width_mm IS NULL THEN
    RETURN json_build_object('ok', false, 'message', 'Cần nhập đủ cạnh dài và cạnh ngắn (mm).');
  END IF;

  IF p_length_mm <= 0 OR p_width_mm <= 0 OR p_length_mm > 5000 OR p_width_mm > 5000 THEN
    RETURN json_build_object('ok', false, 'message', 'Số đo phải lớn hơn 0 và tối đa 5000mm.');
  END IF;

  v_long := greatest(p_length_mm, p_width_mm);
  v_short := least(p_length_mm, p_width_mm);
  v_confidence := least(greatest(coalesce(p_confidence, 0.9), 0), 1);

  SELECT i.code, i.part_id INTO v_code, v_part_id
  FROM public.image_library i
  WHERE i.id = p_image_id;

  IF v_code IS NULL THEN
    RETURN json_build_object('ok', false, 'message', 'Không tìm thấy mã linh kiện để lưu kích thước.');
  END IF;

  INSERT INTO public.catalogue_part_dimensions (
    record_id, code, part_id, length_mm, width_mm,
    method, confidence, measured_at, updated_at
  ) VALUES (
    p_image_id, v_code, v_part_id, v_long, v_short,
    'user', v_confidence, now(), now()
  )
  ON CONFLICT (record_id) DO UPDATE SET
    code = EXCLUDED.code,
    part_id = EXCLUDED.part_id,
    length_mm = EXCLUDED.length_mm,
    width_mm = EXCLUDED.width_mm,
    method = EXCLUDED.method,
    confidence = EXCLUDED.confidence,
    measured_at = EXCLUDED.measured_at,
    updated_at = now();

  RETURN json_build_object(
    'ok', true,
    'record_id', p_image_id,
    'length_mm', v_long,
    'width_mm', v_short,
    'method', 'user',
    'confidence', v_confidence
  );
END;
$$;

-- 4. RPC đọc size cho editor (admin) — thiếu bản ghi trả length/width = null.
CREATE OR REPLACE FUNCTION public.app_get_part_dimensions(
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
  v_row public.catalogue_part_dimensions%ROWTYPE;
BEGIN
  v_role := public.app_session_role(p_session_token);
  IF v_role IS NULL OR lower(v_role) <> 'admin' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_image_id IS NULL THEN
    RETURN json_build_object('ok', false, 'message', 'Thiếu p_image_id');
  END IF;

  SELECT * INTO v_row
  FROM public.catalogue_part_dimensions
  WHERE record_id = p_image_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', true, 'record_id', p_image_id, 'length_mm', NULL, 'width_mm', NULL);
  END IF;

  RETURN json_build_object(
    'ok', true,
    'record_id', v_row.record_id,
    'code', v_row.code,
    'length_mm', v_row.length_mm,
    'width_mm', v_row.width_mm,
    'method', v_row.method,
    'confidence', v_row.confidence,
    'measured_at', v_row.measured_at,
    'updated_at', v_row.updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.app_upsert_part_dimensions(text, uuid, real, real, real) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_get_part_dimensions(text, uuid) TO anon, authenticated, service_role;
