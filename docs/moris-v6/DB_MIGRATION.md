# M23 — Migration, quota and rollback proposal

**Not applied to production. Gate D and the M22 NO-GO remain in force.** Apply order: proposed M04 manual writer, M10 stable catalogue paging, then `20261016040525_moris_v6_nullable_provenance.sql`. Do not deploy callers before their RPCs exist and matching-profile vectors are manually indexed.

> Cập nhật 2026-10-19: `supabase db push` đã áp các migration pending KHÁC (Gate D `20261019090000`, proposal `20261017090000`, cascade delete `2026101200020000`, reset flag `2026101000040000`) và repair 5 bản thiếu history. **Riêng 3 bản Moris V6 của tài liệu này (`20261016024931`, `20261016033020`, `20261016040525`) vẫn pending cố ý** — không push khi chưa mở Gate M22.
>
> Cập nhật 2026-10-19 (lần 2, M28 S1.1): đã push `20261019120000_size_contract_s11_optional_width.sql` (width_mm nullable + CHECK NULL-safe + RPC `app_upsert_part_dimensions` cạnh ngắn tùy chọn). Xác minh: `migration list` local=remote (trừ 3 bản V6 như trên); probe read-only `catalogue_part_dimensions` → 200; RPC tồn tại (token sai → 400 UNAUTHORIZED).

## Schema and permissions

Adds nullable `embedding_signature_version`, `geometry_evidence` and `geometry_processed_at`; no old-row backfill or vector relabelling. Source digest uses existing M04 `source_etag`. New service-only `SECURITY INVOKER` read/write RPCs preserve nullable count/aspect/centroids. Writer delegates identity locking/replacement to the reviewed M04 service-only writer. Public/anon/authenticated execution is revoked, search path pinned. API keeps session/editor checks and source ETag verification. Dense patch/experimental contour payloads are excluded from persistence; geometry JSON capped16KiB. Existing legacy RPCs remain for rollback.

Read-only production observation:1090 rows, all active; RLS enabled, anon cannot SELECT, service_role can SELECT/UPDATE; total relation size3,563,520bytes. No permission/RLS changes were made remotely.

## Capacity and dry run

Default one RGB vector per current asset/profile/variant, unique identity/idempotent retries; API chunks≤20. Current1090 assets imply at most1090 new-profile rows for an initial complete replacement, physical total≤2180 if all old rows retained. Replacement deactivates superseded same-asset profiles; repeated same-key rebuild does not add rows. Changed image paths legitimately retain history, so storage is not globally bounded forever: review retention/quota before future rebuild campaigns; no automatic purge.

Maximum extra geometry JSON for1090 new rows is17,858,560bytes before PostgreSQL/TOAST/index overhead; actual local test row1136bytes with a small geometry payload. These are estimates, not production allocation measurements. Dense32×384 descriptors would cost49,152 raw float bytes per asset and are **not persisted**. No new ANN index is introduced by M23.

`node tools/check-moris-provenance-db.mjs` creates only disposable databases in `moris-v6-test`. Actual result: nullable geometry, measured zero, idempotent1row, service-role read/write, denied public RPCs, three rejected unsafe payloads, backup/restore data+ACL equality and transactional schema rollback passed. Full unit suite380/380, TypeScript/build48 passed. Logs `/tmp/moris-v6-loop/M23-{db,test,ts,build}.log`.

## Approval-time procedure

1. Record app revision, schema/functions/grants/RLS, complete vector data including active flags, asset ETags, profile counts and relation sizes; export encrypted backup with checksums and role/ACL metadata. Restore into isolated staging and compare these values.
2. Owner reviews M22 measurements, quota, auth/RLS checks and proposed SQL. Only after separate production authorization, apply additive schema and verify RPC grants/NULL roundtrip with a reviewed canary.
3. Center preview and explicit manual confirmation create canary vectors. Compare actual row deltas, statuses, latency and retrieval; stop on profile mismatch or unexpected growth. Never purge legacy history to make the counts pass.
4. Before rollback, stop writes and capture post-change state. Restore prior app/profile configuration and vector active flags/data from the reviewed backup for affected assets. Keep additive columns until no caller depends on them; reverse only new RPCs/columns in a later approved maintenance step. For same-key overwritten vectors, data backup is essential; dropping columns alone cannot restore embeddings.

## Existing advisor baseline

Read-only advisory output is saved in `evidence/M23-existing-security-advisors.json`. Existing warnings were not introduced by this unapplied proposal and were not silently changed outside scope: [mutable function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [extensions in public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [anon-callable definer functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated-callable definer functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Session-token RPCs need individual authorization review; an advisor warning alone is not proof of exploitable access. Local proposal grants/RLS behavior were tested directly; hosted advisors cannot inspect an unapplied local migration.

Git dirty `feat/moris-v6`, HEAD `02289afa79747722b992938bee7c2d0414f7a9d2`; no commit/deploy/production mutation. Code rollback reverses only M23 API/search/migration/test hunks, rebuilds, and preserves original user changes. Database guidance follows [Supabase function security](https://supabase.com/docs/guides/database/functions).
