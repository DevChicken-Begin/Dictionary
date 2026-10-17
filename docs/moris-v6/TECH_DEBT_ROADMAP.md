# Moris V6 — Technical Debt Roadmap

Updated 2026-10-16 (sync 2026-10-17: bổ sung [TECH_DEBT_REGISTER.md](TECH_DEBT_REGISTER.md) — sổ nợ đầy đủ + test backlog). This is the fast entry point for the next agent. It consolidates known M06–M26 acceptance debt and external evidence gates; it is not a repository-wide semantic code audit. A targeted search found no additional actionable TODO/FIXME that supersedes the tracked gates. Do not infer that unlisted code is debt-free.

## Read only these first

1. `AGENTS.md` — binding safety, testing, and state rules.
2. `state.json` — machine-readable current status and evidence.
3. `docs/moris-v6/HANDOFF.md` — current checkpoint, benchmark facts, and quota limits.
4. This roadmap — dependency order and next actions.
5. `MORIS_V6_MASTER_PLAN.md` plus `MORIS_V6_QUICK_CHECKLIST.md` — đã bị chủ dự án xoá; đọc bản cũ bằng `git show 2657b49:<tên_file>`. Task definitions và acceptance hiện hành nằm ở `pipeline_moris.md` §10–12 và `plan.md`.

Then open only the task documents and implementation paths for the task being resumed. Treat older append-only sections in `plan.md`, task prompts, and M19 notes as historical when they conflict with the latest state/evidence. Do not recalculate old benchmark numbers.

## Open debt and execution order

| Order | Gate | Required work and exit evidence |
|---|---|---|
| 1 | M21 curator review | Review the 57-item queue against local catalogue images; record human-confirmed labels and before/after ranking snapshots. Tooling (`tools/review-moris-hard-negatives.mjs`), rejection schema and HTML review sheet ready; current outcomes are 0/57 human-curated; only 11 have development-query context. Do not infer labels from metadata. |
| 2 | Fresh evaluation data | Collect newly captured, independently labelled camera queries with SKU, view, lighting, angle, and session. Define unknown negatives if FAR is required. Freeze manifest and dev/holdout split before evaluation. The existing 31-image holdout is consumed and must never be retuned or reused as unseen evidence. |
| 3 | M14/M15/M16/M18/M22 acceptance | On the new development split, compare global, hole, contour, patch, multi-probe, and reject behavior; tune only on development and evaluate a frozen new holdout once. M16 also needs real-device latency/memory evidence. M18 needs actual paired views and verified geometry/symmetry labels; current 545 references are `single_face`. Keep experimental geometry OFF absent evidence. |
| 4 | M26 release decision | Local checks may proceed when authorized. Staging was explicitly skipped by the owner; record `skipped_by_owner`, never pass. No canary, release sign-off, production write, or deploy is authorized. |
| 5 | Migration/reindex release gate | M23–M24 code and migration proposals exist, but production application is a separate gate. Require explicit authorization, backup/restore plan, dry-run, quota check, and profile-compatible vectors before any production write. |

## Evidence and resource guardrails

Current M22 result is NO-GO: development global Top1 58/93; consumed holdout global Top1 20/31; no unknown-negative set means FAR is unknown. Geometry was worse on development and is OFF by default. Existing 545-reference inference and holdout results are recorded in `HANDOFF.md` and `M22.md`; do not rerun them to confirm. Quota remaining is unknown. Do not schedule full tests, builds, or inference solely to reproduce old results; run the focused checks required by the next actual code change, then broader checks only when authorized and within quota.

At the latest recorded checkpoint: full suite 398/398 across 44 files predates two focused test additions; those focused tests passed 10/10. `npx tsc --noEmit` exited 0, build produced 49 files, and local E2E passed 12/12 at an earlier application checkpoint. These are historical evidence, not proof of the current dirty tree. Consult the linked logs in `HANDOFF.md` before citing them.

## Safe continuation

Preserve the existing worktree and branch `main`; never reset, clean, or discard uncommitted work without an explicit owner request (commit/push only khi chủ dự án yêu cầu). Keep production database writes and deployment at zero. For a code change, first inspect only its call path and tests, make the narrow change, run the appropriate tests, record exact output and rollback in the task evidence, then update `state.json` and checklists. Leave every unsupported acceptance item unchecked. Roll back only the task-specific hunks; never restore whole files over pre-existing user changes.
