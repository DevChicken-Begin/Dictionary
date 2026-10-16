# M26 — Release checklist: NO-GO

This is a local verification checkpoint, not release sign-off. No production database changes, reindex, deployment or release commit were made.

## Scope and call graph

Editor saves metadata/assets only. Explicit Center confirmation calls the manual batch runner, authenticated API and service-only provenance RPC. Moris creates transient query embeddings and reads compatible-profile candidates; the sole score fuser and conservative presentation produce suggestions. M26 tightens the query boundary to reject coerced null/string/boolean/nonfinite/zero vectors; valid embeddings and text queries retain their behavior.

## Verified locally

- [x] Full suite: `npm test`, 43 files / 395 tests passed, zero failures (evidence/M22-gate-full-test.log).
- [x] TypeScript: `npx tsc --noEmit`, exit 0, no diagnostics. This checks configured TypeScript sources; it is not a full JavaScript type audit.
- [x] Static build: `npm run build`, exit 0, 49 files. Original user `dist/version.json` restored after build.
- [x] Local SQL proposal tests: nullable geometry versus measured zero, role restrictions, idempotency, backup/restore data and ACL equality, transactional schema rollback. See DB_MIGRATION.md.
- [x] Local browser E2E: 12 checks passed, including Editor Save with zero vector calls, Center preview/cancel, partial failure/retry, stable row count, pause/resume, desktop/mobile candidate detail click. Auth/R2/model are fixtures; local PostgreSQL and API handlers are real.
- [x] Production inspection used read-only queries/HTTP GET. Last vector observation: 1090 rows; observed delta from baseline 0. No migration applied.

## Open release gates

- [ ] Camera acceptance: real124-image benchmark completed; holdout Top1 20/31, Recall10 29/31, Recall50 31/31. NO-GO; see M22.md and DECISION.md.
- [ ] Curator-approved hard negatives, unknown-product negative set and business-approved false-accept threshold.
- **SKIPPED by owner request:** staging login/2FA/CSRF/anti-bot and permission E2E. Not measured or certified; owner asked to proceed to the remaining steps.
- [ ] Real mobile/WebGPU performance and production-equivalent latency/index-size canary.
- [ ] Owner Gate D/E approval, release commit and sign-off.

The supplied `https://dictionary-dnw.pages.dev/` belongs to Cloudflare project `dictionary`, production branch `main`; latest deployment is also production. Read-only GET checks of `/`, `/config.js` and `/version.json` returned 404. The repository Gatekeeper intentionally returns 404 before a valid gate session, so these unauthenticated responses do not prove an outage. `.env` has production credentials but no verified staging/test-account configuration. Those credentials were not printed or used to mutate production. Evidence: `evidence/M26-pages-readonly.json`, `M26-provided-url-readonly.json`, `M26-deployment-readonly.json`. Owner subsequently instructed skipping staging and proceeding; no further staging configuration is required for the authorized local work. Production remains out of scope.

## Git, risks and rollback

Working branch `feat/moris-v6`, base HEAD `02289afa79747722b992938bee7c2d0414f7a9d2`; working tree contains existing owner changes and uncommitted implementation. A passing dirty-tree run does not establish a tested release commit. Original deleted documents, supplied images and version metadata must be preserved.

New server callers require the proposed RPC migrations and manually created matching-profile vectors before any future rollout. Legacy vectors cannot be relabelled into the new profile. Experimental contour/patch/gray remain OFF. Missing quality and uncalibrated scores must not become confident identity claims.

Local rollback: reverse only scoped Moris implementation hunks and rebuild, preserving owner changes and private benchmark evidence; do not use a blanket reset/clean. Production was unchanged, so no remote rollback is needed now. A future approved rollout requires an app revision plus vector data/active-flag/profile backup: stop writes, restore previous app/profile and affected vector data, then consider removing additive schema only after callers no longer depend on it. Detailed dry-run and data/ACL restore evidence is in DB_MIGRATION.md.

## Local checkpoint closed — quota restraint

Owner requested closing the current task without further quota-heavy loops. Runtime image geometry defaults OFF based on development evidence, with explicit text constraints preserved; approved hard-negative snapshot hashes require SHA-256 format. Actual verification:395/395 tests,43files; TypeScript/build49 and local E2E12/12 pass. Logs: docs/moris-v6/evidence/M22-gate-*.log. No new benchmark or test run scheduled; remaining quota is unknown.

Remaining M14/M15/M16/M18/M21/M22/M26 acceptance is unverified; no blanket completion or release claim. Staging skipped by owner. No production writes/deploy/commit. Rollback only the geometry flag/orchestrator and evidence-validator/test hunks, preserving owner changes; reenabling geometry restores the measured regression and is not recommended without new evidence.

## Latest documentation/tool verification

Review-only helper and tests were added after the application checkpoint. Latest `npm test`:398/398 in44 files, exit0. Focused hard-negative review tests10/10 (latest; full suite not rerun after two last tests). The app code was not changed in this follow-up, so existing TypeScript/build49/local E2E12/12 logs still apply to the same app revision. No camera model was re-run; no staging/production access.
