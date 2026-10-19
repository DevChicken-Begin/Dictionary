-- M28 PROPOSAL GỐC — ĐÃ ĐƯỢC CHỦ DỰ ÁN DUYỆT GATE D 2026-10-19; bản áp dụng thật là
-- `20261019090000_catalogue_part_dimensions_gate_d.sql` (bảng + RPC + trigger dọn dims).
-- File này giữ lại làm lịch sử; vẫn idempotent (IF NOT EXISTS) khi chạy theo thứ tự.
-- Bảng dữ liệu kích thước catalogue theo quy ước Size Contract (pipeline_moris.md §5.3, §10.3):
--   (length_mm, width_mm) là cặp cạnh theo trục chính PCA, length_mm >= width_mm.
--   thickness_mm nullable (Q1: chỉ dài × rộng là bắt buộc, dày không bắt buộc).
-- Additive, không sửa bảng hiện hữu; đọc/ghi phía server bằng service role.
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

-- Không mở policy cho anon/authenticated: Size Gate đọc phía server bằng service role
-- (postgrest service key bỏ qua RLS). Nếu cần UI quản trị đọc trực tiếp thì thêm policy riêng
-- sau khi qua Gate D, tuyệt đối không mở ghi cho trình duyệt.
