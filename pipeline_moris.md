# PIPELINE MORIS — Review kiến trúc & cơ sở nghiên cứu phân biệt kích thước linh kiện

> Ngày lập: 2026-10-17 · Người lập: AI Agent (review tĩnh, không chạy inference nặng)
> Vai trò tài liệu: (1) review chi tiết kiến trúc vận hành Moris hiện tại, (2) cơ sở lý luận và thiết kế cho bài nghiên cứu "sàng lọc ngoại quan theo kích thước" nhằm loại bỏ các mã hàng không cùng kích thước trước khi xếp hạng.
>
> **Trạng thái thay đổi:** tài liệu này KHÔNG sửa runtime, KHÔNG migration, KHÔNG deploy. Mọi mục đánh dấu `[ĐỀ XUẤT]` là chưa triển khai. Tuân thủ AGENTS.md: không ghi production khi chưa qua Gate D; Vector Center là nơi duy nhất ghi vector; giữ nguyên 2FA/RLS/CSRF/anti-bot.
>
> **Nguồn sự thật:** mã nguồn tại HEAD `2657b49` (working tree dirty được giữ nguyên), `state.json`, `docs/moris-v6/*`, `MORIS_V6_MASTER_PLAN.md`. Số liệu được trích dẫn nguyên trạng từ evidence đã ghi nhận; tài liệu này không tạo số liệu mới.

---

## 0. Tóm tắt điều hành

1. **Moris hiện tại là pipeline "bất biến tỉ lệ" (scale-invariant) theo thiết kế.** Mọi ảnh đầu vào được tách nền → căn trục PCA → cắt sát vật thể → letterbox về raster chuẩn 224×224 trước khi embed. Mọi đặc trưng hình học lưu trong DB đều là **tỉ lệ chuẩn hoá** (`u, v ∈ [0,1]`, `relArea = sqrt(holeArea/partArea)`, `aspect_ratio` là tỉ số cạnh). Vì vậy **hai mã hàng cùng hình dạng nhưng khác kích thước thực tế sẽ cho chữ ký gần như trùng nhau** — đây là nguyên nhân gốc của hiện tượng người dùng phản ánh "chưa phân biệt được kích thước".
2. Kiến trúc vận hành gồm **hai đường tách biệt**: đường **ghi vector** (chỉ Trung tâm Vector AI, có xác nhận + phân quyền) và đường **đọc/tìm kiếm** (chat text hoặc ảnh, chỉ tạo embedding tạm, không ghi index).
3. Xếp hạng hiện tại có 6 tín hiệu nhưng **vector DINOv2 chiếm trọng số 0.65**, hình học (lỗ/tỉ lệ/contour/patch) đang **TẮT mặc định** theo quyết định M22 (ablation thật làm giảm 4 điểm Top1; xem `docs/moris-v6/DECISION.md`).
4. Không có tầng dữ liệu kích thước nào tồn tại: bảng `image_library` và RPC `app_search_catalogue` (migration `2026101300010000`) **không có cột width/height/thickness mm**; geometry contract chỉ có `scale: { unit: "normalized", raster: 224 }` (`src/moris/vector/dinov2.worker.js:393`).
5. **Đề xuất trọng tâm:** thêm **Tầng 0 — Size Gate (sàng lọc ngoại quan theo kích thước)** theo nguyên lý *neo tỉ lệ + kích thước chuẩn catalogue*: đo px/mm từ vật chuẩn in trong ảnh (thẻ 4 góc/ArUco), đo kích thước mm của vật, rồi lọc cứng danh sách ứng viên ANN theo dung sai trước khi rerank hình dạng. Chi tiết thiết kế ở Phần 5.
6. **Hai lớp bài toán kích thước cần phân biệt** (quyết định phương án kỹ thuật):
   - **Case A — "cùng kiểu dáng, kích thước danh nghĩa khác nhưng chi tiết tuyệt đối":** lỗ khoan theo tiêu chuẩn (M6/M8...), chiều dài tấm thay đổi. Các tỉ lệ như `đường kính lỗ / chiều rộng tấm`, `bước lỗ / chiều dài` **khác nhau** → có thể phát hiện bằng tỉ lệ hiện có (nhưng đang tắt/thiếu trọng số).
   - **Case B — phóng/thu đều (uniform scaling):** mọi tỉ lệ bất biến → **chỉ có thể phát hiện bằng đo tuyệt đối mm**. Bắt buộc phải có neo tỉ lệ + kích thước chuẩn.
7. Release vẫn **NO-GO** (M22): camera thật Top1 dev 58/93 (62.37%), holdout 20/31 (64.52%); chưa có unknown negative nên FAR chưa đo được (`docs/moris-v6/DECISION.md`). Bài nghiên cứu size phải đi kèm bộ dữ liệu mới theo đúng thứ tự ưu tiên trong `docs/moris-v6/TECH_DEBT_ROADMAP.md`.

---

## 1. Phạm vi, bất biến và trạng thái hiện tại

### 1.1 Bất biến nghiệp vụ liên quan trực tiếp (tóm tắt từ AGENTS.md + MORIS_V6_MASTER_PLAN.md §0)

- Editor/save CHỈ lưu metadata + ảnh; **không tạo/upsert/re-index vector** trong mọi trường hợp.
- **Trung tâm Vector AI** là nơi duy nhất tạo/thay thế vector, theo thao tác người dùng + xác nhận + quyền `admin|editor|converter`; cùng asset + profile + variant là idempotent (skip/replace).
- Query embedding là dữ liệu tạm; **tìm kiếm không ghi index**.
- Mặc định chỉ index `canon_rgb_v2`; `canon_gray_v2` mở rộng có kiểm soát (`functions/api/moris/vector-upsert.js:118`).
- Không migration/deploy production khi chưa qua Gate D/E; mọi đề xuất DB trong tài liệu này chỉ ở mức "proposal".

### 1.2 Trạng thái vận hành đã ghi nhận (không diễn giải lại số cũ)

| Hạng mục | Trạng thái | Nguồn |
|---|---|---|
| Số SKU / vector production | 545 SKU / 1.090 vector (545 front + 545 thumb) | `state.json` M00, `MORIS_V6_MASTER_PLAN.md` §0.3 |
| Profile active | `hybrid_gem3_edge_55_45_pseudorgb_u8_v1`, preprocess `kim_canon_v3_letterbox`, DINOv2-small rev `ef1fb10`, 384D | `wrangler.toml:37-41`, `functions/_lib/moris/v5/runtime/config.js:17-24` |
| Geometry verification runtime | **OFF cứng** (`geometryVerification:false`, `contourVerification:false`, `spatialVerification:false`) | `functions/_lib/moris/v5/runtime/config.js:7-14` |
| Vector search | ON (`MORIS_VECTOR_SEARCH_ENABLED=true`), topK 60, minSimilarity 0.55 | `wrangler.toml:31`, `config.js:22-24` |
| Quyết định phát hành | NO-GO; verifiers experimental giữ OFF | `docs/moris-v6/DECISION.md` |
| Curator hard-negative | 57 ca: 2 approved, 55 rejected (giới hạn single-face của catalogue) | `docs/moris-v6/M21.md` |
| Dataset camera | 6 ảnh `image 2/` ban đầu dùng benchmark: Top1 0/6, Recall@10 4/6; thư mục hiện có 125 ảnh chưa audit | `docs/moris-v6/PHASE_A_REVIEW.md:52-60`, kiểm tra trực tiếp |

---

## 2. Bản đồ kiến trúc vận hành hiện tại

### 2.1 Sơ đồ tổng thể

```text
┌────────────────────────────── ĐƯỜNG GHI (chỉ Trung tâm Vector AI) ─────────────────────────────┐
│ tools/moris-vector-center.html + moris-vector-center.js                                        │
│   người dùng bấm Tạo vector (single/batch) + xác nhận                                          │
│   → embedImageDinov2Variants() [src/moris/vector/browserDinov2.js:116]                         │
│   → Web Worker "embed-variants-v2" [src/moris/vector/dinov2.worker.js:332]                     │
│       Layer 1: processLayer1Optical (mask → PCA → 224×224 → pseudo-RGB + geometry)             │
│       Layer 2: DINOv2 ONNX patch tokens → GeM(0.55)+Edge(0.45) → vector 384D L2-normalized     │
│   → POST /api/moris/vector-upsert [functions/api/moris/vector-upsert.js]                       │
│       validateSession → requireEditor → source="vector_center" + confirmed=true → ETag R2 khớp  │
│       → RPC kim_write_catalogue_vector_v6_provenance (hoặc fallback kim_upsert_catalogue_...)  │
│   → catalogue_image_vectors (halfvec(384), unique composite key, idempotent)                   │
└────────────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────── ĐƯỜNG ĐỌC — CHAT TEXT (không ảnh) ──────────────────────────────────┐
│ src/app.js sendMorisMessage (không có ảnh) [src/app.js:3429]                                   │
│   → POST /api/moris/chat [functions/api/moris/chat.js]                                         │
│       retrieveTextPool: searchCatalogue đa anchor (RPC app_search_catalogue) + scanCatalogue   │
│       3 nhánh deterministic (không LLM):                                                       │
│         (1) filterCatalogueByTargetQuery  → tìm ID chính xác / mã hàng substring               │
│         (2) filterCatalogueByQueryFeatures → AST đặc điểm nhận dạng (số lỗ, hình dạng)         │
│         (3) rankMetadata (metadata_score)                                                      │
│   → candidates[] + answer (thuần dữ liệu, không sinh text từ model)                            │
└────────────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────── ĐƯỜNG ĐỌC — TÌM BẰNG ẢNH ──────────────────────────────────────────┐
│ src/app.js buildMorisQueryVector [src/app.js:3074]                                             │
│   → Worker embed-variants-v2 → { probes[canon_rgb_v2, canon_gray_v2*], geometry }              │
│   (*gray chỉ bật khi allowMirror=true; mặc định query chỉ canon_rgb_v2)                        │
│   → POST /api/moris/search [functions/api/moris/search.js]                                     │
│       validateSession → validateMorisQuery (dimension/profile contract)                        │
│       → runMorisSearch [functions/_lib/moris/v5/orchestrator.js:106]                           │
│           1. exactLookup (mã/ID khớp tuyệt đối)                                                │
│           2. retrieveTextCandidates (pool text từ message đi kèm)                               │
│           3. encodeQueryImage: nhận suppliedEmbedding từ browser (profile phải khớp)            │
│           4. searchVectorIndex → RPC match_catalogue_image_vectors[_v6] (pgvector HNSW)         │
│           5. lọc minSimilarity (0.55) → collapseBestVectorHitPerRecord (1 view/SKU)             │
│           6. hydrateVectorHits (join catalogue rows)                                           │
│           7. rankMetadata → structuralEvidence → fuseCandidateScore (1 nguồn điểm cuối)         │
│           8. finalizeCandidatePool → Top 10 → publicCandidate → assessImageResult               │
│   → UI: danh sách ứng viên + % + cảnh báo + badge                                                  │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Đường ghi vector — chi tiết hợp đồng

- Entry duy nhất: `tools/moris-vector-center.js` → `POST /api/moris/vector-upsert`; server bắt buộc `body.source === "vector_center"` và `body.confirmed === true` (`functions/api/moris/vector-upsert.js:80`), role thuộc `admin|editor|converter` (`:13-21`).
- Mỗi request tối đa 20 vector (`:11`, `:97-107`); client phải chunk.
- Chỉ chấp nhận `view_variant === "canon_rgb_v2"` (`:118`).
- Kiểm tra ETag: bytes đã embed phải khớp object hiện tại trên R2 (`:124-126`) — chống ghi vector cho ảnh đã đổi.
- Whitelist geometry được persist (`:122`): `geometry_version, provenance, quality, coordinate_space, scale, hole_count, big_hole_count, small_hole_count, aspect_ratio, solidity, hole_centroids, count_conflict`.
- Idempotency: unique composite key `(record_id, asset_type, object_key, view_variant, embedding_model, embedding_model_version, preprocess_version, embedding_profile)` + `ON CONFLICT UPDATE` (migration `2026101000050000`, `:74-93`); chế độ `skip|replace` do người dùng chọn.
- Fallback RPC khi migration v6 chưa áp dụng: `kim_write_catalogue_vector_v6_provenance` → `kim_upsert_catalogue_image_vector` (`vector-upsert.js:170-206`; ghi nhận tại `plan.md` mục hotfix 2026-10-16).

### 2.3 Đường đọc ảnh — chi tiết tiền xử lý Layer 1 (nơi "mất" kích thước)

`src/moris/moris-layer1-optical.ts` (bản chạy thật trong Worker):

1. **Segmentation**: mask kim loại tối trên nền sáng; cờ chất lượng `mask_quality_v1` gồm `insufficient_foreground`, `foreground_fills_frame`, `background_nonuniform`, `subject_touches_edge`, `foreground_highlights_clipped` (`:354-373`). `reliable = flags.length === 0`.
2. **PCA alignment**: xoay trục chính về ngang, phân giải mơ hồ 180° bằng trọng tâm foreground vs detail (`moris-layer1-optical.ts` phần đầu; BUG 3 fix).
3. **Letterbox về 224×224** giữ tỉ lệ (`scaleX = max(cropW/targetW, cropH/targetH)`, `:757-770`). **Crop sát vật thể + resize phá huỷ mọi thông tin mm.**
4. **Hình học đầu ra** (đều chuẩn hoá, `:1555-1588`):
   - `u = (cx - centerX)/cW`, `v = (cy - centerY)/cH` (toạ độ tâm lỗ tương đối);
   - `relArea = sqrt(holeArea / canonicalFgArea)` (diện tích tương đối);
   - `normRadius = radius / max(cW, cH)` (bán kính tương đối);
   - `isBig/isSmall` theo phân cụm 1D Log-Area Otsu;
   - `aspectRatio = cW/cH ≥ 1.0` trên mask đã xoay (`:1454`, `:1594`);
   - `solidity = fgArea / hullArea`.
5. **Pseudo-RGB tensor** 3 kênh (L*/CLAHE, Scharr, Chamfer) → DINOv2.
6. **Geometry payload** gửi server (`dinov2.worker.js:388-409`): `scale: { unit: "normalized", raster: 224 }` — **không có bất kỳ trường mm nào**.

### 2.4 Xếp hạng và hợp nhất điểm

`functions/_lib/moris/v5/retrieval/scoreFusion.js` — **chủ sở hữu duy nhất `final_score`**:

| Tín hiệu | Trọng số cơ sở | Nguồn | Trạng thái runtime |
|---|---:|---|---|
| `vector` (cosine DINOv2) | **0.65** | RPC pgvector | ON |
| `holes` (assignment tối ưu Hungarian) | 0.20 | `holeMatcher.js` | OFF (geometry tắt) |
| `aspect` (tỉ lệ cạnh, bất biến xoay) | 0.10 | `geometricReranker.js:34-43` | OFF |
| `patch` (3×3 spatial patch) | 0.15 | `patchVerifier.js` | OFF |
| `contour` (EFD 16 harmonic) | 0.15 | `contourVerifier.js` | OFF |
| `metadata` (text rank) | 0.10 | `metadataFilter.js` | ON |
| `structural` (số lỗ text) | 0.20 | `structuralEvidence.js` | Chỉ khi `s_holes == null` |

Ghi chú kỹ thuật quan trọng:

- `weight = base_weight × reliability`; thiếu tín hiệu = không thưởng/không phạt (triết lý M17).
- Điểm cuối trừ `conflict_penalty` tối đa 0.24 (`scoreFusion.js:20-24`).
- Ở `orchestrator.js:354`, khi `geometryVerification !== true`, query geometry bị **null hoá trước `analyzeStructuralEvidence`** để không "lách" vào fusion qua đường số lỗ. Đây là hành vi có chủ đích sau M22.
- Lỗi "kiểu dáng giống nhưng khác số lỗ" hiện chỉ còn là cảnh báo text khi vector rất cao (`geometricReranker.js:99-104`), và cảnh báo này cũng chỉ chạy khi geometry ON.

### 2.5 Hợp đồng dữ liệu & lược đồ DB liên quan

- `catalogue_image_vectors`: `embedding halfvec(384)`, các cột geometry `hole_count, aspect_ratio, hole_centroids` (migration `2026101000050000:6-9`); HNSW `ef_search=100` (migration `20260915000100:21`).
- Hai RPC tìm kiếm:
  - `match_catalogue_image_vectors` (production hiện hữu, trả similarity + geometry cơ bản);
  - `match_catalogue_image_vectors_v6` (proposal M23 `20261016040525:64-79`, trả thêm `geometry_version, quality, provenance, embedding_signature_version`; **chưa áp dụng production**).
- `image_library` (qua RPC `app_search_catalogue`): các cột trả về gồm `id, code, part_id, usage_side, identifying_features, view_mode, is_symmetric, confusing_note, image_path, ...` — **không có kích thước** (`supabase/migrations/2026101300010000:75-93`).
- `geometry_evidence jsonb` (proposal M23): whitelist key cố định, budget 16KB (`20261016040525:23-26`). Nếu muốn chở dữ liệu vật lý mới vào `geometry_evidence`, cần **migration mới mở rộng whitelist** (trường `scale` hiện đã nằm trong whitelist nhưng đang giữ `{unit, raster}`).

### 2.6 Danh mục điểm chèn code (file:line) cho nghiên cứu sau này

| Nơi | File:line | Vai trò |
|---|---|---|
| Runtime feature flags | `functions/_lib/moris/v5/runtime/config.js:7-14` | Bật/tắt geometry, contour, patch |
| Orchestrator ảnh | `functions/_lib/moris/v5/orchestrator.js:233-436` | Luồng search ảnh end-to-end |
| Encode query | `functions/_lib/moris/v5/vector/encoder.js:10-127` | Contract profile/dimension |
| RPC search + fallback | `functions/_lib/moris/v5/vector/search.js:7-65` | Truy vấn pgvector |
| Fusion điểm | `functions/_lib/moris/v5/retrieval/scoreFusion.js` | Trọng số cuối |
| Geometry evidence | `functions/_lib/moris/v5/retrieval/geometricReranker.js` | S_ratio, S_holes, warning |
| Lỗ - assignment | `functions/_lib/moris/v5/retrieval/holeMatcher.js` | Hungarian O(n³), ≤64 lỗ |
| Layer 1 quang học | `src/moris/moris-layer1-optical.ts` | Nơi mất scale |
| Worker payload | `src/moris/vector/dinov2.worker.js:332-421` | Probe + geometry gửi đi |
| Query vector frontend | `src/app.js:3074-3176` | Build probes + geometry |
| Chat text | `functions/api/moris/chat.js:186-248` | 3 nhánh deterministic |
| RPC catalogue | `supabase/migrations/2026101300010000` | Output columns không có size |
| Geometry DB | `supabase/migrations/2026101000050000` | Cột + RPC production |
| Proposal v6 | `supabase/migrations/20261016040525` | Provenance, whitelist, RPC v6 |

---

## 3. Phân tích cội nguồn: vì sao Moris "mù kích thước"

### 3.1 Chuỗi chuẩn hoá phá huỷ tỉ lệ

Ảnh gốc (mọi kích thước raster, mọi khoảng cách chụp) → mask → PCA xoay → **crop sát bbox vật thể** → **resize letterbox 224×224**. Đây là phép biến đổi **chuẩn hoá theo chính vật thể**, không dùng bất kỳ tham chiếu ngoài nào. Hệ quả toán học: nếu hai vật thể có hình dạng giống nhau (kể cả tương đồng đến mức vẽ dập), ảnh chuẩn hoá của chúng **trùng khớp gần như pixel-level** bất kể một cái dài 100mm và cái kia dài 300mm.

### 3.2 Mọi tín hiệu lưu trữ hiện có đều bất biến tỉ lệ

| Tín hiệu | Công thức | Bất biến tỉ lệ? |
|---|---|---|
| Vector DINOv2 trên ảnh 224×224 | học sâu + augmentation tỉ lệ | Có (mạnh) |
| `aspect_ratio` | `cW/cH` | Có |
| `hole_centroids.u/v` | chuẩn hoá theo bbox | Có |
| `relArea` | `sqrt(holeArea/partArea)` | Có |
| `normRadius` | `radius/max(cW,cH)` | Có |
| `solidity` | `fgArea/hullArea` | Có |
| `hole_count`, `big/small` | số nguyên đếm | Có |
| `EFD 16 harmonic` | mô tả contour | Có (chuẩn hoá scale) |
| `metadata` | text | Không có trường size trong DB |

⇒ **Không tồn tại một bit thông tin tuyệt đối nào về mm trong toàn bộ chữ ký hiện tại.**

### 3.3 Hệ quả thực tế (ánh xạ với phản ánh người dùng)

- Case B (phóng/thu đều): cặp mã hoàn toàn trùng nhau sau chuẩn hoá; fusion chỉ còn phân biệt bằng nhiễu vector/DINOv2 — thực tế là *tie ngẫu nhiên*. **Đây gần như chắc chắn là lớp lỗi người dùng đang gặp.**
- Case A (cùng kiểu, khác chiều dài, lỗ theo chuẩn mm): về lý thuyết các tỉ lệ `normRadius`, `relArea` có khác — nhưng các tín hiệu này **đang tắt mặc định** và ngay cả khi bật, chúng không có cơ chế "chặn cứng" (hard gate), chỉ cộng trọng số mềm (holes 0.20, aspect 0.10) trước vector 0.65.
- Số lỗ (tín hiệu mạnh nhất còn lại) không giúp gì khi hai mã có cùng số lỗ.

### 3.4 Bằng chứng code trực tiếp

- `src/moris/vector/dinov2.worker.js:388-409`: payload geometry không có trường vật lý nào.
- `src/moris/moris-layer1-optical.ts:1555-1577`: toạ độ/bán kính/diện tích lỗ đều chia cho kích thước vật thể.
- `supabase/migrations/2026101300010000:75-93`: output catalogue không có cột kích thước.
- `functions/_lib/moris/v5/runtime/config.js:7-14`: hình học đang tắt.
- Ảnh thực tế `image 2/` (125 file, kiểm tra trực tiếp): chụp trên giấy trắng nhăn, độ phân giải thay đổi (ví dụ 1113×420, 905×673, 1419×477, 1001×731), **không có vật chuẩn tỉ lệ** trong khung hình.

---

## 4. Danh mục lỗi/tồn đọng quan sát được (chỉ liệt kê thứ đã có bằng chứng)

| ID | Mô tả | Bằng chứng | Mức | Trạng thái |
|---|---|---|---|---|
| B1 | Mù kích thước do chuẩn hoá scale-invariant (mục 3) | code + ảnh `image 2/` | **P0 nghiệp vụ** | Chưa có giải pháp |
| B2 | Geometry verification tắt mặc định sau ablation âm | `config.js:7-14`, `DECISION.md` | P0 kỹ thuật | Chủ đích giữ OFF tới khi có evidence mới |
| B3 | Fallback truy vấn chéo profile: query hybrid vs DB `cls_l2_v1` | `search.js:49-63` (gọi cùng `vecStr` với profile khác) | P1 | Cần xác minh trạng thái re-index production; rủi ro cosine không cùng không gian biểu diễn |
| B4 | Legacy vector `cls_l2_v1` (từ trước hotfix profile) còn tồn tại song song | `plan.md` hotfix 2026-10-16; `search.js` fallback | P1 | Chỉ gỡ bằng re-index có kiểm soát qua Vector Center |
| B5 | `partMask.js` full-frame fallback khi mask < 2% | `src/moris/geometry/partMask.js:99-104` | P3 (legacy, chỉ test dùng) | Không nằm trong runtime hiện tại; không cần sửa gấp nhưng cần ghi debt |
| B6 | 55/545 cặp thumb/front lệch số lỗ | `M21.md` (curator đã reject vì giới hạn single-face) | P2 dữ liệu | Không phải lỗi thuật toán; ghi nhận giới hạn catalogue |
| B7 | 507/545 SKU thiếu `identifying_features` | `MORIS_V6_MASTER_PLAN.md:31` | P1 dữ liệu | Cản trở lọc text/đặc điểm |
| B8 | Không có unknown negatives → FAR không đo được | `DECISION.md` | P0 đo lường | Thuộc roadmap dữ liệu mới |
| B9 | Protocol chụp 1000:410 không có chuẩn tỉ lệ | `index.html:2007-2123` | P0 dữ liệu | Nằm trong phạm vi tài liệu này (Tầng 0) |
| B10 | Không có cột/trường kích thước trong schema | migrations đã dẫn | P0 dữ liệu | Cần migration proposal (Phần 5.3) |
| B11 | `structuralEvidence` cũ chỉ so khớp 1/0 theo số lỗ | `structuralEvidence.js` | P2 | Đã bị vô hiệu có chủ đích khi geometry OFF |
| B12 | `minSimilarity=0.55` + topK 60/over-fetch 100 | `config.js:22-24`, `orchestrator.js:271` | P2 | Chính sách hiện tại; cần định lượng khi mở rộng size gate |
| B13 | Không có phân loại hình dạng lỗ từ ảnh (tròn/vuông/oval) — chỉ có regex text trên metadata và phân cụm diện tích | `featureMatcher.js:42-43`, `metadataFilter.js:36-38`; ca 3421750001 vs 3421760001 (11.1) | P0 nghiệp vụ cho ca sai hình dạng lỗ | Thuộc M27 (hole-shape evidence), xem 11.5 |
| B14 | Thay ảnh (replace asset) **không xoá object R2 cũ** → orphan tích luỹ | `src/app.js:1883-1886` (`mergeAsset` chỉ đổi mảng), `:1945` (`app_replace_part_assets` chỉ đổi DB); `upload.js:157` key mới theo `uploadId`; không có `CATALOGUE_BUCKET.delete` trong luồng save/upload | P0 hạ tầng (ngân sách R2 10GB) | Sửa trong M30 (12.2) |
| B15 | Xoá 1 mã (`delete-part.js`) **không purge R2** như bulk-delete | `functions/api/catalogue/delete-part.js` (không đụng R2); chỉ `bulk-delete.js:81-93`/`delete-all.js` purge | P1 hạ tầng | Sửa trong M30 (12.2) |

---

## 5. Thiết kế đề xuất — Tầng 0 "Size Gate" (sàng lọc ngoại quan theo kích thước)

### 5.1 Nguyên lý

Muốn lọc theo kích thước, hệ phải trả lời được **cùng một câu hỏi ở hai phía**:

```text
Kích thước thực của vật trong ảnh query (mm)  ↔  Kích thước chuẩn của từng SKU (mm)
                     ▲                                        ▲
          cần "neo tỉ lệ" (px/mm)                  cần dữ liệu đo catalogue
```

- Phía query: đo từ ảnh chụp cần **vật chuẩn đã biết kích thước** đặt cùng mặt phẳng với linh kiện (để suy ra px/mm, hiệu chỉnh phối cảnh).
- Phía catalogue: cần **kích thước chuẩn một lần cho mỗi SKU** (đo tay bằng thước kẹp, hoặc chụp lại với cùng thẻ chuẩn).

### 5.2 Phương án neo tỉ lệ cho ảnh query

| Mã | Phương án | Cơ chế | Ưu | Nhược | Đề xuất |
|---|---|---|---|---|---|
| P-A | **Thẻ căn chỉnh 4 marker in sẵn** ("moris-mat-v1": 4 góc vuông đen hoặc ArUco/AprilTag tại vị trí mm đã biết) | detect 4 điểm → homography → px/mm cục bộ | chính xác ~1%; chống nghiêng phối cảnh; thuần JS/WASM | cần in và đặt thẻ khi chụp; detect marker trong ảnh nhỏ/bóng loá có thể fail | **Khuyến nghị chính** |
| P-B | Khổ A4 làm chuẩn (210×297mm) | detect 4 mép giấy | không cần in thêm | giấy trắng trùng nền trắng hiện tại; mép thường bị crop khỏi khung; mép nhăn | Dự phòng, chỉ khi có mép tương phản |
| P-C | Thước in/vạch chuẩn trong khung | đọc vạch | quen thuộc với thợ | detect vạch kém ổn định; dễ nhoè | Không ưu tiên |
| P-D | Rig chụp cố định (khoảng cách hằng số) | px/mm = hằng số hiệu chuẩn | đơn giản nhất | chỉ đúng nếu mọi ảnh chụp cùng rig — ảnh `image 2/` chứng minh hiện không như vậy | Chỉ dùng cho catalogue nếu chuẩn hoá được |
| P-E | Mã OCR chữ dập nổi trên chi tiết (ví dụ "ST") | OCR trực tiếp | xác thực danh tính mạnh khi có chữ | phần lớn chi tiết không có chữ hoặc chữ trùng nhau; không cho kích thước | Tín hiệu phụ, độc lập size |

Yêu cầu kỹ thuật tối thiểu cho P-A: detect thành công ≥95% trên ảnh điện thoại ở khoảng cách 20–60cm, sai số px/mm ≤ 1.5% (đo lặp 10 lần), bù nghiêng tới 30°. Thư viện khả thi: thuần JS tự viết connected-components cho 4 ô vuông đen (nhẹ, khoẻ CSP) hoặc ArUco (js-aruco2 / OpenCV.js — cân nhắc dung lượng; DINOv2 đã ~85MB nên OpenCV.js ~8–10MB chấp nhận được trên desktop, rủi ro hơn trên mobile).

### 5.3 Dữ liệu kích thước catalogue (một lần cho mỗi SKU)

**[ĐỀ XUẤT] Bảng mới `catalogue_part_dimensions`** (migration additive, phải qua Gate D):

```sql
-- PROPOSAL ONLY — chưa áp dụng production
create table if not exists public.catalogue_part_dimensions (
  record_id  uuid primary key,              -- FK logic tới image_library.id
  code       text not null,
  part_id    text,
  length_mm  real,                          -- cạnh dài nhất theo trục chính PCA (L >= W)
  width_mm   real,                          -- cạnh ngắn (luôn <= length_mm)
  thickness_mm real,                        -- có thể null (không đo được từ ảnh)
  diagonal_mm real,
  hole_diameters_mm jsonb,                  -- [ {x_ratio,y_ratio, diameter_mm} ]
  hole_pitches_mm   jsonb,
  method     text not null,                 -- 'caliper' | 'marker_photo' | 'erp'
  confidence real not null default 1.0,
  measured_by text, measured_at timestamptz, notes text
);
```

Ba kênh thu thập, ưu tiên giảm dần:

1. **Kẹp đo tay 545 SKU** (chính xác 0.1mm, một lần, có người kiểm chứng chéo 10%).
2. **Chụp lại 545 SKU với thẻ chuẩn** (nhanh hơn, sai số 1–3%, cần đối chiếu mẫu với kẹp).
3. **Import ERP/BOM** nếu chủ dự án có sẵn cột kích thước — nhanh nhất nhưng cần xác minh độ tin cậy (xem câu hỏi mở Q1).

Backfill có thể nằm trong geometry_evidence jsonb tạm thời, nhưng **cột SQL riêng là bắt buộc** nếu muốn lọc phía DB ở quy mô lớn.

### 5.4 Thuật toán Size Gate

```text
INPUT  query_photo, candidate_ids (từ ANN top-K), τ (dung sai), dims_db
STEP 1  Layer 1 hiện có → bbox vật thể (px, trong ảnh gốc), maskQuality.
STEP 2  Nếu thẻ chuẩn detect được:
          px_per_mm ← homography từ 4 điểm chuẩn
          (L_mm, W_mm, D_mm) ← bbox_px / px_per_mm   (đúng mặt phẳng thẻ)
          (d_hole_mm, pitch_mm) ← từ hole centroids/px
          scale_status = "measured", confidence f(marker_fit, maskQuality)
        Ngược lại:
          scale_status = "unknown"
STEP 3  Với mỗi ứng viên c:
          nếu scale_status != measured → giữ nguyên (fail-open có cảnh báo)
          nếu DB thiếu dims → giữ nguyên + cờ "size_unknown"
          nếu d_max(L,W) vượt τ_rel (xem 10.3, thử cả bản hoán vị (L,W)↔(W,L))
              → loại khỏi pool xếp hạng (ghi evidence size_rejected[])
STEP 4  Rerank phần còn lại theo fusion hiện có (không đổi trọng số trong giai đoạn đầu).
OUTPUT  candidates + size_evidence {status, measured_dims, tolerance, rejected[]}
```

> Ghi chú quy ước (chi tiết tại 10.3): cạnh dài `L` và cạnh ngắn `W` được lưu theo cặp `(length_mm, width_mm)` bất biến hướng (trục chính PCA, `L ≥ W`); phép so khớp thử cả bản hoán vị để chống lỗi đo nhầm cạnh.

**Chính sách dung sai (đề xuất khởi điểm, phải hiệu chuẩn bằng dữ liệu thật):** `τ_rel = 3–5%` theo cạnh lớn, `floor = 2mm`; riêng đường kính lỗ dùng dung sai tuyệt đối theo cấp dung sai lỗ tiêu chuẩn ±0.2mm nếu đo đủ tin cậy. **Không được hard-code ngưỡng này trước khi có đo lường lặp (test-retest) của thẻ chuẩn.**

**Chính sách fail-open/fail-closed:** mặc định **fail-open** (không có thẻ → vẫn tìm như cũ + hiển thị trạng thái "Chưa xác định kích thước — khuyến nghị chụp kèm thẻ chuẩn"), vì ép fail-closed sẽ chặn toàn bộ ảnh đang lưu hành. Khi đã có thẻ và dims DB đầy đủ, các ứng viên ngoài dung sai bị đánh dấu công khai (không lặng lẽ cắt) để giữ tính "evidence-based".

### 5.5 Điểm chèn vào code hiện tại (khi được phép triển khai)

| Bước | File | Thay đổi đề xuất |
|---|---|---|
| 1 | `src/moris/moris-layer1-optical.ts` | Thêm output `physical: { reference, px_per_mm, bbox_px, width_mm, height_mm, diagonal_mm, hole_diameters_mm, confidence }` (nullable như mọi trường geometry khác) |
| 2 | `src/moris/vector/dinov2.worker.js:388-409` | Đưa `physical` vào geometry payload; giữ `scale` cũ để tương thích |
| 3 | `functions/_lib/moris/v5/schemas/geometry.js` | Mở rộng `normalizeGeometry` chuẩn hoá `physical` nullable; cập nhật whitelist khi ghi `geometry_evidence` (migration mới — chỉ đề xuất) |
| 4 | `functions/api/moris/vector-upsert.js:122` | Persist `physical` cho vector catalogue (chỉ sau khi duyệt Gate D) |
| 5 | `functions/_lib/moris/v5/orchestrator.js` (~dòng 338-390) | `applySizeGate(hydrated, query.geometry.physical, candidateDims)` sau hydrate, trước rankMetadata; ghi `size_evidence` vào candidate public |
| 6 | `functions/_lib/moris/v5/presentation/publicResult.js` | Badge "Khớp kích thước" / "Không xác định kích thước" / "Loại: khác kích thước" |
| 7 | RPC đề xuất `match_catalogue_image_vectors_v7` | Trả thêm `width_mm/height_mm/diagonal_mm` (join dims) — chỉ khi số SKU tăng vượt ngưỡng cần lọc phía DB |
| 8 | `index.html` + `src/app.js` (camera modal) | Hướng dẫn đặt thẻ chuẩn; preview cảnh báo nếu không thấy thẻ; hiển thị size đo được để người dùng xác nhận |

### 5.6 Giải pháp "ngoại quan" tạm thời khi chưa có neo tỉ lệ (Case A)

Khi chưa thể triển khai thẻ chuẩn ngay, có thể tận dụng **các tỉ lệ bất biến scale nhưng vẫn phân biệt được Case A**:

- `hole_diameter / part_width` (đã có `normRadius`), `hole_pitch / part_length`, phân bố `relArea` giữa lỗ to/nhỏ;
- `aspect_ratio` và `solidity`;
- **so khớp số lỗ to/nhỏ và tâm lỗ** (Hungarian) — vốn đã code xong nhưng đang OFF.

Tuy nhiên phải nói rõ giới hạn: **các tỉ lệ này không thể phân biệt Case B (phóng đều)**. Vì vậy lộ trình đề xuất là: bật lại geometry theo quy trình ablation đúng (M14/M15/M22) như một *cải thiện phụ*, song song triển khai Tầng 0 cho Case B. Không được tuyên bố "đã phân biệt kích thước" nếu chỉ dựa vào tỉ lệ.

---

## 6. Lộ trình thực thi đề xuất (theo thứ tự ưu tiên đã có trong TECH_DEBT_ROADMAP)

| Giai đoạn | Nội dung | Điều kiện hoàn thành / evidence |
|---|---|---|
| **P0 — Quyết định nghiệp vụ** | Trả lời 8 câu hỏi mở (Phần 8): ERP? quy tắc mã hàng? dung sai? chấp nhận thẻ chuẩn? | Biên bản quyết định của chủ dự án |
| **P1 — Thu thập kích thước chuẩn** | Đo/import dims cho 545 SKU vào bảng proposal; kiểm chứng chéo 10% | Bảng dữ liệu + sai số chéo ≤ 0.5mm (kẹp) |
| **P2 — Layer 1 physical scale** | Implement `physical` nullable + thẻ moris-mat-v1 + chỉnh camera modal | Unit test contract; test-retest px/mm ≤1.5% trên 30 ảnh |
| **P3 — Size Gate server** | `applySizeGate` + presentation + RPC v7 (nếu cần) | Test âm/dương: cùng hình khác size bị loại đúng; không loại oan cặp cùng size |
| **P4 — Benchmark mới** | Bộ dữ liệu độc lập: ảnh có thẻ, nhãn xác minh, **size-pair hard negatives**, unknown negatives; dev/holdout đóng băng trước khi đo | Báo cáo metric (Phần 7) với hash manifest theo M19 |
| **P5 — Quyết định rollout** | Gate D/E; không đụng production trước đó | Ký duyệt owner |

Song song (không chặn P1–P4): hoàn tất các gate đang mở M14/M15/M16/M18/M21/M22/M26 theo roadmap hiện hữu — đặc biệt **không bật geometry toàn cục khi chưa có bằng chứng ablation mới**.

---

## 7. Đo lường & tiêu chí acceptance

**Bộ dữ liệu (bắt buộc mới, theo TECH_DEBT mục 2):** ảnh chụp mới, nhãn độc lập (SKU, view, chiếu sáng, góc, session), manifest + SHA-256 đóng băng trước khi tinh chỉnh, tách dev/holdout. Bổ sung hai loại ca hiếm:

1. **Size-pair hard negatives** — các cặp SKU cùng kiểu dáng nhưng khác kích thước (do curator gán nhãn case A/B).
2. **Unknown negatives** — linh kiện ngoài catalogue đã biết để đo FAR.

**Chỉ số:**

| Nhóm | Chỉ số | Ý nghĩa |
|---|---|---|
| Size Gate | Precision loại trừ | trong các ứng viên bị loại, tỉ lệ thật sự khác size (mục tiêu: không loại oan mã đúng) |
| Size Gate | Recall loại trừ | trong các ca sai size trong top-K, tỉ lệ bị loại |
| Xếp hạng | Top1, Recall@10, Recall@50, MRR | so sánh before/after có/không Size Gate trên cùng query set |
| An toàn | FAR trên unknown negatives, abstain rate | bắt buộc cho mọi tuyên bố "an toàn" |
| Vận hành | p95 latency detect thẻ + gate; tỉ lệ detect thẻ thành công | mục tiêu sơ bộ: detect ≥95%, gate p95 ≤ 30ms (đo trên thiết bị thật, không phải Node) |

**Điều kiện Go/No-Go sơ bộ (owner chốt):** Size Gate **không được** làm giảm Top1/Recall@10 trên tập không-đổi-kích-thước; đồng thời cải thiện Top1 trên tập size-pair ≥ 20 điểm % tuyệt đối; precision loại trừ ≥ 99%. Nếu không đạt → giữ fail-open và không hiển thị kết luận size.

---

## 8. Rủi ro & câu hỏi mở cho chủ dự án

**Rủi ro:**

1. Sai số đo thẻ chuẩn truyền thẳng vào ngưỡng loại → loại oan mã đúng. Giảm thiểu: hiệu chuẩn lặp, dung sai tối thiểu 2 lần sai số đo.
2. Bóng đổ/ô nhiễm marker do kim loại trên thẻ → detect fail. Cần thẻ nền trắng mờ (matte) + protocol đặt vật không che marker.
3. Đo catalogue thủ công 545 SKU tốn nhân lực; lỗi nhập liệu. Cần double-check 10% và validation schema.
4. Số liệu cũ (124 ảnh) đã tiêu thụ holdout — **không được** dùng lại để tuning size gate; đúng bài học M22.
5. Thêm dữ liệu dims vào DB làm thay đổi migration/whitelist — phải qua Gate D; ngoài ra phải giữ luật "Editor không ghi vector" (chỉ metadata).

**Câu hỏi mở (cần chủ dự án xác nhận trước khi code):**

- **Q1.** ERP/BOM hiện có trường kích thước (dài × rộng × dày) theo `part_id`/`code` không? Có thể export trích lọc không?
- **Q2.** Ngoài quy tắc đã xác lập "chữ số thứ 6 = chirality (lẻ=Trái, chẵn=Phải)" (`M21.md`), mã hàng có quy tắc chữ số nào mã hoá **kích thước** không? (Cần domain expert, không được suy đoán.)
- **Q3.** Có được phép chuẩn hoá quy trình chụp (bắt buộc đặt thẻ chuẩn cạnh vật) cho các ảnh tương lai không? Ảnh cũ `image 2/` không có thẻ nên chỉ dùng được cho đo lường hiện trạng, không dùng cho size gate.
- **Q4.** Lớp lỗi thực tế người dùng gặp là Case A (tỉ lệ khác) hay Case B (phóng đều)? Có 2–3 cặp mã cụ thể làm mẫu không?
- **Q5.** Dung sai nghiệp vụ coi là "cùng kích thước" là bao nhiêu %? Có phân biệt theo từng nhóm hàng không?
- **Q6.** Có cần phân biệt cả **độ dày** (thickness) không, hay chỉ dài × rộng × đường kính lỗ?
- **Q7.** Có nhân lực đo kẹp 545 SKU (hoặc chụp lại với thẻ) trong bao lâu?
- **Q8.** Khi chưa có dữ liệu size, có chấp nhận UI hiển thị "chưa đủ dữ liệu để kết luận kích thước" như một trạng thái trung tính không (thay vì im lặng)?

---

## 9. Phụ lục

### 9.1 Thuật ngữ

- **Probe**: một biến thể embedding gửi từ browser (hiện `canon_rgb_v2`; `canon_gray_v2` khi bật mirror).
- **Profile vector**: bộ định danh `model + model_version + preprocess_version + profile + dimension` — bắt buộc khớp giữa ghi và đọc.
- **Geometry evidence**: tập hợp bằng chứng hình học gắn với ứng viên (s_holes, s_ratio, patch, contour...) phục vụ fusion.
- **Size Gate**: tầng đề xuất lọc ứng viên theo kích thước vật lý trước khi xếp hạng.
- **Neo tỉ lệ (scale anchor)**: vật thể có kích thước mm đã biết, xuất hiện cùng mặt phẳng trong ảnh, dùng để suy ra px/mm.

### 9.2 Trạng thái gate hiện tại (không thay đổi bởi tài liệu này)

- Gate A: owner review pending (theo `PHASE_A_REVIEW.md`).
- Gate C: chưa đạt — M22 NO-GO.
- Gate D: đóng — mọi migration/reindex production cấm.
- Gate E: chưa deploy; staging `skipped_by_owner`, không phải pass.

### 9.3 Tuyên bố giới hạn của tài liệu

- Toàn bộ nội dung mục 5 (thiết kế/phương án) là **đề xuất nghiên cứu**, chưa có mã hoặc số liệu kiểm chứng.
- Số liệu vận hành được trích dẫn nguyên văn từ evidence đã ghi trong repo; tài liệu không chạy benchmark mới, không tạo metric giả.
- Không có thay đổi nào đối với mã nguồn, database, R2 hay cấu hình deploy trong lần lập tài liệu này.

---

## 10. Thiết kế bổ sung (đề xuất nghiên cứu) — Subject Locking, Mask Purity & Size Contract

> Bổ sung ngày 2026-10-17 theo trao đổi với chủ dự án: làm rõ (a) khóa chủ thể khi tracking bị nhiễm nền/bóng/vật ngoài, (b) tái tạo chủ thể để lớp hình học chính xác hơn, (c) quy ước kích thước mm (ngang/dọc, hình vuông). Toàn bộ mục 10 vẫn là `[ĐỀ XUẤT]`, chưa triển khai.

### 10.1 Subject Locking — đây là bài toán "độ tinh khiết mask", không phải nhận diện vật thể

Điểm neo kỹ thuật: đầu vào DINOv2 **không phải ảnh gốc** mà là ảnh cấu trúc tổng hợp từ mask (`src/moris/vector/dinov2.worker.js:225-239`: kênh 0 = CLAHE luma, kênh 1 = Scharr edge, kênh 2 = Chamfer). Vì vậy bóng đổ/lem nền/vật dư **không đi thẳng vào embedding** — chúng phá hoại qua **mask bị nhiễm** (bbox, PCA, số lỗ giả, tâm lỗ lệch). Mọi cơ chế chống nhiễm phải nằm ở tầng mask trước khi sinh tensor.

**Năm lớp phòng thủ theo thứ tự (đề xuất):**

| Lớp | Cơ chế | Chống được |
|---|---|---|
| 1. Seed + vùng khóa | Người dùng tap-to-lock hoặc auto chọn component lớn nhất có **contour kín**; mask chỉ mọc từ seed; cắt mọi vùng không liên thông trong N px | Vật dư, mảng nền rời rạc |
| 2. Phân loại bóng đổ (shadow) | Bóng là "nền × hệ số tối": giữ nguyên hue giấy, vân nền mịn, mép mềm (Scharr thấp trải rộng), gradient đơn hướng, không contour kín riêng, không "vành dập" → gán nhãn background | Vùng đổ bóng tối giống linh kiện |
| 3. Phân loại chói (specular) | Pixel bão hoà cao, chroma thấp, nằm **trong** thân kim loại, không thấy vân nền xuyên qua → **không tính là lỗ**; fill lại kênh L/edge từ lân cận (morphological) trước khi sinh pseudo-RGB | Lỗ giả do chói đèn, đốm sáng |
| 4. Voting đa khung (3–5 khung) | Mask = trung vị theo pixel giữa các khung; loại pixel "nhấp nháy"; chọn khung ít chói + nét nhất | Nhiễu nhất thời, bóng động, run tay |
| 5. Ưu tiên thận trọng + thoát hiểm | Khi nghi ngờ → **co mask (under-segment)** thay vì nới; nút tẩy/cọ thủ công; nút chụp lại. Tuyệt đối **không tự xoá vật dư trong im lặng** — nếu ≥2 component đủ lớn thì hiện overlay cho người dùng chọn | Mọi ca còn mơ hồ |

**Điều kiện "chốt khóa" (readiness) trước khi cho phép tìm kiếm:**

1. Vật nằm trọn trong khung (không chạm biên, margin ≥ 10% cạnh ngắn);
2. Chỉ 1 component trội (không có vật lạ);
3. Khóa ổn định liên tục N khung;
4. Tỉ lệ pixel bão hoà trong mask dưới ngưỡng (chói ít);
5. Độ nét đạt ngưỡng (Laplacian variance).

Đạt cả 5 → auto-capture hoặc phát tín hiệu "sẵn sàng"; không đạt → hướng dẫn trực tiếp trên preview. **Ca vật chạm biên** — hiện là 86/93 ảnh development theo `docs/moris-v6/DECISION.md` — tracking **không cứu được**, bắt buộc UX phải báo "lùi máy/zoom out" theo thời gian thực; không được tự pad/đoán phần bị cắt.

### 10.2 Tái tạo chủ thể (deterministic reconstruction) cho lớp hình học

Có thể "tái tạo/tối ưu" chủ thể sau tracking, nhưng chỉ bằng các phép biến đổi **không sinh nội dung**:

1. **Matte sạch + nền hằng số**: nền và bóng gán về một hằng số trung tính — loại hoàn toàn ảnh hưởng "lem nền" lên canonical crop.
2. **Làm phẳng chiếu sáng**: chia kênh L cho trường chiếu sáng tần số thấp nội suy từ nền (homomorphic/background-ratio) — giảm gradient bóng, vệt đèn trên bề mặt.
3. **Chèn lấp chói trên kênh L/edge**: chỉ trong mask chói đã phân loại (10.1 lớp 3), lấy giá trị lân cận; không đụng hình học.
4. **Validate lỗ**: một lỗ hợp lệ khi có contour kín + "vành dập" + (hoặc) thấy nền xuyên qua; lỗ không đủ bằng chứng → hạ `reliability`, không nhận bừa.

**Cấm** dùng generative inpainting để "vẽ lại" chi tiết — vi phạm nguyên tắc evidence-based của AGENTS.md.

**Ràng buộc bắt buộc:** mọi thay đổi thuật toán canonicalization (kể cả 4 phép trên) làm vector query **khác không gian** với 1.090 vector catalogue đã embed → phải đặt version mới `kim_canon_v4_*`, **re-index toàn bộ qua Trung tâm Vector AI** và A/B trên tập đóng băng trước khi bật (Gate D). Giai đoạn đầu chỉ nên dùng tracking để **thu ảnh đầu vào sạch hơn với thuật toán v3 giữ nguyên** — cùng thuật toán, đầu vào sạch hơn = mask sạch hơn mà không lệch profile.

### 10.3 Quy ước kích thước (Size Contract) — trả lời "ngang hay dọc"

Không lưu một con số "width". Quy ước đề xuất:

- **Lưu cặp `(length_mm, width_mm)` theo trục chính PCA**, khớp hệ quy chiếu canonical của Layer 1 (pipeline đã xoay trục chính về ngang trước khi crop):
  - `length_mm` = cạnh dài nhất (dọc trục chính), `width_mm` = cạnh còn lại, luôn `length ≥ width`;
  - Hệ quả: **bất biến với góc xoay chụp** — không còn mơ hồ ngang/dọc màn hình.
- **Hình vuông không cần special case**: `L ≈ W`; cờ hiển thị `shape_class = square` nếu `|L−W|/max(L,W) ≤ 5%` (chỉ để hiển thị/lọc nhóm, không dùng để tính).
- **Metric so khớp**: `d_max = max(|Lq−Lc|/max(Lq,Lc), |Wq−Wc|/max(Wq,Wc))`, **thử thêm bản hoán vị `(L,W)↔(W,L)`** để bắt lỗi người dùng đo nhầm cạnh; gate theo 2 tầng dung sai ở 5.4.
- **Bổ trợ chống nhầm cặp vuông**: `thickness_mm` (nếu đo được), `hole_diameters_mm`, `hole_pitches_mm` — hai tấm vuông cùng L/W nhưng khác cỡ/bước lỗ vẫn tách được.
- **UI hỏi người dùng**: "cạnh dài nhất (mm)" và "cạnh ngắn nhất (mm)" kèm sơ đồ minh hoạ — **không hỏi ngang/dọc**; lưu `dim_source` (`caliper|marker_photo|erp|user`) + `dim_confidence`; có nút "không rõ" (fail-open).
- Ghi chú: bảng proposal 5.3 đã đổi tên cột `width_mm/height_mm` → `length_mm/width_mm` cho khớp quy ước này.

### 10.4 Phân kỳ triển khai an toàn (không phá pipeline gốc)

| Giai đoạn | Thay đổi | Ảnh hưởng vector | Điều kiện |
|---|---|---|---|
| **S1 (an toàn)** | Subject locking + readiness + **hỏi/điền size sau khi khóa chủ thể (user-in-the-loop)**; Size Gate 2 tầng lọc pool ứng viên sau ANN, trước rankMetadata/structuralEvidence/fusion (điểm chèn 5.5-5); canonicalization giữ nguyên `kim_canon_v3_letterbox` | Không re-index; gate chỉ là filter phía query; thiếu size/thẻ → hành vi như cũ (fail-open) | Không cần Gate D |
| **S2 (đổi lõi)** | Matte + khử bóng/chói + làm phẳng sáng (10.2) → `kim_canon_v4_*` | Bắt buộc re-index 545 SKU / 1.090 vector qua Vector Center + A/B đóng băng | Gate D + owner duyệt |

Thứ tự trong câu trả lời tìm kiếm (S1): khóa chủ thể → (hỏi) size → ANN top-K → **Size Gate** → hình dạng/hình học + fusion hiện có → top 10. Đúng nguyên tắc "sàng lọc hình dạng + kích thước tương tự trước các bước sau" mà không đổi trọng số fusion giai đoạn đầu.

### 10.5 Bằng chứng cần thu (theo `TECH_DEBT_ROADMAP.md`)

- **Mask IoU** trên 30–50 ảnh gán nhãn tay + tỉ lệ mask `reliable` (mốc hiện tại: 7/93 development, 0/31 holdout — `DECISION.md`; **không** dùng lại holdout cũ để tuning).
- Bộ **size-pair hard negatives** + **unknown negatives** mới; Top1/Recall@10 trước–sau (S1); A/B S1 vs S2.
- **Test-retest px/mm** của thẻ chuẩn ≤ 1.5% (đo lặp ≥ 10 lần); chỉ số Size Gate precision loại trừ ≥ 99%, recall loại trừ theo §7.
- Regression: focused tests cho code mới; full suite/benchmark chỉ chạy khi owner cho phép chi quota.

### 10.6 Định nghĩa tác vụ đề xuất (chưa được kích hoạt)

- **[ĐỀ XUẤT] M27 — Subject Locking & Mask Purity (S1):** tap-to-lock + readiness + classifier bóng đổ/chói + voting đa khung + **hole-shape evidence** (phân loại tròn/vuông/oval từ mask, xem 11.5) trong camera modal (`index.html:2007-2123`, `src/app.js` captureCamera); đo mask IoU/reliable rate trên tập ảnh mới; **không** đụng canonicalization, không re-index. Exit evidence: focused tests + báo cáo mask quality.
- **[ĐỀ XUẤT] M28 — Size Contract & Size Gate (S1→S2):** chuẩn hoá cặp `(length_mm, width_mm)`, bảng proposal `catalogue_part_dimensions` (5.3), gate dung sai 2 tầng + UI nhập size; S2 gắn version canonicalization mới + re-index qua Vector Center. Exit evidence: size-pair benchmark + gate precision + A/B.
- Cả hai phụ thuộc câu trả lời **Q1–Q8 (§8)** và **Q9–Q11 (10.7)**; chưa đụng production, chưa re-index, chưa đổi runtime.

### 10.7 Câu hỏi mở bổ sung

- **Q9.** Chốt quy ước `(L, W)` theo trục PCA (cạnh dài ≥ cạnh ngắn, bất biến hướng) thay vì ngang/dọc màn hình? — đề xuất: chốt.
- **Q10.** Chấp nhận UX tap-to-lock cho ảnh mới (auto-lock chỉ chạy khi độ tin cậy cao) thay vì auto hoàn toàn?
- **Q11.** S2 (tái tạo chủ thể + re-index toàn bộ 1.090 vector qua Vector Center): đầu tư ngay sau S1 hay giữ `kim_canon_v3_letterbox` vô thời hạn? (S1 không cần re-index.)

---

## 11. Nghiệp vụ bổ sung — ca lỗi "sai hình dạng lỗ" & tận dụng đa ảnh catalogue (2026-10-17)

> Bổ sung theo xác nhận của chủ dự án: (a) ca mẫu 3421750001 (5 lỗ tròn) vs 3421760001 (4 lỗ + 1 lỗ vuông) bị tìm nhầm khi chỉ chụp 1 tấm từ trên xuống; (b) câu hỏi tận dụng mặt back + 2 ảnh chi tiết đã có trong catalogue; (c) phân tích dung lượng R2 10GB cho 900 mã × 4–5 ảnh. Toàn bộ mục 11 là phân tích/đề xuất, chưa triển khai.

### 11.1 Ca nghiệp vụ mẫu và khoảng trống B13

- Hiện tượng (evidence từ chủ dự án, không phải số liệu benchmark): tìm bằng camera Moris cho 3421750001 gần như luôn ra 3421760001; phải chụp thật kỹ mới thấy lỗ vuông và tìm đúng 3421750001, nhưng điểm thấp do góc chụp khiến hệ hiểu lỗ vuông thành lỗ tròn.
- Hai mã này **không xuất hiện** trong `evaluation/moris-v6/*` hiện có (đã kiểm tra); asset/vector production của hai mã **chưa xác minh được từ repo** — cần đọc read-only qua `app_list_catalogue_vector_items` (asset_type + has_vector) trước khi kết luận.
- Khoảng trống kỹ thuật: **không có bộ phân loại hình dạng lỗ từ ảnh**. Code hiện chỉ có: (1) text regex hiểu "lỗ vuông/lỗ tròn" (`featureMatcher.js:42-43`, `metadataFilter.js:36-38`, `textConstraints.js:34-36`) — nhưng từ **metadata text**, không từ ảnh; (2) phân cụm diện tích lỗ to/nhỏ (`classifyHoleSizes1D`); (3) EFD cho **contour ngoài** (`contourVerifier.js`, đang OFF). → ghi nhận **B13** (đã thêm vào §4).
- Vì vậy "1 ảnh từ trên xuống" chỉ giải quyết được nếu: mask đủ tin cậy + có phân loại hình dạng lỗ + geometry được đo/bật — cả ba đang thiếu/yếu (mask reliable 7/93; geometry OFF theo M22).

### 11.2 Hạ tầng đa ảnh đã có sẵn (không cần đổi hợp đồng ghi)

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| `image_assets` đa loại | Đã có `thumb/front/back/detail/compare` | `functions/api/upload.js:7`; RPC `app_search_catalogue` trả `front_path/back_path/detail_count` |
| Nén upload WebP client | front/back 1600px q.90 (iOS 1400/.85); detail 1300px q.90 (iOS 1100); thumb 420px q.75 | `src/app.js:1825-1832`, `:1748-1764` |
| Vector hóa từng asset | Vector Center list mọi asset + nút xử lý riêng + batch mọi asset; upsert nhận mọi `asset_type` (mặc định front) | `tools/moris-vector-center.js:325,466`; `functions/api/moris/vector-upsert.js:117,136` |
| Query đa ảnh | Server fuse tối đa **3 probe**/truy vấn (0.82 cosine + 0.12 RRF + 0.06 consensus), collapse best-hit/SKU | `functions/_lib/moris/v5/retrieval/multiProbeSearch.js:36`; `vectorHitCollapse.js:14` |
| Multi-view SKU pooling | Đã code, acceptance pending; snapshot 2026-10-16 ghi catalogue chỉ có front/thumb, 545 `single_face` | `docs/moris-v6/M18.md` |

Ghi chú mâu thuẫn cần xác minh: M18 snapshot (2026-10-16) nói chỉ front/thumb; chủ dự án xác nhận 3421750001 đã có back + 2 detail → dữ liệu có thể đã cập nhật sau snapshot; phải kiểm tra lại trước khi thiết kế. **Chuẩn asset chốt với chủ dự án (2026-10-17): tối đa 5/mã = thumb + front + back + 2 detail** — xem 11.4.

### 11.3 Đánh giá: tận dụng back + 2 detail được hay không?

**Được, nhưng giá trị chia theo 3 mức** (trung thực về giới hạn):

1. **Query đa ảnh (giá trị cao nhất cho ca mẫu):** nếu phép chụp cho phép thêm ảnh cận cảnh/back khi hệ chưa chắc, query detail sẽ khớp trực tiếp vector detail của catalogue → tăng đúng cặp 3421750001 và điểm cao hơn hẳn (giải quyết đúng trải nghiệm "chụp kỹ mới ra nhưng điểm thấp"). Server đã hỗ trợ tối đa 3 probe/truy vấn; muốn 4 ảnh (front+back+2 detail) phải nâng cap 3→5 (thay đổi nhỏ, cần focused test + đo).
2. **Nguồn xác thực đặc điểm (không cần thuật toán mới):** ảnh detail 1300px nhìn rõ lỗ vuông hơn front toàn phần; khi top-2 ứng viên khác nhau ở `identifying_features` (ví dụ "4 lỗ tròn + 1 lỗ vuông"), UI hiển thị đúng vùng lỗ từ ảnh detail của từng ứng viên để người vận hành phân biệt tức thì (human-in-the-loop, deterministic) + câu hỏi 1 chạm "chi tiết này có lỗ vuông không?".
3. **Index sẵn cho tương lai:** vector hóa back/detail qua Vector Center (write path đã sẵn sàng) — nhưng **cảnh báo fairness**: collapse lấy max similarity/SKU nên mã có nhiều view được lợi hơn; khi coverage chưa đồng đều (hiện tại) không được đưa multi-view vào ranking. Kế hoạch 900 mã × 4–5 ảnh **đồng đều** sẽ triệt tiêu bias này về mặt cấu trúc.

**Điều phải nói rõ:** với kịch bản "query chỉ 1 ảnh front từ trên xuống", back/detail **không tự động cứu** được ca mẫu (cosine front-vs-back thấp; outline tổng thể hai mã gần trùng). Thuốc chữa chính vẫn là: (a) **phân loại hình dạng lỗ từ mask query** (B13) + so chéo `identifying_features` catalogue; (b) câu hỏi phân biệt tự động khi top-2 khác đặc điểm; (c) nâng mask reliability (M27); (d) đo/bật geometry có kiểm soát khi có dữ liệu mới (M14/M21/M22).

### 11.4 Chuẩn 5 ảnh & dung lượng R2 cho 900 mã (ngân sách 10GB)

**Chuẩn dữ liệu chốt với chủ dự án (2026-10-17):** tối đa **5 asset/mã = thumb + front + back + 2 detail** (tối thiểu thực dụng 4 ảnh: front + back + 2 detail; thumb sinh tự động từ front). Khi upload lại 1 trong 5 loại: **phải xoá và thay** object cũ, không ghi chồng thêm — nhưng code hiện tại **chưa làm được** (B14/B15, xem dưới).

Nền tảng đã kiểm chứng: ảnh **nén WebP client-side trước khi lên R2** (11.2); key `assetType/code/uploadId.webp`; bucket `catalogue-images` (`wrangler.toml:23-25`).

Ước lượng kích thước/ảnh (theo tham số nén hiện có; **là ước lượng, cần đo pilot**):

| Loại | maxEdge | Quality | Ước lượng |
|---|---|---|---|
| front/back | 1600px | 0.90 | ~150–400KB |
| detail | 1300px | 0.90 | ~100–300KB |
| thumb | 420px | 0.75 | ~15–40KB |

Tổng theo chuẩn 5 ảnh (900 mã = **4.500 ảnh**):

| Kịch bản | Công thức | Tổng |
|---|---|---|
| 5 ảnh/mã nén WebP (trung vị ~0.2MB/ảnh) | 4.500 × ~0.2MB | **~0.8GB** (bi quan 400KB/ảnh → **~1.3GB** vẫn an toàn) |
| Ngưỡng chạm 10GB | 10GB ÷ 4.500 ảnh | **~2.2–2.4MB/ảnh trung bình** (tuỳ định nghĩa GB) |
| Nếu KHÔNG nén (ảnh gốc 3–5MB) | 4.500 × 3–5MB | **~13.5–22.5GB → VƯỢT** |

**Trả lời chốt: 4.500 ảnh KHÔNG vượt 10GB** miễn giữ pipeline nén WebP — thực tế ~0.8–1.3GB, còn cách ngưỡng ~8–9GB. Chỉ vượt nếu trung bình > ~2.3MB/ảnh (tức upload ảnh gốc không nén).

Lưu ý vận hành:

- Mỗi `detail` thêm ≈ 100–300KB × 900 ≈ 90–270MB; chuẩn mới là **đúng 2 detail/mã** (nên giới hạn mềm `detail_count ≤ 2` theo chuẩn).
- **B14 (mới, đã xác minh code):** thay ảnh trong editor (`savePart` `src/app.js:1889` → `mergeAsset` `:1883` → `app_replace_part_assets` `:1945`) chỉ đổi đường dẫn trong DB; object R2 cũ (key `uploadId` cũ) **không bị xoá** — không có lệnh `CATALOGUE_BUCKET.delete` nào trong luồng upload/save; chỉ `bulk-delete.js:81-93` và `delete-all.js` mới purge. → Yêu cầu "thay là xoá" của chủ dự án **chưa được đáp ứng**: mỗi lần thay ảnh phình thêm 1 object (100–400KB). Phải sửa (M30) **trước** khi backfill 900 mã.
- **B15 (mới):** xoá 1 mã qua `delete-part.js` **không purge R2** (chỉ xoá DB + vector); chỉ bulk-delete purge → mã xoá lẻ để lại toàn bộ ảnh mồ côi.
- Vector (Supabase, **không** tính vào R2): 4.500 halfvec(384) ≈ vài chục MB kèm metadata — không đáng kể. Chi phí thật nằm ở **thời gian inference Vector Center** cho 3.600–4.500 ảnh và quota thiết bị.

### 11.5 Bổ sung kế hoạch & câu hỏi mới

- **Đo lường mới (bắt buộc):** bộ ảnh thật cho cặp 3421750001/3421760001 nhiều góc (top-down xa, nghiêng, cận cảnh lỗ) + nhãn; đưa vào M21 như hard-negative; ablation multi-view (front-only vs +detail vs +back) trên tập đóng băng.
- **M27 bổ sung hạng mục "hole-shape evidence"**: phân loại tròn/vuông/oval theo contour từng lỗ (circularity + độ đồng đều bán kính + approx-polygon), chỉ dùng khi mask reliable; so chéo `identifying_features`.
- **M30 đề xuất mới — Asset Lifecycle & R2 Hygiene:** sửa **B14** (thay ảnh phải xoá object R2 cũ) + **B15** (xoá 1 mã phải purge R2 như bulk-delete); audit object mồ côi; đo pilot dung lượng thật thay ước lượng. Đây là điều kiện tiên quyết trước khi backfill 900 mã × 5 ảnh.
- **Câu hỏi mới:**
  - **Q12.** 900 mã sẽ có đủ 5 ảnh (thumb/front/back/2 detail) cho **tất cả** hay chỉ một phần? (coverage đồng đều quyết định có được dùng multi-view vào ranking).
  - **Q13.** Có cho phép UI chụp thêm tối đa 3 ảnh (cận cảnh/back) khi hệ chưa chắc, thay vì bắt buộc 1 ảnh front? (cần nâng probe cap 3→5 + focused test).
  - **Q14.** Duyệt chạy Vector Center index back/detail cho 900 mã ngay khi hoàn tất dữ liệu (ước tính 3.600–4.500 lượt embed)?
  - **Q15 — ĐÃ TRẢ LỜI (2026-10-17):** chủ dự án yêu cầu **bắt buộc xoá object R2 cũ khi thay ảnh** (không ghi chồng thêm). Code hiện chưa đúng → việc P0/P1 trong M30 (§12).

---

## 12. Kế hoạch thực thi chi tiết (chốt 2026-10-17 — cho phiên sau)

> Tổng hợp toàn bộ lập luận Phần 0–11 thành chương trình thi công. Nguyên tắc bất di bất dịch: **S1 trước S2**; không re-index/đổi canonicalization/deploy production khi chưa qua Gate D; mọi kết luận kèm evidence (test/log/số đo thật); giữ quota theo `HANDOFF.md`; không đụng 2FA/RLS/CSRF/anti-bot; giữ nguyên dirty tree và các file owner đã xoá.

### 12.1 Quyết định đã chốt (không bàn lại)

| # | Quyết định | Nguồn / trạng thái |
|---|---|---|
| 1 | Chuẩn asset/SKU: tối đa 5 = thumb + front + back + 2 detail (thumb tự sinh từ front) | chủ dự án 2026-10-17 |
| 2 | Thay ảnh trên R2 **phải xoá object cũ**, không ghi chồng thêm | chủ dự án 2026-10-17; code hiện chưa đúng (B14) |
| 3 | Ngân sách R2: 4.500 ảnh nén WebP ≈ 0.8–1.3GB — **không vượt 10GB** (11.4) | tính toán; số thật chốt bằng pilot |
| 4 | Kích thước: cặp `(length_mm, width_mm)` theo trục PCA, `L ≥ W`, UI hỏi cạnh dài/ngắn | 10.3; chờ Q9 xác nhận lần cuối |
| 5 | Không dùng generative inpainting; tái tạo chủ thể chỉ bằng phép deterministic | 10.2 |

### 12.2 Chương trình milestone đề xuất

| Mã | Tên | Trạng thái | Phạm vi chính | Phụ thuộc | Gate |
|---|---|---|---|---|---|
| **M27** | Subject Locking & Mask Purity (+ hole-shape evidence) | proposed | Tap-to-lock, readiness 5 điều kiện, classifier bóng/chói, voting đa khung, phân loại lỗ tròn/vuông/oval khi mask reliable | Q9, Q10, Q13; ảnh pilot | S1 — không re-index |
| **M28** | Size Contract & Size Gate | proposed | Cặp (L,W) + bảng `catalogue_part_dimensions` (5.3), UI nhập size, gate 2 tầng phía query (fail-open) | Q1–Q8, Q9; dữ liệu size 900 mã | S1; tạo bảng DB → Gate D khi áp production |
| **M29 (mới)** | Multi-view & Capture Enrichment | proposed | Ép chuẩn 5 ảnh; index back/detail qua Vector Center; nâng probe cap 3→5 (có test); câu hỏi phân biệt tự động từ `identifying_features`; fairness rule multi-view | Q12, Q14; coverage đồng đều; M18 | S1 |
| **M30 (mới)** | Asset Lifecycle & R2 Hygiene | proposed | Sửa **B14** (xoá object cũ khi replace) + **B15** (purge R2 khi xoá 1 mã); audit orphan; quota monitor | Q15 (đã có); duyệt P0 | focused tests, không cần Gate D |
| **EVAL (mới)** | Dữ liệu & đo lường hợp nhất | proposed | Dataset đóng băng + hard-negative cặp 3421750001/3421760001 + size-pair + unknown negatives; mask IoU; ablation multi-view & geometry | pilot ảnh xong | manifest SHA-256 |
| **S2** | Re-canonicalization v4 + re-index | chờ duyệt | Matte/khử bóng-chói/làm phẳng sáng → `kim_canon_v4_*`; re-index 4.500 vector qua Vector Center + A/B | Gate D + owner | riêng |

### 12.3 Thứ tự thi công P0 → P3

**P0 — chủ dự án (không code, làm trước phiên sau):**
1. Trả lời **Q1–Q15** (§8, §10.7, §11.5).
2. Xác minh read-only 2 mã 3421750001 / 3421760001 trên Trang Trung tâm Vector AI (danh sách asset: `asset_type` + `has_vector`) → chốt M18 snapshot (11.2).
3. Duyệt phạm vi **M30** (sửa B14/B15) — chặn trước backfill 900 mã.

**P1 — code S1 (mỗi việc kèm focused test, không đụng production data):**
1. **M30**: xoá object R2 cũ khi thay ảnh + purge khi xoá 1 mã (đối xứng bulk-delete). Exit: focused test + log key bị xoá.
2. **Pilot 20 mã**: chụp đúng chuẩn 5 ảnh → **đo dung lượng WebP thật** (thay ước lượng 11.4) → index Vector Center front+back+detail → đọc lại listing xác nhận.
3. **M27**: tap-to-lock + readiness + shadow/specular classifier + voting + hole-shape evidence. Exit: mask IoU + tỉ lệ reliable + độ chính xác hole-shape trên tập ảnh nhãn; **không** đổi canonicalization.
4. **M28**: UI size (cạnh dài/ngắn + nút "không rõ") + gate 2 tầng sau ANN, fail-open. Exit: size-pair benchmark + gate precision.

**P2 — đo lường:**
1. **EVAL**: đóng băng dataset + manifest SHA-256; không tái dùng holdout cũ.
2. Chạy: mask quality, hole-shape accuracy, size gate precision/recall-loại-trừ, Top1/Recall@10 trước–sau S1, ablation multi-view (front-only vs +detail vs +back). Chỉ chạy trong quota đã thoả thuận.
3. Quyết định có đủ dữ liệu để xét bật geometry không (feed M14/M15/M16/M18/M22).

**P3 — gated (chỉ sau P2 + owner duyệt):**
1. S2 re-canonicalization + re-index 4.500 vector + A/B đóng băng → Gate D.
2. Nếu A/B thắng: cập nhật runtime/build fingerprint; nếu không: giữ `kim_canon_v3_letterbox`.

### 12.4 Exit evidence & rollback

| Việc | Exit evidence | Rollback |
|---|---|---|
| M30 | focused test xoá đúng key / không xoá sai key; log R2 | tắt lời gọi xoá — ảnh không mất |
| Pilot ảnh | bảng dung lượng thật/ảnh + listing Vector Center | chỉ đụng ảnh pilot |
| M27 | mask IoU + reliable rate + hole-shape accuracy (tập nhãn) | feature flag camera |
| M28 | gate precision ≥ 99% loại trừ; fail-open khi thiếu size | tắt gate = hành vi cũ |
| EVAL | manifest SHA-256 + JSON kết quả | dataset đóng băng |
| S2 | A/B v4 vs v3 trên tập đóng băng | giữ v3 + vector cũ; re-index lặp được |

### 12.5 Việc KHÔNG làm (chống trôi phạm vi)

- KHÔNG re-index/đổi canonicalization trong P1 (chỉ ở S2/P3).
- KHÔNG bật geometry/contour/patch dù code có sẵn (giữ M22 NO-GO tới khi EVAL mới).
- KHÔNG đưa multi-view vào ranking khi coverage 900 mã chưa đồng đều (fairness, 11.3).
- KHÔNG commit/push/deploy khi chưa được yêu cầu; không restore file owner đã xoá.
