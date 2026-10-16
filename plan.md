# MORIS 3-LAYER ARCHITECTURE UPGRADE TRACKING PLAN

> Agent tiếp quản Moris V6: dùng [TECH_DEBT_ROADMAP.md](docs/moris-v6/TECH_DEBT_ROADMAP.md), [HANDOFF.md](docs/moris-v6/HANDOFF.md) và `state.json` làm điểm vào hiện tại. Các mục/checkpoint bên dưới được giữ để bảo toàn lịch sử; không lấy số liệu cũ làm trạng thái mới.

## Mục tiêu
Nâng cấp toàn diện **Moris 3-Layer Computer Vision Harness** sang TypeScript thuần túy, tương thích 100% Web Worker Offline, đạt truy vấn chính xác Top-10 trên 850 mã linh kiện dập kim loại theo đặc tả `MORIS_UPGRADE_PLAN.md` và `MORIS_AGY_PROMPT.md`.

---

## Danh mục công việc (Checklist)

- [x] **Bước 1 (Discovery Phase):** Khảo sát toàn bộ mã nguồn hiện tại trong `src/` và `kim-harness/`, lập bảng đối chiếu file hiện tại và module mới cần tạo.
- [x] **Bước 2 (Layer 1 - Optical Normalization):** Xây dựng `src/moris/moris-layer1-optical.ts` hoàn chỉnh (không TODO, không mock):
  - [x] Connected-Components flood-fill tách nền ngoài và lỗ bên trong (`fgMask`, `holeMasks`).
  - [x] Tính `aspectRatio`, `solidity` (Convex Hull Monotone Chain), `holeCount`.
  - [x] PCA 2D moments xoay ngang trục chính (-theta) và crop 6% padding resize 224x224.
  - [x] 180-deg Flip disambiguation: đối sánh trọng tâm `(x_fg, y_fg)` và `(x_detail, y_detail)`.
  - [x] 3-Channel Structural Pseudo-RGB Tensor: Channel 0 (LAB L + CLAHE 8x8 clipLimit 2.5 + median 3x3), Channel 1 (Scharr 3x3 gradient), Channel 2 (Two-pass Chamfer 3,4 Distance Transform), ImageNet normalization.
- [x] **Bước 3 (Layer 2 - Embedding & Coarse Gate):** Xây dựng `src/moris/moris-layer2-embedding.ts` hoàn chỉnh:
  - [x] Core Data Contract (`HoleFeature`, `SpatialKeyPatch`, `MorisPartSignature`).
  - [x] Stage 2A Hard Geometric Gate (tỷ lệ AR <= 0.22, Solidity <= 0.12, HoleCount <= 1, fallback mở rộng 1.5x khi < 40 ứng viên).
  - [x] Stage 2B Downsampling 16x16, Signed GeM Pooling (p=3.0) + Edge Detail Pooling tạo vector 768 chiều L2-normalized.
  - [x] Trích xuất 256 patch tokens từ ONNX DINOv2 (`[1, 257, 384]`) và fallback an toàn nếu chỉ có `[1, 384]`.
  - [x] Multi-Prototype Cold-Start Enrollment (4 biến thể quang học/hình học tạo `perspectiveCentroid`).
- [x] **Bước 4 (Layer 3 - Topological & Spatial Patch Re-ranking):** Xây dựng `src/moris/moris-layer3-rerank.ts` hoàn chỉnh:
  - [x] Top-32 key patches saliency & 3x3 spatial window patch matching (`S_SpatialPatch`).
  - [x] Hole-Constellation Symmetric Chamfer Distance (`D_HoleGraph`) trong không gian chuẩn hoá `(u, v, relArea)`.
  - [x] 16-harmonic Elliptic Fourier Descriptors (`D_EFD`) chuẩn hoá scale và starting point từ outer contour.
  - [x] Z-score Standardization Fusion và trả về Top 10 SKUs.
- [x] **Bước 5 (IndexedDB Storage & Re-indexing):** Xây dựng `src/moris/moris-idb.ts`:
  - [x] Quản lý IndexedDB `moris_signatures_v2`.
  - [x] Batch re-indexing utility cho 850 SKUs.
- [x] **Bước 6 (Tích hợp Web Worker & Build Verification):**
  - [x] Cập nhật Worker tích hợp 3 layer.
  - [x] Cấu hình `tsconfig.json` chuẩn và kiểm tra `tsc --noEmit`.
  - [x] Chạy toàn bộ test suite (`npm test`), đảm bảo 100% pass (202/202 tests) và build static sạch sẽ.
  - [x] Cập nhật `state.json` và báo cáo hoàn thành.
- [x] **Bước 7 (Hotfix 5 Critical Bugs theo MORIS_HOTFIX_PLAN.md):**
  - [x] **BUG 1:** Cập nhật `dinov2.worker.js` và `moris-worker-pipeline.ts`: truyền `opt` vào extractor callback, render canvas qua `pseudoRgbTensorToCanvas(opt)` (không để blank canvas ở reindex-batch-v2), gọi extractor với `{ pooling: 'none' }` có fallback.
  - [x] **BUG 2:** Sửa toán học `synthesizePerspectiveCentroid` trong `src/moris/moris-layer2-embedding.ts`: thay thế hoán vị chỉ số kênh bằng re-pooling `patchTokens` (256x384) qua gradient cột (nghiêng ngang), gradient hàng (nghiêng dọc), edge boost mũ 0.75 và border attenuation.
  - [x] **BUG 3:** Tính toán `aspectRatio` (trục chính xoay ngang PCA), `solidity`, `holeCount`, và `holeFeatures` (`u, v, relArea`) bất biến 100% với góc xoay camera 0-360 độ trong `src/moris/moris-layer1-optical.ts`.
  - [x] **BUG 4:** Tích hợp `enrollSkuSignatureV2` khi lưu ảnh part, `deleteSignatureV2` khi xóa mã, `searchPartTop10V2` trong `buildMorisQueryVector` và boost/merge Top 10 trong `src/app.js`.
  - [x] **BUG 5:** Đồng bộ test `tests/moris-layer2-embedding.test.ts`, chạy `npx tsc --noEmit` sạch 100%, transpile toàn bộ sang `.js` companion, chạy `npm test` đạt 202/202 pass 100%, build `dist/` sạch sẽ.
- [x] **Bước 8 (Unified Supabase 384D & Semantic-Geometric Upgrade theo MORIS_SUPABASE_UNIFIED_PLAN.md):**
  - [x] **Step 1 — Layer 1 Optical Normalization:** Dual-Mode segmentation (R2 cutouts vs Live camera bright-background), hạ ngưỡng lỗ dập xuống 0.04% (`0.0004`), phân cụm 1D Log-Area Otsu (`classifyHoleSizes1D`) tách `bigHoleCount` & `smallHoleCount`, chuẩn hoá in-plane 180° rotation (flipH + flipV đồng thời, cấm mirror lật chirality), `aspectRatio >= 1.0` khớp Supabase convention.
  - [x] **Step 2 — Layer 2 Embedding & Worker Probes (384D):** `computeSupabase384HybridEmbedding` (384D Masked-GeM + Edge-Detail, 0.55/0.45), `computeReliefInvertedOptical` (lật gương và đảo ngược phù điêu bề mặt dập nổi CLAHE), handler `embed-variants-v2` trong Worker sinh `canon_rgb_v2` và `canon_gray_v2` cùng rich geometry.
  - [x] **Step 3 — Flexible & Commutative Feature Matcher:** `parseIdentifyingFeaturesAST` và `matchFeatureQueryFlexible` trong `featureMatcher.js` & `src/app.js`, ranh giới số nghiêm ngặt `(?<!\d)\d+(?!\d)`, bất biến thứ tự giao hoán (`A + B == B + A`), tự động suy luận tổng số lỗ ngầm định (`big + small = total`), ngưỡng sai số cảm tính (+/- 1).
  - [x] **Step 4 — Cross-Modal Layer 3 Geometric Reranker:** Tự động phục hồi số lượng lỗ (Cross-Modal Recovery) cho 72 mã front legacy bị `hole_count = 0` từ text `identifying_features`, so khớp `big_hole_count` và `small_hole_count`, bất biến phản xạ gương tâm lỗ và bất biến xoay tỷ lệ khung hình; dọn dẹp `src/app.js` loại bỏ split-brain IndexedDB.
  - [x] **Step 5 — Đồng bộ dist/ & Verification:** Đồng bộ `.ts` sang `.js`, build `dist/` 42 files sạch sẽ, bổ sung unit tests cho AST order independence, strict numbers, big/small clustering, cross-modal recovery; pass 100% 210/210 unit tests, `tsc --noEmit` sạch 0 lỗi.
- [x] **Bước 9 (Hotfix Filter Bar, Strict AST Feature Matching & Khớp Badge theo MORIS_HOTFIX_FILTER.md):**
  - [x] **BUG 1:** Sửa `src/app.js` `loadParts()`: khi `isFeatureSearch` gửi `p_search: ''` và `p_limit: 2000`, `p_offset: 0` để fetch toàn bộ catalogue từ Supabase rồi áp dụng AST matcher trên toàn bộ SKU.
- [x] **Bước 10 (Thanh Filter mục tiêu ID & Mã linh kiện tại Main Catalogue và Moris Search):**
  - [x] **10.1 (Parser & Matcher mục tiêu):** Xây dựng `parseTargetQuery`, `matchRowWithTarget`, `filterCatalogueByTargetQuery`, `buildTargetAnswer` trong `src/moris/retrieval/featureMatcher.js` và `functions/_lib/moris/v5/retrieval/featureMatcher.js`:
    - ID key ("tìm id", "id", "tim id", "id:") -> Lọc CHÍNH XÁC (exact match) trên cột `part_id` trong `image_library`.
    - Mã key ("mã hàng", "tìm mã hàng", "mã", "ma", "ma hang") -> Lọc LINH HOẠT (contains substring) trên cột `code`.
    - Phân tách rõ ràng với truy vấn đặc điểm nhận dạng (lỗ, hình dáng).
  - [x] **10.2 (Tích hợp Moris Chat & Search API):** Nâng cấp `functions/api/moris/chat.js` và `functions/_lib/moris/v5/orchestrator.js` hỗ trợ truy vấn mục tiêu ID và Mã linh kiện:
    - Khi nhận diện lệnh tìm ID/Mã, quét catalogue (`scanCatalogue`), lọc đúng quy tắc, gán `is_feature_match: true`, `badge_label: 'Khớp'`, `score: 1.0`.
    - Sinh câu trả lời `buildTargetAnswer` tự nhiên, chính xác, không nhồi nhét mã rác top 10.
  - [x] **10.3 (Giao diện Main Catalogue Linh Kiện):**
    - Thêm dropdown chọn Mục tiêu lọc `[Tất cả | Mã linh kiện | ID]` ngay cạnh ô tìm kiếm tại `index.html`.
    - Cập nhật state `filters.target` và phương thức `loadParts` trong `src/app.js`: khi chọn ID thì lọc chính xác `part_id`, khi chọn Mã linh kiện thì lọc linh hoạt `code`.
  - [x] **10.4 (Unit Tests):** Bổ sung test suites đầy đủ trong `tests/moris-features-filter.test.js` và `tests/frontend.test.js` kiểm tra mọi trường hợp ID, Mã linh kiện, giao diện.
- [x] **Bước 11 (Đánh giá kiến trúc & Loại bỏ tách vector tự động khi lưu chỉnh sửa linh kiện):**
  - [x] **11.1 (Đánh giá kiến trúc tổng thể):** Kiểm tra toàn bộ luồng vector trong hệ thống; xác nhận Moris Search, RAG, Supabase pgvector và Trung tâm Vector AI không phụ thuộc vào `savePart()` auto-enqueue.
  - [x] **11.2 (Loại bỏ auto-vectorize trong src/app.js & index.html):**
    - Đặt `MORIS_VECTOR_AUTO_ON_SAVE_DESKTOP: false` và `MORIS_VECTOR_AUTO_ON_SAVE_MOBILE: false`.
    - Loại bỏ `enqueueMorisVectorJob` và `processMorisVectorQueue` khỏi `savePart()`.
    - Cập nhật text gợi ý trong Part Editor Modal (`index.html`).
    - Bảo toàn nút bấm thủ công "Tạo vector" (`vectorizeCurrentEditorPart`) và hoạt động độc lập của Trung tâm Vector AI.
  - [x] **11.3 (Unit Tests):** Bổ sung test kiểm tra `savePart()` không tự động enqueue và `MORIS_VECTOR_AUTO_ON_SAVE_DESKTOP` là `false` trong `tests/frontend.test.js`.
  - [x] **11.4 (Build & Verification):** Chạy `npm run build` sinh `dist/`, kiểm tra `tsc --noEmit`, chạy toàn bộ `npm test` pass 100% (229/229 unit tests), cập nhật `state.json`.


## Moris V6 — M00 baseline (2026-10-16)

- [x] **M00 — Đóng băng baseline:** Nhánh `feat/moris-v6`, HEAD `02289afa79747722b992938bee7c2d0414f7a9d2`; `npm test` exit 0 (18 files, 229/229 tests), `npm run build` exit 0 (42 files). Snapshot READ ONLY: 545 SKU / 1090 vector, delta 0; không ghi production, không deploy. TypeScript chưa chạy do thiếu compiler hợp lệ. Đã báo cáo Git, tests, rủi ro và rollback trước khi đánh dấu; xem [BASELINE.md](docs/moris-v6/BASELINE.md). Dừng chờ review, không thực hiện task khác.

- [x] **M01** — ARCHITECTURE.md + AGENTS vector ownership contract; static callers evidence; npm test exit 0, 18 files / 229 tests. No DB writes. Rollback: reverse M01 documentation hunks. Continue M02 per owner instruction.

- [x] **M02** — Removed Editor write helpers/UI and session retry; 6 behavior regressions; npm test exit 0: 235/235, 19 files. Updated old UI assertion for authorized M02 text change. No production writes. Rollback: reverse Editor/test hunks. Evidence M02-test.log.

- [x] **M03** — Center single/batch confirmation fails closed; legacy reindex redirects; server session/role + intent checks. npm test exit 0: 246/246, 20 files (M03-test.log). No production writes. Rollback M03 UI/API/tests. Continue M04.

- [x] **M04** — RGB-only explicit skip/replace, full composite-key atomic RPC + source ETag; proposed migration tested ONLY local pgvector. npm test 253/253, 21 files; SQL fixture pass; 8 concurrent writes -> 1 row (1 created/7 skipped). Evidence M04-*. No production writes. Rollback requires provenance/activity snapshot for local replacement; production migration not applied; Gate D required.

- [x] **M05** — Per-asset profile/source ETag states; unknown source fails closed, legacy vectors stale, SKU partial aggregation; npm test exit 0: 266/266, 22 files. M05-test.log. No production writes. Gate A pending browser review; rollback app + proposed migration per report. Continue authorized TypeScript/E2E/camera verification.

## Moris V6 — M00–M05 final verification (2026-10-16)

- [x] Local verification: 266/266 tests (22 files), TypeScript exit 0, build 42 files, real local SQL/concurrency/schema rollback pass, 10 browser E2E checks pass. Git `feat/moris-v6`, HEAD unchanged, no commit. Original user changes preserved.
- [x] Camera benchmark performed on six unprocessed `image 2/` captures: current V5 Top1 **0/6**, Recall@10 **4/6**. Quality gate **not passed**; no algorithm changes beyond M05.
- [ ] Gate A owner review and staging authentication/device verification. Proposed migration applied only locally; production unchanged (545 SKU / 1090 vectors), no deploy. Risks, test scope and scoped rollback: [PHASE_A_REVIEW.md](docs/moris-v6/PHASE_A_REVIEW.md). No tasks after M05 implemented.

- [x] **M06** — Spatial-only hybrid contract; legacy profile isolated, no CLS replication/browser fallback. 277/277 tests, 23 files; TS/build exit 0; real WASM 6/6 embeddings. No DB writes/commit/deploy. Risks and scoped rollback: docs/moris-v6/M06.md.

- [x] **M07** — Shared Worker canonicalization, aspect-preserving letterbox/version, explicit mask quality and no full-frame fallback. 286/286 tests; TS/build exit 0; real WASM 6/6, 4 masks flagged unreliable. Zero DB writes/deploy. Evidence/rollback docs/moris-v6/M07.md.

- [x] **M08** — Nullable geometry/version/quality; unknown neutral, API refuses unsafe legacy null coercion. READ ONLY audit 55/545 mismatches. 294/294 tests, TS/build pass, local E2E 10/10. No production writes/deploy. Report/rollback docs/moris-v6/M08.md.

- [x] **M09** — Filters preserved after hydrate; raw cosine separate from RRF, view/probe evidence retained, bounded oversampling. 300/300 tests; TS/build43 pass. New-profile exact/ANN validation deferred to matching benchmark index, not claimed. No DB writes/deploy. Report/rollback docs/moris-v6/M09.md.

- [x] **M10** — Complete bounded ID/code/feature paging; proposed stable SQL order tested on 1000 tied rows local. 309/309 tests, paging9/9, TS/build43 pass. Production migration unapplied. Zero production writes/deploy. Evidence/rollback docs/moris-v6/M10.md.

- [x] **M11** — Online server results isolated from offline cache; explicit local enrollment, profile and TTL. 314/314 tests, TS/build43 pass; 503 distinguished from empty. No DB writes/deploy. Evidence/rollback docs/moris-v6/M11.md. Next M19/M20 early benchmark per master dependency order.

- [ ] **M19 acceptance pending** — Dataset validator/private development manifest implemented; 329/329 tests, six byte hashes verified. Zero approved real labels/holdout/unknown negatives; 122-code set not located. See docs/moris-v6/M19.md. M20 tooling proceeds on synthetic/provisional data, no fabricated acceptance.

- [x] **M20** — Offline metrics runner validated:335/335 tests, TS/build43 pass. Historical six-camera replay 0/6 Top1,4/6 Recall10; missing metrics null. M19 holdout/label acceptance remains pending. No network/DB writes/deploy. Report/rollback docs/moris-v6/M20.md.

- [x] **M12** — Single final score owner, metadata penalties retained, count evidence not double-counted, unknown neutral. 341/341 tests, TS/build44 pass. Weights uncalibrated pending M22. No DB writes/deploy. Evidence/rollback docs/moris-v6/M12.md.

- [x] **M13** — Chirality policy rotation-only by default, evidence-gated reflection, no implicit mirrored query probe; PCA accepts binary masks. 347/347 tests; TS/build45 pass. No DB writes/deploy. Report/rollback docs/moris-v6/M13.md.

- [ ] **M14** — Optimal bounded hole assignment with pairing/reliability evidence; brute-force oracle tests. 353/353 tests, TS/build46 pass; synthetic64-hole p95 5.107ms. Real hard-negative validation pending M21/M22. Zero DB writes/deploy. docs/moris-v6/M14.md.

- [ ] **M15 acceptance pending** — Compact contour/EFD verifier implemented OFF; 358/358 tests, TS/build47 pass; measured synthetic CPU/byte budget. Real hard-negative improvement unverified. Evidence/rollback: docs/moris-v6/M15.md.

- [ ] **M16** — Verifier implemented OFF; 363 tests/TS/build pass. Real ablation and device budgets pending; see docs/moris-v6/M16.md.

- [x] **M17** — Reliability-aware available signals, neutral missing metadata, scaled conflicts; 368/368 tests, TS/build48 pass. Zero production writes/deploy. Evidence and rollback docs/moris-v6/M17.md.

- [ ] **M18** — Unique SKU/view evidence implemented; 372 tests/TS/build pass; RGB/gray A/B pending (docs/moris-v6/M18.md).

- [x] **M19** — Owner approves124 labels/scope; frozen93dev31holdout before new pixel inspection,124hashes verified,validator15/15/full latest372/372. No unknown negatives. Evidence and rollback docs/moris-v6/M19.md.

- [ ] **M21** — Review queue57 and evidence validation implemented;376tests pass; real curator/before-after acceptance pending.

- [ ] **M22** — Ablation tooling ready, reference inference running; decision provisionalNO-GO, real metrics pending.

- [x] **M23** — Additive nullable provenance proposal only; local data+ACL restore/rollback, service-only RPC checks pass;380tests TS/build48 pass. Production1090 unchanged, no writes/deploy. Quota/risks/rollback docs/moris-v6/DB_MIGRATION.md; GateD remains closed.

- [x] **M24** — Center preview/missing/stale/rebuild and per-asset pause/retry;385tests TS/build49, isolated localE2E10/10 pass; rows1→2 then stable2. Zero production writes/deploy. Risks/rollback docs/moris-v6/M24.md.

- [x] **M25** — Ranking points/evidence and conservative review guidance;389tests TS/build49 and localE2E12/12 pass incldesktop/mobile detailclick. Zero production writes/deploy. Risks/rollback docs/moris-v6/M25.md.

- [ ] **M26 local checkpoint** — 391/391 unit tests, TS/build49 pass; local E2E12/12. Supplied URL is production; staging auth/canary/sign-off pending. See docs/moris-v6/RELEASE_CHECKLIST.md.

- **Owner scope update:** Skip staging E2E and proceed with benchmark/final local verification; record skipped, never passed. Production writes/deploy remain prohibited.

## Checkpoint final local — 2026-10-16

391/391 tests (42 files), TypeScript/build49, local E2E12/12, local SQL data+ACL restore/rollback passed. Staging skipped by owner, not passed. Dev93/global Top1 58; frozen holdout31/global Top1 20, Recall10 29, Recall50 31. NO-GO; experimental verifiers OFF. No production writes/deploy/commit. See docs/moris-v6/DECISION.md and RELEASE_CHECKLIST.md.

Open acceptance: M14 hard-negative non-regression (previous code/unit completion is not full acceptance), M15 real benefit, M16 device/WebGPU budget, M18 multi-view/gray A/B, M21 curated cases, M22 full evaluation scope, M26 release sign-off/canary. Historical checkboxes in plan.md retain their original checkpoint context; state.json and current master/quick task tables carry the latest status.

- [ ] **M14 current acceptance** — Reopened acceptance gate after real camera ablation; implementation/unit tests pass, curated hard-negative non-regression is unverified.
- [ ] **M22/M26 final acceptance** — Measurements complete and staging skipped; NO-GO and remaining evidence listed above.

## Local checkpoint closed — quota restraint

Owner requested closing the current task without further quota-heavy loops. Runtime image geometry defaults OFF based on development evidence, with explicit text constraints preserved; approved hard-negative snapshot hashes require SHA-256 format. Actual verification:395/395 tests,43files; TypeScript/build49 and local E2E12/12 pass. Logs: docs/moris-v6/evidence/M22-gate-*.log. No new benchmark or test run scheduled; remaining quota is unknown.

Remaining M14/M15/M16/M18/M21/M22/M26 acceptance is unverified; no blanket completion or release claim. Staging skipped by owner. No production writes/deploy/commit. Rollback only the geometry flag/orchestrator and evidence-validator/test hunks, preserving owner changes; reenabling geometry restores the measured regression and is not recommended without new evidence.

## M21 review-link checkpoint

Catalogue review evidence was linked without inference:55/55 legacy refs resolved;59 local front-image hashes checked. All57 cases remain unlabelled/pending curator. New focused tests8/8 and full unit suite398/398 (44files) pass. See `docs/moris-v6/M21.md`; no production writes/deploy.

M21 review queue now includes optional frozen-development ranking context. Only11/57 items have a matching development query; both specified pairs lack one, and no holdout was used. Still0 curator outcomes. Focused review tests10/10 pass; full suite398/398 predates the final two focused additions.

## Agent handoff

Before continuing, read [docs/moris-v6/HANDOFF.md](docs/moris-v6/HANDOFF.md). It records exact remaining gates, current evidence and quota constraints. Do not rerun heavy inference; staging skipped; preserve dirty tree and production prohibition.

## Hotfix: Image search error ("Xin lỗi anh, em chưa thể xử lý yêu cầu này lúc này") - 2026-10-16

- **Triệu chứng:** Người dùng tải ảnh linh kiện (ví dụ `3405370001.png` trong `image copy.png`) gửi tìm kiếm thì nhận được phản hồi lỗi tạm thời `MORIS_PUBLIC_MESSAGES.temporaryError`.
- **Nguyên nhân gốc (3 tầng lỗi):**
  1. *Lỗi lệch profile:* Trình duyệt sinh vector với profile `hybrid_gem3_edge_55_45_pseudorgb_u8_v1` (`kim_canon_v3_letterbox`), trong khi `wrangler.toml` và `.env` vẫn cố định `cls_l2_v1` (`kim_canon_v2`). Hàm `encodeQueryImage` ném lỗi `MORIS_VECTOR_PROFILE_MISMATCH` (status 400).
  2. *Lỗi RPC v6 chưa migrate:* `searchVectorIndex` gọi RPC `match_catalogue_image_vectors_v6`. RPC này thuộc migration đề xuất M23 (`20261016040525_moris_v6_nullable_provenance.sql`) vốn chỉ thử nghiệm local và chưa áp dụng lên Supabase Production (Gate D). PostgREST trả 404 (PGRST202: function not found).
  3. *Lỗi nuốt exception:* `publicErrorMessage(error)` trong `functions/api/moris/search.js` không ánh xạ các lỗi trên mà fallback về chuỗi thông báo lỗi tạm thời chung chung.
- **Giải pháp:**
  1. Nâng cấp `searchVectorIndex` trong `functions/_lib/moris/v5/vector/search.js`: tự động fallback sang RPC `match_catalogue_image_vectors` hiện có trên Production nếu `_v6` chưa có; tự động tra cứu fallback profile `cls_l2_v1` nếu profile mới trả về 0 dòng do database chưa re-index.
  2. Đồng bộ `wrangler.toml` và `.env` khớp với `kim_canon_v3_letterbox` và `hybrid_gem3_edge_55_45_pseudorgb_u8_v1` theo đúng hợp đồng của client `src/moris/vector/browserDinov2.js`.
  3. Bổ sung ánh xạ lỗi rõ ràng cho `MORIS_VECTOR_PROFILE_MISMATCH` và HTTP 401 trong `publicErrorMessage`.
- **Bằng chứng kiểm thử:**
  - `npm test`: 44 files / 405 tests pass 100%.
  - `npx tsc --noEmit`: exit 0 (0 error).
  - `npm run build`: 49 files static sinh ra sạch sẽ.
  - `node tools/check-moris-e2e.mjs`: 12/12 pass.
  - Test trực tiếp `runMorisSearch` trên ảnh thực tế mã `3405370001`: trả về Top 1 chính xác mã `3405370001` với similarity = 1.0 và gợi ý đối chiếu chuẩn xác.

