# Moris V6 decision — NO-GO

Do not release or reindex production. Actual camera Top1 does not meet the proposed90% target. Contour, spatial patch and mirrored-gray probes stay OFF. No production configuration was changed. The local runtime now defaults automatic image geometry OFF, implementing the global-versus-geometry choice made from development before holdout. Explicit text constraints and metadata/filter behavior remain active; this is not a claim that the full HTTP pipeline has the same metrics as the offline global comparator.

## Measured camera results

Owner approved124 filename labels, excluding3460370001. Before inspecting new results, froze93 development/31 holdout. Exactly545 same-profile front-or-thumb references and124 queries completed real Chromium WASM inference successfully. One development SKU3687070001 is absent from the reference snapshot; it remains in the denominator. All124 query byte hashes differ from the reference images, but independent capture-session provenance is unavailable.

| Split / configuration | Top1 | Recall@10 | Retrieval Recall@50 | MRR@10 |
|---|---:|---:|---:|---:|
| Development global | 58/93 (62.37%) | 78/93 (83.87%) | 88/93 (94.62%) | 0.6896 |
| Development +holes | 54/93 (58.06%) | 75/93 (80.65%) | 88/93 (94.62%) | 0.6502 |
| Development +contour | 54/93 (58.06%) | 75/93 (80.65%) | 88/93 (94.62%) | 0.6520 |
| Development +patch | 54/93 (58.06%) | 75/93 (80.65%) | 88/93 (94.62%) | 0.6520 |
| Holdout global, frozen selection | 20/31 (64.52%) | 29/31 (93.55%) | 31/31 (100%) | 0.7278 |
| Holdout each geometry variant | 20/31 (64.52%) | 29/31 (93.55%) | 31/31 (100%) | 0.7278 |

Global was selected from development before holdout inference, with source/configuration hashes frozen in `evidence/M22-holdout-freeze.json`. Hashes remained unchanged after the final run. Four predeclared diagnostic variants were evaluated; no post-holdout tuning occurred. This is a configuration comparison, not a weight-search experiment.

Bootstrap95% intervals (1000 iterations, seed6): global development Top1 52.69–70.99%; holdout Top1 48.39–80.65%, Recall@10 83.87–100%. The31-image result is uncertain; do not generalize100% Recall@50 to all cameras. Reliable masks: development7/93, holdout0/31, references462/545. Equal holdout geometry metrics reflect unavailable evidence, not proof those verifiers are effective. Global UI guidance flags88/93 development and31/31 holdout for review; suggestions are not accepted identities. Unknown negatives=0, so false-accept rate is unmeasurable, not0%.

Observed global latency development p50/p95=1347/2898ms; holdout=775/1593ms. These combine actual WASM inference (including optional descriptors) and local Node exact ranking, with model warmup/concurrent-job effects. They are not HTTP/staging/WebGPU/mobile p95 or isolated per-feature costs. Reference inference resumed from308 hash-checked records; the encoder/profile was unchanged, with compact atomic snapshot writes replacing the original writer.

## Retrieval and decision

Local pgvector0.8.7 halfvec384 HNSW (`ef_search=100`) versus exact,545 references/93 development queries: mean Top50 overlap99.9785%, minimum98%, all50 results returned, index plan verified. This tests approximation of exact results, not recognition accuracy or production ANN settings. Evidence: `evidence/M22-local-ann.json`.

Development has5 retrieval misses and30 global rerank misses among retrieved positives; holdout has0 retrieval misses and11 rerank misses. Poor masks and discrimination between similar candidates need development work. Geometry currently reduces development accuracy, so do not promote it based on synthetic tests. Further tuning must use development only; these31 holdout images have now been consumed and cannot serve as unseen validation for a changed algorithm.

## Remaining acceptance

M14/M15 real hard-negative benefit is unverified;57 queued cases still need curator verdicts. M16 real WebGPU budget, M18 approved multi-view/gray A/B, unknown-negative rejection, and lighting/session/part strata remain unmeasured. Owner explicitly skipped staging; this is not a staging pass. Proposed database migrations were tested locally only. No production writes/deploy, no release sign-off or commit.

Aggregate evidence is in `evidence/M22-development-summary.json` and `M22-holdout-summary.json`; private inference/prediction snapshots remain ignored and excluded from static output. Historical six-camera results include a subsequently excluded label and are not the baseline for this124-image comparison. See RELEASE_CHECKLIST.md for tests, Git, risks and rollback; DB_MIGRATION.md for data/profile/ACL restoration.

## Follow-up implementation of the development decision

`geometryVerification:false` now gates automatic image geometry in the orchestrator. The structural fallback receives no image geometry when disabled, preventing hole counts from re-entering ranking through another path. Explicit typed constraints still work. Three orchestrator regressions verify default vector ordering, explicitly configured experimental geometry, and typed hole constraints. No encoder, score weights or frozen benchmark inputs changed; no holdout rerun or tuning.

Development diagnosis (`evidence/M22-development-quality-audit.json`): all7 reliable-mask queries were globally Top1-correct; geometry reduced this to3/7. The86 unreliable-mask queries remained51/86 with or without geometry. There were0 gains and4 losses. Flags:86 subject-touches-edge,25 background-nonuniform. These machine flags are not human mask labels; loosening thresholds solely to admit more samples is not justified.

Readiness evidence (`evidence/M18-M16-readiness.json`): all545 catalogue rows are single-face, no verified symmetric row, no eligible mirrored query; assets comprise545 front and545 thumb. Local Chromium exposes WebGPU but returned no adapter. A thumb is not evidence of a back view, and browser API availability is not a device performance test.
