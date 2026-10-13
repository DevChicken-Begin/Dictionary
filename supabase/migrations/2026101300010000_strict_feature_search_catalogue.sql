-- Migration: 2026101300010000_strict_feature_search_catalogue.sql
-- Mô tả: Cập nhật RPC app_search_catalogue hỗ trợ ranh giới số nghiêm ngặt
--        khi tìm kiếm theo đặc điểm nhận dạng (ví dụ: '2 lỗ tròn' chỉ khớp số 2,
--        tuyệt đối không khớp substring của '22 lỗ tròn', '20 lỗ tròn', '12 lỗ tròn').

create or replace function public.app_search_catalogue(
  p_session_token text,
  p_search text default ''::text,
  p_usage_side text default 'all'::text,
  p_view_mode text default 'all'::text,
  p_limit integer default 60,
  p_offset integer default 0
)
returns table (
  id uuid,
  code text,
  part_id text,
  usage_side text,
  identifying_features text,
  view_mode text,
  is_symmetric boolean,
  confusing_note text,
  fallback_path text,
  fallback_provider text,
  thumb_path text,
  thumb_provider text,
  front_path text,
  front_provider text,
  back_path text,
  back_provider text,
  detail_count integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_search text := trim(coalesce(p_search, ''));
  v_usage  text := coalesce(nullif(trim(coalesce(p_usage_side, '')), ''), 'all');
  v_view   text := coalesce(nullif(trim(coalesce(p_view_mode, '')), ''), 'all');
begin
  if public.app_session_user_id(p_session_token) is null then
    raise exception 'UNAUTHORIZED';
  end if;

  return query
  with filtered as (
    select i.*
    from public.image_library i
    where (v_usage = 'all' or i.usage_side = v_usage)
      and (v_view = 'all' or i.view_mode = v_view)
      and (
        v_search = ''
        or (
          case
            -- Khi tìm kiếm bắt đầu bằng số (ví dụ: '2 lỗ tròn', '22 lỗ tròn', '2 lỗ')
            -- Ta áp dụng ranh giới số nghiêm ngặt: (^|[^\d])<số>(\s+|\D) để 2 không khớp vào 22, 20 hay 12
            when v_search ~ '^\d+\s+' then
              (
                concat_ws(' ', i.code, i.part_id, i.confusing_note) ilike '%' || v_search || '%'
                or i.identifying_features ~* (
                  '(^|[^\d])' || (regexp_match(v_search, '^(\d+)'))[1] || '(\s+|\D).*' || trim(regexp_replace(v_search, '^\d+\s*', ''))
                )
              )
            else
              concat_ws(' ', i.code, i.part_id, i.identifying_features, i.confusing_note) ilike '%' || v_search || '%'
          end
        )
      )
    order by i.updated_at desc nulls last, i.created_at desc nulls last
    limit greatest(1, least(coalesce(p_limit, 60), 300))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    i.id,
    i.code,
    i.part_id,
    i.usage_side,
    i.identifying_features,
    i.view_mode,
    i.is_symmetric,
    i.confusing_note,
    i.image_path as fallback_path,
    case when i.image_path like 'parts/%' then 'r2' else 'supabase' end as fallback_provider,
    th.image_path as thumb_path,
    th.storage_provider as thumb_provider,
    fr.image_path as front_path,
    fr.storage_provider as front_provider,
    ba.image_path as back_path,
    ba.storage_provider as back_provider,
    coalesce(dc.detail_count, 0)::int as detail_count,
    i.updated_at
  from filtered i
  left join lateral (
    select a.image_path, a.storage_provider
    from public.image_assets a
    where a.image_id = i.id and a.asset_type = 'thumb'
    order by a.sort_order
    limit 1
  ) th on true
  left join lateral (
    select a.image_path, a.storage_provider
    from public.image_assets a
    where a.image_id = i.id and a.asset_type = 'front'
    order by a.sort_order
    limit 1
  ) fr on true
  left join lateral (
    select a.image_path, a.storage_provider
    from public.image_assets a
    where a.image_id = i.id and a.asset_type = 'back'
    order by a.sort_order
    limit 1
  ) ba on true
  left join lateral (
    select count(*)::int as detail_count
    from public.image_assets a
    where a.image_id = i.id and a.asset_type = 'detail'
  ) dc on true;
end;
$function$;
