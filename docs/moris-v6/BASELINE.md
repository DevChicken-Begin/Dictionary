# Moris V6 — M00 Baseline

## Scope and source

Captured 2026-10-16 UTC. M00 only: baseline observation, local verification and tracking documents. No application changes, migrations, indexing, production writes or deployment. No new regression test is needed for this documentation-only task; existing assertions are unchanged.

- Original branch: `main`, tracking `origin/main`.
- Original/current HEAD: `02289afa79747722b992938bee7c2d0414f7a9d2`, matching the master plan.
- Created branch: `feat/moris-v6` via `git switch -c feat/moris-v6`. No commit made.
- Environment: Linux, Node `v24.21.0`, npm `11.19.0`, Vitest `5.0.3`; package version `0.1.0`, application `APP_VERSION` `6.1.3`.
- Existing dependencies were used; no installation or lockfile changes.

Initial `git status --short` (also in [raw evidence](evidence/M00-git-before.txt)):

```text
 D MORIS_FILTER_REVIEW.md
 D agent.md
 M dist/version.json
 D hdsd.md
?? CODEX_MORIS_V6_TASK_PROMPTS.md
?? MORIS_V6_MASTER_PLAN.md
?? MORIS_V6_QUICK_CHECKLIST.md
```

This is a dirty-working-tree baseline, not a claim of testing a clean checkout. Pre-existing deletions, untracked plans and `dist/version.json` are preserved. [Input hashes](evidence/M00-input-sha256.json) identify the documents before M00 updates.

## Call graph and impact reviewed before changes

`npm test` → `vitest run` → 18 test files under `tests/`; database-facing endpoint tests use mocked fetch and example/test environments. `npm run build` → `tools/build-static.mjs` → recreate local `dist/`, copy allowlisted static assets, generate config/version, minify JavaScript and check for leaks. The build script has no deployment or database call.

Database observation used Supabase MCP `execute_sql` → schema inspection through `information_schema.columns` → aggregate SELECT over the confirmed `public.image_library` and `public.catalogue_image_vectors` columns. All SQL calls used `BEGIN READ ONLY` and `COMMIT`; snapshot output confirms `transaction_read_only=on`. No write RPC or application indexing path was invoked.

## Fresh database snapshot

Project: `vhsikdgkzecdfopkpzum`. First sample: `02:13:45.271137+00`; second sample: `02:14:13.000037+00`. The first sample occurred during the local test run; the second followed test/build. These are observations at two instants, not a guarantee against concurrent external activity.

| Measurement | First | Second |
|---|---:|---:|
| Catalogue rows / distinct SKU codes | 545 / 545 | 545 / 545 |
| Vector rows / active vectors | 1090 / 1090 | 1090 / 1090 |
| `front` / `thumb` vectors | 545 / 545 | 545 / 545 |
| `canon_rgb_v2` / other variants | 1090 / 0 | 1090 / 0 |
| Catalogue `single_face` view | 545 | 545 |

Both vector groups declare model `onnx-community/dinov2-small`, revision `ef1fb10`, preprocessing `kim_canon_v2`, profile `cls_l2_v1`. These are stored labels, not proof of encoder compatibility. Query and complete aggregate results: [SQL](evidence/M00-snapshot.sql), [JSON](evidence/M00-snapshot.json). No embeddings, images, row identifiers or credentials were exported.

M00 database writes: **0**. Observed catalogue/vector row deltas: **0 / 0**. No added index/vector storage; physical database bytes were not measured. Historical accuracy claims in state/master plan were not rerun and are not M00 evidence.

## Actual checks

| Command | Exit | Actual result |
|---|---:|---|
| `git status --short` | 0 | Existing changes recorded above |
| `git rev-parse HEAD` | 0 | SHA above |
| `npm test` | 0 | **18/18 files, 229/229 tests passed**, duration 5.92s |
| `npm run build` | 0 | **42 files → dist/**; 8 public config variables; no warning reported |
| `npm ls typescript --depth=0` | 1 | `(empty)`; TypeScript is not a declared/installed direct dependency |
| `command -v tsc` | 1 | No compiler on PATH; no local `node_modules/.bin/tsc` either |
| `npm exec --no -- tsc --noEmit` | — | **Not run**: no verified TypeScript compiler; no package downloaded |

Full output and command start times: [test](evidence/M00-test.log), [build](evidence/M00-build.log), [commands](evidence/M00-commands.json), [compiler discovery](evidence/M00-typescript-check.json).

The build changed only `dist/version.json` versus the pre-task filesystem backup. Its original bytes were restored, and every dist file path and SHA-256 matched that backup afterwards ([verification](evidence/M00-dist-verification.txt)). Its pre-existing Git modification remains.

Not run: TypeScript type checking, browser/staging E2E, WebGPU/WASM inference, camera or cross-view accuracy benchmark, migrations, reindex and deployment. Passing unit tests does not establish those outcomes or completion of any later V6 task.

## Baseline defects and risks

1. `state.json` initially failed strict JSON parsing: trailing comma after `task_15_moris_supabase_unified_upgrade.diagnostics.finding_3` (line 191). Remove that one comma when updating M00 tracking; retain historical task content and metrics, explicitly dated as historical evidence.
2. TypeScript validation remains unverified. A later authorized task must establish a valid compiler before relying on type-check claims.
3. Dirty initial checkout and generated timestamps prevent describing this as a pristine build. Original local files were backed up at `/tmp/moris-m00-baseline/`; this temporary backup is session-local.
4. Existing architecture issues listed in the master plan remain outside M00. No invariants for M01–M26 are newly certified here.

## Rollback and review

M00 adds this baseline and its evidence files, updates only current-session/M00 tracking in `state.json`, appends the M00 checklist to `plan.md`, and marks only M00 in the master plan after the Git/test/risk/rollback report. No production rollback is needed.

To undo M00, remove only its new documentation/evidence, reverse its tracking hunks (including the explicitly documented JSON comma repair if exact original bytes are required), and uncheck only M00 in the master plan. Use the pre-task `state.json` and `plan.md` copies under `/tmp/moris-m00-baseline/` only after checking for newer edits. Do not reset the working tree or overwrite the user's untracked V6 plans. `dist/` is already restored. Switch back to `main` only when appropriate; branch removal is optional and was not performed.

Next review: owner reviews M00 evidence and the disclosed skipped checks. Stop here; M01 or another task requires a separate instruction. Gates A–E have not been passed. No new commit hash exists; HEAD remains the baseline SHA.
