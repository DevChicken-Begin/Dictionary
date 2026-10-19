-- =============================================================================
-- Migration: 20261019120000_size_contract_s11_optional_width.sql
-- M28 S1.1 (chủ dự án chốt 2026-10-19): cạnh dài BẮT BUỘC, cạnh ngắn TÙY CHỌN.
--
-- Bối cảnh: Gate D (20261019090000) yêu cầu đủ 2 cạnh; dữ liệu nhập tay thực tế
-- chỉ luôn đo được cạnh dài, sai số nhập tay ±5%/bên. S1.1:
--   * width_mm được phép NULL — thiếu cạnh ngắn KHÔNG chặn lưu/lọc;
--     Size Gate chỉ đối chiếu cạnh dài ('match_partial'), không loại trừ oan.
--   * RPC app_upsert_part_dimensions: bắt buộc length_mm; width_mm tùy chọn,
--     khi có thì > 0 và tự hoán vị length_mm >= width_mm (khớp normalizeSizePair).
--   * Dung sai theo nguồn đo nằm phía ứng dụng (contract v1.1): nhập tay
--     10%/sàn 3mm; kiểm chuẩn (caliper/marker_photo/erp/camera_measured) 5%/2mm.
--
-- Forward-only, additive: giữ nguyên RLS/RPC/get, không đụng bảng khác.
-- =============================================================================

-- 1. Cho phép thiếu cạnh ngắn
ALTER TABLE public.catalogue_part_dimensions
  ALTER COLUMN width_mm DROP NOT NULL;

-- 2. CHECK tường minh: NULL hợp lệ; khi có giá trị vẫn phải > 0 và <= length_mm
ALTER TABLE public.catalogue_part_dimensions
  DROP CONSTRAINT IF EXISTS catalogue_part_dimensions_width_mm_check;

ALTER TABLE public.catalogue_part_dimensions
  ADD CONSTRAINT catalogue_part_dimensions_width_mm_check
  CHECK (width_mm IS NULL OR (width_mm > 0 AND width_mm <= length_mm));

-- 3. RPC nhập/cập nhật size từ editor (admin, method='user')
--    - Bắt buộc cạnh dài > 0 và <= 5000mm (khớp MORIS_SIZE_MAX_MM phía UI).
--    - Cạnh ngắn tùy chọn: NULL hợp lệ; khi có thì > 0, <= 5000mm.
--    - Tự hoán vị length_mm >= width_mm khi có đủ 2 cạnh (khớp normalizeSizePair).
CREATE OR REPLACE FUNCTION public.app_upsert_part_dimensions(
  p_session_token text,
  p_image_id uuid,
  p_length_mm real,
  p_width_mm real DEFAULT NULL,
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

  IF p_length_mm IS NULL THEN
    RETURN json_build_object('ok', false, 'message', 'Cần nhập cạnh dài (mm) — cạnh ngắn có thể để trống.');
  END IF;

  IF p_length_mm <= 0 OR p_length_mm > 5000 THEN
    RETURN json_build_object('ok', false, 'message', 'Cạnh dài phải lớn hơn 0 và tối đa 5000mm.');
  END IF;

  IF p_width_mm IS NOT NULL AND (p_width_mm <= 0 OR p_width_mm > 5000) THEN
    RETURN json_build_object('ok', false, 'message', 'Cạnh ngắn phải lớn hơn 0 và tối đa 5000mm (hoặc để trống).');
  END IF;

  IF p_width_mm IS NULL THEN
    v_long := p_length_mm;
    v_short := NULL;
  ELSE
    v_long := greatest(p_length_mm, p_width_mm);
    v_short := least(p_length_mm, p_width_mm);
  END IF;
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
