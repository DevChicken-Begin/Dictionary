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

## Hotfix: Vector Center RPC fallback (`kim_write_catalogue_vector_v6_provenance` -> `kim_upsert_catalogue_image_vector`) - 2026-10-16

- **Triệu chứng:** Khi người dùng bấm tạo/cập nhật vector trong Trung tâm Vector AI (`tools/moris-vector-center.html`), toàn bộ ảnh báo lỗi:
  `failed — Could not find the function public.kim_write_catalogue_vector_v6_provenance(p_mode, p_vector) in the schema cache`.
- **Nguyên nhân gốc:** Migration M23 (`20261016040525_moris_v6_nullable_provenance.sql`) chứa hàm `kim_write_catalogue_vector_v6_provenance` chỉ mới chạy trên môi trường test local Docker, chưa chạy trên Supabase Production theo nguyên tắc Gatekeeper Hiến pháp. Supabase Production hiện tại chỉ có RPC `kim_upsert_catalogue_image_vector`.
- **Giải pháp:**
  1. Thêm cơ chế fallback trong `functions/api/moris/vector-upsert.js`: khi RPC `kim_write_catalogue_vector_v6_provenance` trả về lỗi không tìm thấy hàm (`schema cache` / `PGRST202`), tự động chuyển sang gọi RPC `kim_upsert_catalogue_image_vector` sẵn có trên Production với đầy đủ metadata hình học (`hole_count`, `aspect_ratio`, `hole_centroids`, `quality_score`, `embedding_profile`).
  2. Bổ sung unit test trong `tests/moris-manual-upsert.test.js` xác nhận luồng fallback hoạt động trơn tru.
- **Bằng chứng kiểm thử:**
  - `npm test`: 44 files / 406 tests pass 100%.
  - `npx tsc --noEmit`: exit 0.
  - `npm run build`: 49 files static sinh ra sạch sẽ.
  - `node tools/check-moris-e2e.mjs`: 12/12 pass.

## Review kiến trúc Moris & cơ sở nghiên cứu phân biệt kích thước — 2026-10-17

- [x] **Review toàn bộ kiến trúc vận hành Moris** (đường ghi Vector Center, đường đọc chat text, đường đọc ảnh 3 lớp, hợp đồng profile/geometry/DB RPC) và **viết tài liệu `pipeline_moris.md`** làm cơ sở cho bài nghiên cứu.
- **Kết luận gốc:** pipeline bất biến tỉ lệ theo thiết kế (crop sát vật thể + letterbox 224×224, toạ độ lỗ chuẩn hoá, aspect ratio tỉ số) nên **không thể phân biệt hai mã cùng hình dạng khác kích thước**; DB không có cột kích thước mm; ảnh `image 2/` không có vật chuẩn tỉ lệ.
- **Đề xuất trọng tâm trong tài liệu:** Tầng 0 "Size Gate" — neo tỉ lệ bằng thẻ in 4 marker + đo mm vật thể + bảng `catalogue_part_dimensions` (proposal, chờ Gate D) + lọc dung sai trước rerank; kèm lộ trình P0–P5, bộ metric size-pair/unknown-negative và 8 câu hỏi mở cần chủ dự án xác nhận.
- Không thay đổi mã nguồn/runtime/migration/deploy trong lần review này; dirty tree và branch `feat/moris-v6` được giữ nguyên. Chi tiết: [pipeline_moris.md](pipeline_moris.md).

## Subject Locking, Mask Purity & Size Contract — đề xuất M27/M28 (2026-10-17)

- [x] **Bổ sung Phần 10 vào [pipeline_moris.md](pipeline_moris.md)** theo làm rõ của chủ dự án: (10.1) Subject Locking 5 lớp phòng thủ chống bóng đổ/lem nền/vật dư/chói + điều kiện readiness trước khi chốt khóa; (10.2) tái tạo chủ thể deterministic (matte + nền hằng số, làm phẳng chiếu sáng, fill chói kênh L/edge, validate lỗ) — cấm generative inpainting, ràng buộc `kim_canon_v4_*` + re-index qua Vector Center (Gate D); (10.3) Size Contract cặp `(length_mm, width_mm)` theo trục PCA (`L ≥ W`, bất biến hướng, hình vuông không special case, metric đối xứng có hoán vị); (10.4) phân kỳ an toàn S1 (không re-index) / S2 (đổi canonicalization); (10.5) bộ bằng chứng cần thu (mask IoU, size-pair, test-retest px/mm); (10.6) định nghĩa đề xuất M27/M28; (10.7) câu hỏi mở Q9–Q11. Cập nhật đồng bộ bảng proposal 5.3 (`length_mm/width_mm`) và thuật toán 5.4.
- [x] **M27 — Subject Locking & Mask Purity (S1):** tap-to-lock + readiness + classifier bóng đổ/chói + voting đa khung trong camera modal; giữ nguyên canonicalization, không re-index; exit evidence: focused tests + mask IoU/reliable rate. **Đã triển khai 2026-10-17 — xem mục "M27 — Subject Locking & Mask Purity (P1.3)" cuối file** (S1; còn đo ảnh thật ở pilot).
- [x] **M28 — Size Contract & Size Gate (S1→S2):** chuẩn hoá cặp `(length_mm, width_mm)`, gate dung sai 2 tầng + UI nhập size; S2 gắn version canonicalization mới + re-index qua Vector Center.** Đã triển khai S1 2026-10-17 — xem mục "M28 — Size Contract & Size Gate (P1.4)" cuối file.**
- Ràng buộc chung của hai đề xuất: không đụng production/re-index/runtime; phụ thuộc câu trả lời Q1–Q11; bộ dữ liệu camera mới phải đóng băng manifest trước khi đo (theo M19/TECH_DEBT_ROADMAP).

## Nghiệp vụ sai hình dạng lỗ, đa ảnh catalogue & dung lượng R2 (2026-10-17)

- [x] **Bổ sung Phần 11 vào [pipeline_moris.md](pipeline_moris.md):** ca mẫu 3421750001 (5 lỗ tròn) vs 3421760001 (4 lỗ + 1 lỗ vuông) bị tìm nhầm khi chụp 1 tấm từ trên xuống; ghi nhận **B13** (không có phân loại hình dạng lỗ từ ảnh — chỉ có regex text metadata); kiểm kê hạ tầng đa ảnh đã có sẵn (image_assets thumb/front/back/detail/compare, Vector Center xử lý từng asset, multi-probe cap 3, M18 SKU pooling); đánh giá 3 mức giá trị của back + 2 detail kèm cảnh báo fairness coverage; phân tích R2 900 mã × 4–5 ảnh ≈ 0.75–1.3GB với nén WebP hiện có (an toàn dưới 10GB; ảnh gốc 3–5MB sẽ vượt 10.8–18GB); bổ sung Q12–Q15.
- [x] **Xác minh read-only asset/vector của 3421750001 và 3421760001** (asset_type + has_vector) và mâu thuẫn M18-snapshot (chỉ front/thumb) — đã xác minh bằng PostgREST read-only 2026-10-17: 3421750001 = thumb+front+back+detail×2 (7 vector rows); 3421760001 = thumb+front (4 vector rows) → multi-view có nhưng chưa đồng đều.
- [ ] **Bổ sung bộ hard-negative cặp mẫu** (ảnh thật nhiều góc: top-down xa, nghiêng, cận cảnh lỗ) + ablation multi-view (front-only vs +detail vs +back) vào kế hoạch M21 khi được cấp quota.
- [x] **Cập nhật phạm vi M27:** thêm "hole-shape evidence" (phân loại tròn/vuông/oval từ mask) — đã đồng bộ pipeline_moris.md §10.6 và state.json; đã triển khai trong `src/moris/capture-subject-lock.js` (DFT radial k=2/k=4) 2026-10-17.


## Chốt chuẩn 5 ảnh/mã, xác minh thay ảnh R2 & kế hoạch thực thi chi tiết — 2026-10-17

- [x] **Chốt chuẩn dữ liệu với chủ dự án:** tối đa **5 asset/mã = thumb + front + back + 2 detail** (tối thiểu thực dụng 4: front+back+2 detail; thumb tự sinh từ front); yêu cầu **thay ảnh phải xoá object R2 cũ**, không ghi chồng thêm.
- [x] **Xác minh code hành vi thay ảnh (phát hiện B14/B15):** hiện CHƯA đúng — `savePart` (`src/app.js:1889`) → `mergeAsset` (`:1883`) → `app_replace_part_assets` (`:1945`) chỉ đổi đường dẫn DB; object R2 cũ theo `uploadId` **không bị xoá** (không có `CATALOGUE_BUCKET.delete` trong luồng upload/save; chỉ `bulk-delete.js:81-93` và `delete-all.js` purge). `delete-part.js` (xoá 1 mã) cũng không purge R2. → Ghi B14/B15 vào `pipeline_moris.md` §4/§11.4.
- [x] **Chốt toán dung lượng 4.500 ảnh:** 900 × 5 = 4.500 ảnh nén WebP ≈ **0.8–1.3GB — KHÔNG vượt 10GB** (ngưỡng ~2.2–2.4MB/ảnh trung bình); chỉ vượt nếu upload ảnh gốc 3–5MB (13.5–22.5GB). Số thật chốt bằng pilot đo dung lượng.
- [x] **Bổ sung Phần 12 [pipeline_moris.md](pipeline_moris.md):** kế hoạch thực thi chi tiết cho phiên sau — 12.1 quyết định đã chốt; 12.2 chương trình milestone; 12.3 thứ tự P0–P3; 12.4 exit evidence & rollback; 12.5 việc KHÔNG làm.
- [ ] **[ĐỀ XUẤT] M29 — Multi-view & Capture Enrichment (S1):** chuẩn 5 ảnh, index back/detail qua Vector Center, probe cap 3→5 có test, câu hỏi phân biệt tự động, fairness rule. Blocker: Q12/Q14 + xác minh 2 mã + M18 acceptance.
- [ ] **[ĐỀ XUẤT] M30 — Asset Lifecycle & R2 Hygiene:** sửa B14 (xoá object cũ khi replace) + B15 (purge R2 khi xoá 1 mã), audit orphan, quota monitor. Blocker: duyệt phạm vi P0.
- [ ] **P0 — chủ dự án (làm trước phiên sau):** trả lời Q1–Q15; xác minh read-only asset/vector 3421750001 & 3421760001 trên Trang Trung tâm Vector AI (asset_type + has_vector) để chốt mâu thuẫn M18 snapshot; duyệt phạm vi M30.
- [ ] **P1 — code S1 (phiên sau):** M30 fix R2 lifecycle (focused tests) → pilot 20 mã chuẩn 5 ảnh (đo dung lượng WebP thật + index Vector Center front/back/detail) → M27 (subject locking + readiness + hole-shape evidence) → M28 (size UI + gate 2 tầng phía query, fail-open).
- [ ] **P2 — đo lường:** EVAL đóng băng dataset (mask IoU, hole-shape accuracy, size-pair + cặp 3421750001/3421760001 hard-negative, unknown negatives, ablation multi-view) theo quota HANDOFF.
- [ ] **P3 — gated:** S2 re-canonicalization `kim_canon_v4_*` + re-index 4.500 vector + A/B (chỉ sau Gate D + owner duyệt).
- [x] **Prompt khởi động phiên mới:** tạo `docs/moris-v6/SESSION_BOOT_PROMPT.md` — agent mới dán nguyên khối PROMPT là vào dự án nhanh, chính xác, không cần đọc lại toàn bộ codebase.
- [x] **Đồng bộ HANDOFF.md + push main (2026-10-17):** sửa phần "Git và checkpoint" theo trạng thái thực tế (main, commit nền 2657b49, file owner xoá đọc qua `git show 2657b49:`); cập nhật `SESSION_BOOT_PROMPT.md` hậu push; `npm test` 44 files/406 tests pass + `tsc` exit 0; commit và push toàn bộ lên `main` theo yêu cầu chủ dự án.

## M30 — Asset Lifecycle & R2 Hygiene (P1.1) — 2026-10-17

- [x] **P0 chốt với chủ dự án (2026-10-17):** duyệt M30 triển khai ngay; Q1–Q14 đã trả lời — Q1 ERP chưa có trường kích thước, hướng phát triển chỉ thêm **dài + rộng** (KHÔNG thêm dày); Q2 không có quy tắc chữ số mã hoá size; Q3 bắt buộc thẻ chuẩn cho ảnh mới; Q4 cả hai Case A + B (chủ dự án sẽ gửi cặp mã mẫu sau); Q5 dung sai ≤ 5% toàn cục; Q6 chỉ dài × rộng; Q7 có nhân lực đo kẹp nhưng chậm; Q8 chấp nhận trạng thái trung tính; Q9 chốt quy ước PCA `L ≥ W`; Q10 chốt tap-to-lock; Q11 S1 trước — quyết S2 sau A/B; Q12 đủ 5 ảnh toàn bộ 900 mã; Q13 **KHÔNG** nâng probe cap 3→5 (giữ 1 ảnh front); Q14 chờ pilot 20 mã trước khi index hàng loạt.
- [x] **P0.2 xác minh read-only production (PostgREST service role, không ghi):** 3421750001 = thumb+front+back+detail×2 (7 vector rows); 3421760001 = chỉ thumb+front (4 vector rows) → chốt mâu thuẫn M18 snapshot: multi-view đã có nhưng **chưa đồng đều**, theo fairness §11.3 chưa đưa vào ranking.
- [x] **M30 — sửa B14 (thay ảnh xoá object R2 cũ):** endpoint mới `functions/api/catalogue/purge-assets.js` (admin-only, validate key đúng định dạng asset catalogue chống path traversal, fail-closed — chỉ xoá key không còn tham chiếu trong `image_assets`/`image_library`) + `src/app.js` `savePart` thu `replacedPaths` (gồm thumb tự sinh khi upload front) trước khi merge và purge sau khi `app_replace_part_assets` thành công; dọn `uploadedPaths` best-effort khi save lỗi giữa chừng; helper `purgeR2Assets` không chặn luồng lưu.
- [x] **M30 — sửa B15 (xoá 1 mã purge R2 đối xứng bulk-delete):** `functions/api/catalogue/delete-part.js` thu r2 keys (`image_assets` + `image_library`) TRƯỚC khi gọi `app_delete_part`, purge R2 sau khi DB xoá thành công, trả thêm `r2_deleted_keys_count`; không purge nếu RPC xoá thất bại.
- [x] **Bằng chứng kiểm thử (không hardcode số):** focused `npx vitest run tests/catalogue-delete.test.js tests/moris-editor-no-index.test.js` → **2 files / 26 tests pass** (6 test purge-assets: 401/403/400 path traversal/503/bỏ key còn tham chiếu/fail-closed; 2 test delete-part purge; cập nhật assertion M02: savePart chỉ gọi API `/api/catalogue/purge-assets`, không vector/model). Full `npm test` → **44 files / 414 tests pass 100%** (trước M30: 406). `npx tsc --noEmit` exit 0. `npm run build` 49 files exit 0. Production writes 0; chưa deploy; chưa commit.
- [x] **M30 — audit orphan R2 + quota monitor (2026-10-17, read-only):** xác minh `CLOUDFLARE_API_TOKEN` trong `.env` HỢP LỆ (verify OK) — chỉ thiếu `CLOUDFLARE_ACCOUNT_ID` (để trống), tự resolve qua `GET /accounts` = `06783fecdbfbfab470cc1a70c31ab53e`; tool mới `tools/r2-audit.mjs` (chỉ đọc). Kết quả bucket `catalogue-images`: **1546 objects / 42.84MB**; DB refs: `image_assets` 1093 path + `image_library` 545 (tập con), **missing = 0**; **orphan 453 objects / 12.02MB** (front 186, thumb 185, `parts/` legacy 77, back 4, detail 1). Báo cáo: `/tmp/opencode/r2-audit-report.json`.
- [x] **M30 — purge orphan R2 ĐÃ THỰC THI (2026-10-17, chủ dự án duyệt):** tool mới `tools/r2-purge-orphans.mjs` (fail-closed: re-đọc DB refs trước từng delete, `KEEP_PREFIXES=['parts/']`, `MAX_TARGETS=500`, `MAX_BYTES=20MB`, dry-run mặc định, `--execute` mới ghi, `--log`). Dry-run: `targets=376 bytes=11141715 by_type={back 4, detail 1, front 186, thumb 185}` (giữ 77 object `parts/`). Execute: **deleted 376/376, 0 lỗi, 11.14MB**; log `/tmp/opencode/r2-purge-log.json`. Re-audit: bucket còn **1170 objects / 32.22MB**, orphan còn **77 (chỉ `parts/`)**, missing = 0. Production writes: 376 (đã được duyệt); chưa deploy; chưa commit.
- [ ] **M30 còn lại — 77 object legacy `parts/`:** giữ nguyên theo quyết định purge; nếu muốn xoá thì mở rộng `KEEP_PREFIXES`/pattern riêng khi chủ dự án duyệt.
- [ ] **P1.2 tiếp theo:** pilot 20 mã chuẩn 5 ảnh (đo dung lượng WebP thật thay ước lượng §11.4, index front/back/detail qua Vector Center, đọc lại listing xác nhận; ảnh chụp theo thẻ chuẩn 4 marker) — cần ảnh thật của chủ dự án; sau pilot: đo mask IoU/lỗ + **size-pair precision của M28** trong điều kiện vận hành.

## M27 — Subject Locking & Mask Purity (P1.3) — 2026-10-17

- [x] **Q4 — nhận 3 cặp mã mẫu hard-negative (ảnh trong `image 2/`, 129 file):** (1) `3446950001` (4 lỗ tròn + 1 lỗ vuông) vs `3446960001` (5 lỗ tròn) — khác định dạng lỗ; (2) `3440010001` vs `3889630101` — khác số lỗ + kích thước chuẩn; (3) `3400530401` vs `3462530001` — khác vị trí đục lỗ. Dùng cho EVAL/M21 + kiểm chứng hole-shape evidence trên ảnh thật ở pilot; không dùng lại làm holdout tuning.
- [x] **Module mới `src/moris/capture-subject-lock.js` (subject_lock_v1, pure TypedArray, DOM-free):** background estimation; classifier bóng đổ ("nền × hệ số tối" theo lumaRatio + dist cap, kiểm tra trước nhánh part) và chói (vùng sáng kín trong thân, không liên thông biên — không tính là lỗ); component labeling + tap-to-lock seed (fallback component lớn nhất); `extractEnclosedHoles` + `classifyHoleShape` bằng DFT radial k=2/k=4 (bất biến xoay: vuông→A4, oval→A2, tròn→profile phẳng, unknown khi nghi ngờ); `voteMasks` đa khung (majority + agreement); `laplacianVariance`; `computeReadiness` 5 điều kiện + guidance tiếng Việt; `maskIoU`/`scaleMaskNN`/`maskToRgba`.
- [x] **Tích hợp camera modal:** `index.html` — `@click="handleCameraTap"` trên video + marker seed, panel readiness 5 chips (Trong khung/Một vật/Ổn định/Ít chói/Đủ nét) + guidance trực tiếp, hint cập nhật; `src/app.js` — CONFIG `MORIS_CAMERA_SUBJECT_LOCK_ENABLED` + module URL (build-static thêm `PUBLIC_MORIS_SUBJECT_LOCK_MODULE_URL`), `handleCameraTap` (quy đổi object-fit cover + crop 1000:410 → seed chuẩn hoá), `_sampleCameraLockFrame` (poll 450ms, canvas ≤500px, stability bằng IoU ≥ 0.92, voting tối đa 4 mẫu), `buildSubjectMaskDataUrl` (mask capture-scale + hole evidence + `camera.lock.evidence` + `moris.captureEvidence`, fallback mask cũ khi lỗi/tắt), scanStatus hiển thị "Lỗ: n tròn • n vuông • n oval".
- [x] **Bằng chứng kiểm thử:** focused `npx vitest run tests/moris-capture-subject-lock.test.js` → **17/17 pass**, gồm eval tổng hợp 4 cảnh gán nhãn: **mean mask IoU = 1.0000; hole-shape accuracy = 100.0% (10/10)**; bất biến xoay (vuông 30°, oval 40°); bóng đổ contamination = 0; chói không tạo lỗ giả; voting loại vật nhấp nháy; chạm biên → guidance "lùi máy". Full `npm test` → **45 files / 431 tests pass 100%** (trước M27: 414). `npx tsc --noEmit` exit 0. `npm run build` 50 files exit 0. Production writes 0; chưa deploy; chưa commit.
- [x] **Đo trên ảnh thật `image 2/` (2026-10-17):** tool mới `tools/png-decode.mjs` (decoder PNG 8-bit RGB/RGBA thuần Node+zlib, không dependency; `tests/png-decode.test.js` 4/4) + `tools/eval-m27-real-photos.mjs` (harness camera/cutout, composite nền trắng, alpha-GT, đối chiếu `identifying_features`). **Phát hiện:** 125 file là ảnh camera THÔ (124 nhãn + `3460370001` chủ dự án loại trừ giữ nguyên) + 4 file mới ĐÃ XỬ LÝ NỀN (cutout alpha trong suốt: `3400530401`, `3446950001`, `3446960001`, `3462530001`) — khớp lời chủ dự án (125 mã gốc + 4 mã mới). **Camera 124 ảnh:** selected 124/124, coverage median 0.348, holes median 7 (giảm 6.7x nhờ hardening), check fails: inFrame 115 / singleSubject 6 / lowSpecular 2 / sharp 0 (ảnh thô chưa chụp theo thẻ chuẩn nên fail margin/coverage theo thiết kế UI). **Cutout 4 ảnh:** alphaIoU mean 0.9378 / min 0.9235; chữ ký lỗ từ alpha: `3446950001` = 3 tròn + 1 vuông + 1 oval (khớp "4 tròn + 1 vuông", 1 tròn bị phối cảnh thành oval), `3446960001` = 4 tròn + 1 oval (khớp "5 tròn"), `3400530401` (8 lỗ) vs `3462530001` (9 lỗ) khác vị trí rõ — khớp mô tả cặp Q4. **21 mã có nhãn `identifying_features`:** vuông |Δ| 0.43; tròn/oval lệch do phối cảnh (bias "rounded" −25/148) → bằng chứng hình dạng là heuristic, quyết định dùng cho ranking ở EVAL/M21. Report: `/tmp/opencode/m27-real-photos-final.json`.
- [x] **Hardening từ ảnh thật:** `closeMask` (closing 3×3 ×1 vòng, lấp khe nứt ≤2px) áp trong `analyzeFrame`; `holeMinAreaFrac` 0.0004 (ngưỡng lỗ theo diện tích chủ thể); gate `fill ≥ 0.4` + `bw,bh ≥ 3`; trần profile `A2 ≤ 0.55` / `A4 ≤ 0.55` / `radiusCV` (loại vùng răng cưa → unknown); `squareMinA4` 0.08→0.06 (bắt lỗ vuông bo góc — `3446950001` vuông được nhận đúng sau hạ ngưỡng, không đổi kết quả trên bộ camera có nhãn). Giảm nhiễu lỗ **6754 → 1003** trên 124 ảnh. Focused `tests/moris-capture-subject-lock.test.js` **21/21** (thêm 4 test: closeMask, ngưỡng tương đối, profile răng cưa→unknown, khe nứt 1px không tạo lỗ giả). Full `npm test` → **46 files / 439 tests pass 100%**. `npx tsc --noEmit` exit 0. `npm run build` 50 files exit 0. Production writes 0; chưa deploy; chưa commit.
- [ ] **M27 còn lại (chủ dự án 2026-10-19: bỏ pilot test-only — nghiệm thu bằng vận hành thật trên production):** pilot P1.2 chụp theo thẻ chuẩn 4 marker để đo trong điều kiện vận hành; mask IoU với ground-truth người gán nhãn (alpha chỉ có ở 4 cutout); quyết định feed priorMask vào embedding query chỉ sau EVAL/M21 (tránh lệch phân phối center/query khi chưa có A/B).

## M28 — Size Contract & Size Gate (P1.4) — 2026-10-17

- [x] **Hợp đồng kích thước S1 (`size_contract_v1`):** module mới `src/moris/size-contract.js` (pure, DOM-free) — `normalizeSizePair` tự hoán vị về `L ≥ W` (chấp nhận số/chuỗi thập phân phẩy, cap 5000mm), `shapeClass` (vuông khi `|L−W|/L ≤ 5%`, không special case), `toleranceForEdge = max(5% × cạnh, sàn 2mm)` (Q5), `evaluateSizeMatch` (khớp từng cạnh + `d_max`), `sizeDistance`, `normalizeQuerySize` (làm sạch `source`/`confidence`), `formatSizePair`.
- [x] **Gate phía server (`functions/_lib/moris/v5/retrieval/sizeGate.js`):** mirror 1:1 phần hợp đồng (có test parity client/server tự động) + `applySizeGate` 3 trạng thái **fail-open**: `not_provided` (không có size → giữ nguyên pool), `dims_unavailable` (bảng chưa có/lỗi → giữ nguyên + cảnh báo trung tính — Q8), `applied` (giữ `match`/`unknown` + `size_status`/`size_evidence` từng ứng viên, loại `mismatch` + rejected list cap 10) + `loadCandidateDims` (PostgREST `catalogue_part_dimensions`, tối đa 100 id/request, 404/lỗi mạng/thiếu env → `null`, never throw).
- [x] **Tích hợp orchestrator:** chèn gate sau `hydrateVectorHits` trước `rankMetadata`; toàn bộ ứng viên bị loại → mode mới `MORIS_SIZE_GATE_NO_MATCH`; gắn `size_evidence` vào kết quả; `schemas/query.js` nhận `body.size` (sai → `null`), `candidate.js` truyền `size_status`/`size_evidence`, `publicResult.js` phơi `size_evidence`, `userMessage.js` thông điệp riêng + note trung tính + note "đã loại N mã ngoài dung sai", `runtime/config.js` `features.sizeGate` (env `MORIS_SIZE_GATE_ENABLED`, default true).
- [x] **UI camera:** panel "Kích thước (mm)" trong modal camera (`index.html`) — cạnh dài nhất × cạnh ngắn nhất, nút **"Không rõ kích thước"** (mặc định bật), hint động (`cameraSizeHint`); `src/app.js` `camera.size` state + `resetCameraSize`/`setCameraSizeUnknown`/`loadSizeContractModule`/`readCameraSize` (import động, fallback inline khi module lỗi) + truyền size vào `sendMorisMessage` từ cả luồng chụp camera và tải ảnh từ máy; payload `size` gửi `/api/moris/search`; `tools/build-static.mjs` thêm `PUBLIC_MORIS_SIZE_CONTRACT_MODULE_URL`; migration proposal `supabase/migrations/20261017090000_catalogue_part_dimensions_proposal.sql` (**PROPOSAL ONLY — chờ Gate D**, RLS bật, không policy anon).
- [x] **Bằng chứng kiểm thử (không hardcode số):** focused `npx vitest run tests/moris-size-contract.test.js tests/moris-size-gate.test.js` → **28/28 pass** (chuẩn hoá L≥W; biên sàn 2mm; 404 → null; cap 100 id; parity client/server; validate query; userMessage notes). Full `npm test` → **48 files / 468 tests pass 100%** (trước M28: 46/439). `npx tsc --noEmit` exit 0. `npm run build` **51 files** exit 0 (`dist/src/moris/size-contract.js` có mặt). Production writes 0 (phiên này chỉ có 376 DELETE R2 thuộc M30 đã duyệt); chưa deploy; chưa commit.
- [x] **Hardening cuối phiên 2026-10-17 (T1/T6/BUILD-01/DOC-01):** test tích hợp orchestrator mới `tests/moris-size-gate-orchestrator.test.js` (5 test — gate sau hydrate: lọc match/unknown đúng + `size_evidence`, pool rỗng → `MORIS_SIZE_GATE_NO_MATCH`, bảng 404 → `dims_unavailable` giữ nguyên pool, tắt `MORIS_SIZE_GATE_ENABLED` / thiếu query size → không gọi dims) + 2 test fail-open `loadCandidateDims` (JSON không phải mảng / body lỗi → `null`) trong `tests/moris-size-gate.test.js`; `tools/build-static.mjs` loại `.ts` khỏi `dist` (5 file nguồn gốc không còn lộ khi F12, ghim bằng `tests/frontend.test.js`); đồng bộ `docs/moris-v6/TECH_DEBT_ROADMAP.md` + viết `docs/moris-v6/TECH_DEBT_REGISTER.md`. Bằng chứng: focused 3 file **60/60**; full `npm test` **49 files / 475 tests pass 100%**; `tsc` exit 0; build **46 files** (0 file `.ts`). Chủ dự án yêu cầu commit + push toàn bộ — đã push `6c360dd` lên main `PQVinh99-Glory/Dictionary` (remote `upstream`) + fork Codespace (`origin`).
- [ ] **M28 còn lại:** Gate D + dữ liệu đo kẹp cho bảng `catalogue_part_dimensions` (Q7 đo chậm — ưu tiên mã hay nhầm); pilot P1.2 đo size-pair precision trên ảnh thật; S2 `kim_canon_v4_*` + re-index chỉ sau A/B + Gate D (Q11).

## Test backlog — nợ không cần dữ liệu chủ dự án (2026-10-19)

- [x] **T2 — UI contract M28 (test hành vi thật):** `tests/moris-size-ui-contract.test.js` (10 test, nạp `src/app.js` thật qua `vm`): `setCameraSizeUnknown` giữ/xoá/cưỡng boolean; `cameraSizeHint` 5 trạng thái; `readCameraSize` fail-open (unknown/thiếu/sai/âm/quá cỡ → `null`), hoán vị `L ≥ W`, dấu phẩy thập phân, fallback inline khi module lỗi; `onCameraFileSelect` truyền đủ 4 tham số `sendMorisMessage`; body `/api/moris/search` chứa `size` từ tham số 4.
- [x] **Fix bug thật do T2 phát hiện:** `cameraSizeHint` parse ô trống thành `Number("")=0` nên hiện "Số đo phải lớn hơn 0" — guard chuỗi rỗng → `null` (áp cùng guard cho `readCameraSize`, kết quả method này không đổi).
- [x] **T7 + R2-01 — purge-assets/legacy `parts/`:** `tests/catalogue-delete.test.js` +2 test (parts/ legacy → 400 không xoá gì; trộn key hợp lệ → chỉ xoá key hợp lệ); tách logic thuần `tools/r2-orphan-selection.mjs` (`KEEP_PREFIXES=['parts/']`, 500/20MB) cho `tools/r2-purge-orphans.mjs` dùng lại — `tests/r2-purge-selection.test.js` (7 test) ghim `parts/` không bao giờ vào targets.
- [x] **PROFILE-01 — fallback `searchVectorIndex`:** `tests/moris-vector-search-fallback.test.js` (7 test): v6 → RPC production → legacy `cls_l2_v1`; v6+prod lỗi → `console.warn` (không im lặng); profile đã `cls_l2_v1` không gọi lặp; legacy lỗi → `[]`; clamp matchCount.
- [x] **R2-02 — quota monitor R2 read-only:** `tools/r2-usage.mjs` (thuần) + `tools/r2-quota-monitor.mjs` (`--quota-gb`, không ghi) + `tests/r2-quota-usage.test.js` (6 test fixture). Chạy thật 1 lần: **1170 objects/32.22MB/10GB (0.31%)**, front 545/26.10MB, thumb 545/4.60MB, parts 77/1.40MB — khớp audit sau purge.
- [x] **TOOL-01 đóng (nợ cũ hết hiệu lực):** `jpeg-js` không có trong `package.json`, `node_modules` lẫn mã nguồn.
- [x] **Bằng chứng:** full `npm test` → **53 files / 507 tests pass 100%** (trước: 49/475); `npx tsc --noEmit` exit 0; `npm run build` 46 files (tools/tests mới không lọt `dist`); production writes 0 (1 GET read-only); chưa deploy; chưa commit.
- [ ] **Còn lại (blocked):** T3/T4 — chủ dự án quyết định 2026-10-19 **bỏ pilot, kiểm chứng thực tế trên production** (không đo tập 20 ảnh/4 marker nếu chỉ để test); T5 đã xong phần test mapping; EVAL-01; M18-01/M22-01; M26 release; M29-01 chờ dữ liệu thật; DEPLOY-01 chờ duyệt.

## Gate D — Size editor + Tracking box vuông (M28/M27) — 2026-10-19

- [x] **Chủ dự án duyệt 4 điểm:** (1) Áp Gate D — dùng bảng `catalogue_part_dimensions` + RPC mới; (2) form editor chỉ nhập **dài × rộng** (Q6); (3) **admin**, `method='user'`; (4) khung **live + tap chọn vật**, giữ nguyên luồng chụp.
- [x] **Migration thật `supabase/migrations/20261019090000_catalogue_part_dimensions_gate_d.sql`:** bảng dims kế thừa proposal (RLS bật, không policy anon) + mở rộng trigger `kim_cleanup_vectors_on_delete` dọn dims theo mọi đường xóa + RPC `app_upsert_part_dimensions` (admin, validate 0 < mm ≤ 5000, tự hoán vị L ≥ W, lấy code/part_id từ `image_library`) + `app_get_part_dimensions` (admin) + grants anon/authenticated/service_role.
- [x] **Size trong editor (`src/app.js` + `index.html`):** 2 ô "Kích thước (mm)" cạnh dài × cạnh ngắn + hint động; `loadEditorSize` (fail-soft khi bảng chưa sẵn sàng), `readEditorSize` (trống cả 2 → không lưu; thiếu/sai/quá cỡ → chặn), `savePart` validate **trước upload** và gọi RPC dims **sau metadata** (lỗi RPC dừng lưu, không im lặng); `openEditor` nạp size đã lưu.
- [x] **Khung vuông tracking (M27):** `camera.lock.box` + `subjectBoxToPercent` (bbox → %, clamp biên) cập nhật mỗi mẫu 450ms trong `_sampleCameraLockFrame`; overlay live trong camera modal — xanh "Đã nhận diện" khi đạt readiness, vàng "Đang bám vật thể" khi đang bám; `pointer-events-none` giữ tap-to-lock; `resetCameraLock` xoá box.
- [x] **Tests:** `tests/moris-size-editor-contract.test.js` (12), `tests/moris-camera-lock-box.test.js` (5), T5 row thật `method/confidence` trong `tests/moris-size-gate.test.js`, 2 marker mới trong `tests/frontend.test.js`.
- [x] **Bằng chứng:** focused file mới 17/17; full `npm test` **55 files / 525 tests pass 100%** (trước 53/507); `npx tsc --noEmit` exit 0; `npm run build` 46 files; production writes 0; chưa deploy; chưa commit.
- [x] **Áp production 2026-10-19 (chủ dự án ủy quyền agent chạy `npx supabase db push`):** review khô 12 migration pending bằng schema dump read-only — 5 bản đã áp thủ công nhưng thiếu history (`1000030000`/`1000050000`/`1000060000`/`1000070000`/`1000130000`) → `migration repair --status applied`; push thật 4 bản: `2026101000040000` (reset is_symmetric, no-op), `2026101200020000` (cascade delete vectors — gặp **42P13** do `app_delete_part` remote tạo tay kiểu TABLE, đã thêm `DROP FUNCTION IF EXISTS` vào migration trước CREATE), `20261017090000` (proposal), `20261019090000` (Gate D). 3 bản Moris V6 (`16024931`/`16033020`/`16040525`) giữ nguyên chưa áp theo `DB_MIGRATION.md` (M22 NO-GO). Xác minh: `migration list` local=remote (trừ 3 bản V6 cố ý); probe read-only production: bảng `catalogue_part_dimensions` → 200, `app_get_part_dimensions`/`app_upsert_part_dimensions` tồn tại (token sai → UNAUTHORIZED). Version **6.1.3 → 6.2.0**; full `npm test` 55 files/525 pass; tsc 0; build 46 files.
- [ ] **Nghiệm thu thật (thay pilot — chủ dự án quyết định 2026-10-19):** chủ dự án test trực tiếp trên production 1 mã: editor nhập size → lưu → mở lại thấy size; **bỏ pilot 20 ảnh/4 marker** nếu chỉ phục vụ test T3/T4 (không đo, không bịa số liệu).
