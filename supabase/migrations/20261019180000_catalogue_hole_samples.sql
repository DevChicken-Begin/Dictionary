-- =============================================================================
-- Migration: Bảng moris_hole_samples — Từ điển mẫu lỗ phổ biến
--            (tra cứu cho người dùng + Moris tham chiếu mềm định dạng lỗ)
-- =============================================================================
-- Ảnh gốc nguồn: thư mục Simple/ (14 ảnh, 10 định dạng) đã đẩy lên R2 bucket
-- catalogue-images, prefix hole-samples/ (đồng bộ cùng đợt, đã verify 14 objects).
-- Frontend đọc bằng Supabase JS .from('moris_hole_samples') với RLS (authenticated).
-- Ghi dữ liệu: service_role (migration/script) — không mở policy ghi cho client.
-- Chủ dự án chốt 2026-10-19: mọi user đã đăng nhập được xem; gom biến thể về
-- tên chuẩn; thứ tự theo nhóm định dạng; mẫu mới thêm qua migration/script.
-- =============================================================================

create table if not exists public.moris_hole_samples (
  id         bigint generated always as identity primary key,
  slug       text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name       text not null,
  format_tag text not null check (format_tag ~ '^[a-z_]+$'),
  r2_key     text not null unique,
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists moris_hole_samples_active_order_idx
  on public.moris_hole_samples (sort_order)
  where active;

drop trigger if exists trg_moris_hole_samples_updated_at on public.moris_hole_samples;
create trigger trg_moris_hole_samples_updated_at
  before update on public.moris_hole_samples
  for each row execute function public.set_updated_at();

comment on table public.moris_hole_samples is
  'Từ điển mẫu lỗ phổ biến (ảnh R2: hole-samples/<slug>.png). Đọc: authenticated; ghi: service_role. Moris dùng để tham chiếu mềm (soft boost) định dạng lỗ, không hard filter.';

-- RLS: mọi user đã đăng nhập được đọc; không policy ghi cho client.
alter table public.moris_hole_samples enable row level security;

drop policy if exists mhs_select on public.moris_hole_samples;
create policy mhs_select on public.moris_hole_samples
  for select to authenticated using (true);

-- Seed 14 ảnh mẫu / 10 định dạng (idempotent theo slug).
-- sort_order: nhóm định dạng tròn → vuông → oval → oval cong → dài →
-- chữ nhật → chữ L → tam giác → răng cưa → gài móc (biến thể cùng nhóm liền kề).
insert into public.moris_hole_samples (slug, name, format_tag, r2_key, sort_order) values
  ('tron',      'Lỗ tròn',      'tron',      'hole-samples/tron.png',      10),
  ('vuong',     'Lỗ vuông',     'vuong',     'hole-samples/vuong.png',     21),
  ('vuong-1',   'Lỗ vuông',     'vuong',     'hole-samples/vuong-1.png',   22),
  ('oval',      'Lỗ oval',      'oval',      'hole-samples/oval.png',      31),
  ('oval-1',    'Lỗ oval',      'oval',      'hole-samples/oval-1.png',    32),
  ('oval-cong', 'Lỗ oval cong', 'oval_cong', 'hole-samples/oval-cong.png', 40),
  ('dai',       'Lỗ dài',       'dai',       'hole-samples/dai.png',       51),
  ('dai-1',     'Lỗ dài',       'dai',       'hole-samples/dai-1.png',     52),
  ('dai-2',     'Lỗ dài',       'dai',       'hole-samples/dai-2.png',     53),
  ('chu-nhat',  'Lỗ chữ nhật',  'chu_nhat',  'hole-samples/chu-nhat.png',  60),
  ('chu-l',     'Lỗ chữ L',     'chu_l',     'hole-samples/chu-l.png',     70),
  ('tam-giac',  'Lỗ tam giác',  'tam_giac',  'hole-samples/tam-giac.png',  80),
  ('rang-cua',  'Lỗ răng cưa',  'rang_cua',  'hole-samples/rang-cua.png',  90),
  ('gai-moc',   'Lỗ gài móc',   'gai_moc',   'hole-samples/gai-moc.png',  100)
on conflict (slug) do update set
  name       = excluded.name,
  format_tag = excluded.format_tag,
  r2_key     = excluded.r2_key,
  sort_order = excluded.sort_order,
  active     = true,
  updated_at = now();
