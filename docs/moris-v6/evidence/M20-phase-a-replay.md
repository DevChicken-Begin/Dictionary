# Moris V6 offline evaluation

Queries: 6; known: 6; unknown: 0.
Dataset SHA256: eded8ebfcf6197cce09a78aff42a60bf5686316359467c152acade55ca58feb8
Snapshot SHA256: b7cc293552ac7917265e98a9a79a139fea25f7eab43dc06cb0d4cee4143add64
Commit: 02289afa79747722b992938bee7c2d0414f7a9d2; dirty tree: true.

Profile: {"model":"onnx-community/dinov2-small","modelVersion":"ef1fb10","preprocessVersion":"kim_canon_v2","profile":"cls_l2_v1","dimension":384,"topK":60,"resolverK":10,"minSimilarity":0.55}
Algorithm: Phase A historical V5 orchestrator, unchanged snapshot; not current V6; latency scope: orchestrator search only; excludes inference; read-only RPC plus snapshot hydration.

| Metric | Measured value |
|---|---|
| top1 | 0 |
| recall10 | 0.6666666666666666 |
| recall50 | Not measured |
| recall50_measured_n | 0 |
| mrr10 | 0.18353174603174602 |
| unknown_false_accept | Not measured |
| abstain_rate | Not measured |
| decision_measured_n | 0 |
| known_abstain_rate | Not measured |
| retrieval_misses | Not measured |
| rerank_misses | Not measured |
| latency_p50_ms | 126 |
| latency_p95_ms | 171.25 |
| latency_measured_n | 6 |

Top1/recall measure ranking independent of abstention; false-accept uses the explicit saved acceptance decision. Recall@50 requires complete requested Top50 retrieval evidence for every known query. Missing fields remain unmeasured, never zero.
Bootstrap CI is omitted below 30 known queries; related captures can still invalidate independence. Stratified source categories are retained in JSON.

**Provisional development labels: not a release accuracy claim.**
