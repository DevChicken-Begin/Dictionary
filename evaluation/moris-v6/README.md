# Moris V6 evaluation data

## Ground truth and privacy

Keep real images, candidate snapshots and internal manifests in `private/` (ignored), or an owner-approved external directory. Commit only synthetic examples, validation code and aggregate reports. No credential-bearing URLs or absolute asset paths in manifests. No index writes are needed for validation or offline evaluation.

The owner approved **124 camera images and all remaining filename SKU labels**, replacing the originally requested122 scope. Exclude incorrect `3460370001`; preserve the original file. Private manifest `private/camera124-v1.jsonl` has 124 byte-verified images (all approved), 93 development /31 holdout, SHA256 `128f2d9a7c0ec6fc4ee73109df48dc93232eb2e67cc5a351855c241620f89a1a`.

Split was frozen before inspecting new pixels or metrics: order previously unseen SKUs by SHA256(`moris-v6-owner124-split-v1:` + SKU), take first31 for holdout. All five eligible previously-used SKUs remain development. Source groups are SKU families; capture-session, view, lighting and angle strata are unknown. This is SKU-separated holdout, not proof of independent camera-session sampling. No unknown negatives were supplied, so false-accept rate remains unmeasurable. Keep cutouts in `image/` separate from raw camera evaluation.

Old six-image reports/manifests remain historical snapshots; two current filenames have changed image bytes and must never silently replace the old benchmark inputs.

## Data dictionary (JSONL, one query per line)

| Field | Meaning |
|---|---|
| `query_id`, `sha256` | Unique stable query ID and SHA256 of original image bytes |
| `expected_sku`, `known` | Known SKU label; unknown examples use `null` and `false` |
| `asset_path` | Relative path resolved under an explicitly supplied private asset root |
| `source_kind` | `same_asset`, `cross_view`, `camera`, or explicitly `synthetic` |
| `source_group`, `physical_shot_id` | Capture/source family and original physical exposure; transformed siblings share the shot ID |
| `split` | `development` or `holdout`; entire related groups stay in one split |
| `label_status` | `approved`, `filename_pending`, or `synthetic`; approved requires `curator`/`labelled_at` |
| `view`, `lighting`, `angle` | Observed/curated strata; use literal `unknown` when not established |
| `hole_count_label`, `mask_label` | Optional curator evidence; omit rather than infer from algorithm output |

`manifest.example.jsonl` is a schema example with a placeholder synthetic image hash, not a real measurement. Validate structure with `node tools/validate-moris-dataset.mjs evaluation/moris-v6/manifest.example.jsonl`. Add an asset-root argument to verify all actual bytes; `--approved` rejects provisional real labels.

## Freeze and leakage policy

Curator confirms labels and groups before locking a holdout manifest hash. Record that hash, capture provenance, algorithm/config revision and candidate snapshot hash in every evaluation. Never tune on holdout or rename viewed development captures into holdout. Duplicate hashes, repeated IDs and source/physical-shot groups across splits are errors. Keep catalogue/self-match and cross-view metrics separate from true camera results. A split change requires a new reviewed manifest/hash; retain the old report.

The original six-image development manifest remains frozen for historical reproducibility. The owner-approved124 manifest supersedes its scope for current evaluation. Unknown negatives and curated hard-negative image evidence remain necessary for complete M21/M22 release evidence.

## Offline evaluation CLI

```sh
node tools/evaluate-moris-v6.mjs MANIFEST.jsonl SNAPSHOT.json OUTPUT_PREFIX
# Provisional development replay only:
node tools/evaluate-moris-v6.mjs MANIFEST.jsonl SNAPSHOT.json OUTPUT_PREFIX --allow-provisional
```

Snapshot fields: `profile`, `algorithm`, `latency_scope`, optional original `created_at`, and `predictions`. Each prediction has `query_id`, original `sha256`, ranked unique `candidates` (SKU strings or `{sku, score}` objects), `accepted` (boolean when measured; null when not recorded), `latency_ms` (measured number or null). Optional `retrieval_candidates`, `retrieval_k >= 50`, `retrieval_complete: true` permit Recall@50. Never pretend final Top10 is the retrieval Top50 snapshot.

Top1/Recall/MRR use known queries only and measure candidate ranking independently of acceptance. Unknown false-accept requires actual saved decisions for all unknown examples. Missing measurements are null. Retrieval misses require Top50 evidence; rerank misses count queries retrieved in Top50 but absent from final Top1. Latency p50/p95 use linear interpolation over observed values and retain sample count/scope; six samples cannot establish production p95. Seeded percentile bootstrap is omitted below 30 known samples; capture correlation still requires a grouped study before release claims.

Reports include dataset/snapshot SHA256, evaluator hash, Git SHA, tracked diff hash/dirty status, parameters, source strata and timestamp. They never write vectors or call model/network. Keep raw snapshots private. Replay reports must name the snapshot's original algorithm/profile, not imply current source generated old results. M22 must add lighting/part/view stratified analysis when curated strata exist.
