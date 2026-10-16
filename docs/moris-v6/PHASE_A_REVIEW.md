# Moris V6 — M00–M05 review

## Decision

M00 baseline retained; M01–M05 implemented on `feat/moris-v6`, based on `02289afa79747722b992938bee7c2d0414f7a9d2`. No commit, deployment or production write. Gate A is ready for owner review of the **local implementation**, not production release approval. Camera quality is **not acceptable for a release claim** on the supplied sample.

## Changes and verification by task

| Task | Implementation | Actual evidence |
|---|---|---|
| M00 | Original baseline preserved | [BASELINE.md](BASELINE.md), 229 tests / 18 files |
| M01 | Ownership matrix/call graph and AGENTS invariant | [ARCHITECTURE.md](ARCHITECTURE.md), [static callers](evidence/M01-callers.txt), 229 tests |
| M02 | Removed Editor vector button, write/enrollment helpers and login queue retry; retained query embedding and delete cleanup | [M02-test.log](evidence/M02-test.log), 235 tests / 19 files; create, metadata edit, image upload, repeated Save, session restore |
| M03 | Center confirmation before single/batch, fail closed without dialog; server role checks plus explicit intent; legacy reindex URL redirects to Center | [M03-test.log](evidence/M03-test.log), 246 tests / 20 files |
| M04 | Atomic composite-key skip/replace, source ETag, RGB-only indexing, chunks <=20, no success on partial failure | [M04-test.log](evidence/M04-test.log), 253 tests / 21 files; real local SQL and concurrency below |
| M05 | Per-asset missing/ready/stale/failed; aggregate partial; profile and current R2 ETag checked; individual asset actions | [M05-test.log](evidence/M05-test.log), 266 tests / 22 files; [final suite](evidence/phase-a-final-test.log) after bounded paging |

Final suite: **266/266 tests, 22/22 files**, exit 0. TypeScript **5.9.3**, `npm exec --no -- tsc --noEmit`: exit 0, no diagnostics ([log](evidence/phase-a-typescript.log)). Playwright **1.56.1** and TypeScript are pinned development dependencies; package lock updated, install used `--ignore-scripts`. Final `npm run build`: exit 0, 42 static files ([log](evidence/phase-a-build.log)). No production security middleware was changed.

The old Editor text assertion changed because M02 explicitly removes its vector button. The old vector-items large-limit assertion now checks a cap of 20: Center fetches successive pages so R2 freshness reads are bounded. Neither assertion was removed to hide a defect. Earlier baseline failure was the obsolete Editor text expectation; the initial E2E harness also needed to await **SKU** readiness instead of matching a ready sibling asset.

## Current write path and status contract

Center asset/SKU/batch confirmation → fetch source bytes with `cache: no-store` → RGB embedding of those bytes → chunked upsert → validated session/role/intent → compare source ETag with R2 head → `kim_write_catalogue_vector_v6` → existing composite unique-key RPC within one transaction.

- Retained roles: admin/editor/converter. Intent fields are not authentication.
- Missing mode skips an exact active key with matching ETag. Changed/unknown source or old profile requires explicit replace.
- Transaction-level SKU advisory lock serializes concurrent new requests. Current asset membership is verified and locked before writing. Full identity includes record, asset type, object key, variant, model, model version, preprocessing and profile.
- Replace retains the same row for the same identity. A genuinely new source key can add one row; obsolete source rows become inactive atomically. Other current detail images remain active. Old rows are retained, not purged.
- Gray is disabled at the public indexing API and Center. Query gray probes remain permitted and write nothing.
- `source_etag` is measured from the bytes supplied to the model and checked against current R2. Metadata timestamps are not treated as content fingerprints. Existing vectors with no ETag become stale after migration; opening Center never rebuilds them.
- `vector_status` is authoritative for UI/actions. The existing `has_vector` field remains a legacy presence hint for compatibility, never proof of readiness.
- Status requests cap catalogue pages at 20, R2 heads at 40 and concurrent heads at 8. Center loads successive pages (maximum 5,000 items). Assets beyond a page's read budget or with unavailable provenance report unverified/failed, never ready. Read-only fallback asset failures are surfaced.

## Local database and browser E2E

Only disposable PostgreSQL 17/pgvector databases in Docker container `moris-v6-test` were written. The fixture copies the inspected vector columns, unique key and existing RPC signature; it is not a production clone.

`node tools/check-moris-vector-db.mjs` — exit 0 ([log](evidence/phase-a-database.log)):

- Repeat skip and explicit replace preserve identity/count.
- Different variants remain distinct in SQL, while the public API keeps gray disabled.
- Changed ETag/key requires replace; invalid embedding rolls the transaction back.
- Updating one detail asset preserves siblings; public/authenticated RPC execution is denied by grants.
- **8 concurrent requests → 1 created, 7 skipped, exactly 1 row.**
- Transactional schema rollback rehearsal restores the proposed column/function after ROLLBACK. The runner drops only its own disposable test database.

`node tools/check-moris-e2e.mjs` — exit 0, **10 checks passed** ([JSON](evidence/phase-a-e2e.json), [log](evidence/phase-a-e2e.log)). Chromium exercises the real Vue Editor, Center, API handlers and local SQL RPC. It covers mount/cancel, partial failure, missing-view retry, repeated rebuild, changed-source status, confirmed batch, Editor Save, a mobile Center viewport and an individual front-image update that leaves the thumb stale. Auth/session, R2 and embeddings are explicit fixtures. Service workers are blocked in the browser test context because the app service worker bypassed mocked model routing on repeat navigation; application PWA code is unchanged and cache behavior is not certified by this harness. This does **not** certify deployed login/2FA/RLS, real-device WebGPU or staging E2E.

## Camera verification — six unprocessed captures

Owner corrected the input directory to `image 2/`. Those six files were used unmodified, including background and rotation. `image/` contains eight cutouts and is excluded from the camera score. Expected SKU labels come from filenames; no independent label audit, unknown-negative set or frozen holdout exists.

Actual Chromium/WASM q8 DINOv2 inference succeeded for all six; model `onnx-community/dinov2-small`, revision `ef1fb10`, current `kim_canon_v2` / `cls_l2_v1` labels. No model/ranking weights were changed or fitted to these images.

| Measurement | Top1 | Recall@10 | Recall@50 |
|---|---:|---:|---:|
| Exact RGB cosine, best view per SKU across 545 indexed SKUs | 4/6 | 5/6 | 6/6 |
| Existing geometry reranker applied to that diagnostic Top50 | 0/6 | 3/6 | 6/6 |
| Current V5 orchestrator, actual RGB + gray query probes | **0/6** | **4/6** | Not exposed by final Top10 response |

The orchestrator run uses the unchanged source, 12 live **read-only** vector match RPC calls and a read-only catalogue snapshot hydration adapter. It does not impersonate a production user or test the deployed HTTP/auth path. Raw diagnostic results: [camera JSON](evidence/phase-a-camera.json); orchestrator results and catalogue snapshot hash: [orchestrator JSON](evidence/phase-a-camera-orchestrator.json).

| Expected SKU | RGB cosine rank | Orchestrator rank |
|---|---:|---:|
| 3450730001 | 1 | 3 |
| 3451550001 | 1 | 8 |
| 3460370001 | 27 | Outside Top10 |
| 3465950101 | 1 | 2 |
| 3671110401 | 2 | 7 |
| 3960230001 | 1 | Outside Top10 |

Query-probe inference: first image **13,331 ms** including initialization; remaining five **1,247–2,446 ms**. Orchestrator search **90–175 ms**, excluding browser inference. These are six observations, not a reliable production p95. False acceptance on unknown parts was not measured. Detected hole counts include 20 on two images; no ground-truth hole labels exist. The diagnostic degradation implicates geometry/mask reliability, but does not prove a single root cause. M06–M08/M12+ require separate work/review; none were implemented here.

## Production observation and migration dependency

Read-only observation at `2026-10-16 03:02:41.01739+00`: **545 SKU, 1,090 vectors, 1,090 active, 0 gray**; delta versus M00 **0**. Proposed `source_etag` column count in production **0**. Existing upsert RPC signature and service-only execute grant were inspected read-only.

`supabase/migrations/20261016024931_moris_v6_manual_vector_write.sql` is a **proposal**, generated with CLI `migration new` and applied only locally. It adds one nullable text column and a service-only wrapper function; existing table RLS and legacy RPC remain unchanged. App code depends on this migration: do not deploy it alone. Missing schema/R2 evidence causes failure/unverified status, not fallback writes.

Before any production application: owner Gate D review, full vector/activity/provenance backup, staging verification and a measured storage budget. Same-key reruns add zero rows; new source keys retain inactive history, so long-term retention/quota still needs later lifecycle review. No production migration/reindex is authorized by this report.

## Rollback, Git and next review

No new commit. Pre-existing deleted `MORIS_FILTER_REVIEW.md`, `agent.md`, `hdsd.md`, modified `dist/version.json` and untracked V6 plans are preserved. Supplied image directories remain untracked; no image or embedding payload is added to evidence or static build. Build artifacts reflect the changed app; original `dist/version.json` bytes are restored afterwards.

Before deployment, rollback is a reviewed reversal of M01–M05 source/test/documentation/dependency hunks plus rebuilt static assets. Do not use a blanket reset: it would destroy unrelated user changes and M00 evidence. Session backups of original tracking/AGENTS/version files are in `/tmp/moris-phase-a/`; temporary files are not durable backups.

Database proposal rollback: with manual writes stopped, remove only `kim_write_catalogue_vector_v6(jsonb,text)`; retaining the nullable ETag column is the least destructive option. If removing it, first preserve ETags. If any real replacements have occurred, restore vector contents/activity flags from the reviewed backup; dropping the function/column alone does not restore old active rows. The local transactional rehearsal is not a production restore certification.

Next gate: owner review of Gate A implementation and camera failure evidence. Production migration/deploy and staging sign-off remain pending. No task after M05 is marked complete.

## Reproduction

```sh
npm test
npm exec --no -- tsc --noEmit
npm run build
# Local Docker fixture only; initialize using tests/fixtures/moris-db-schema.sql
# and the existing geometry migration plus the proposed M04 migration.
node tools/check-moris-vector-db.mjs
node tools/check-moris-e2e.mjs
node tools/check-moris-camera.mjs /tmp/moris-camera.json '/workspaces/Dictionary/image 2' --query-probes
node tools/check-moris-camera-ranking.mjs /tmp/moris-camera.json
```

Browser checks require Chromium and its OS dependencies (`playwright install chromium`, `playwright install-deps chromium`). The local E2E harness expects Vue 3.5.22 at `/tmp/moris-phase-a/vue.global.prod.js` from the official Vue package. Camera ranking reads credentials from local `.env` in memory; its network allowlist only permits catalogue GET and the existing vector match RPC. Never commit `.env`, local embeddings, or internal image files.
