# Moris V6 — Technical Debt Register (Sổ nợ kỹ thuật)

Cập nhật: 2026-10-17 (phiên M28 + hardening + purge R2). Mục đích: điểm vào nhanh cho **agent phiên kế tiếp** —
liệt kê toàn bộ nợ kỹ thuật đang mở, kèm bằng chứng `file:line`/log, blocker, hành động kế tiếp và **test cần viết**.
Tài liệu này bổ sung cho `docs/moris-v6/TECH_DEBT_ROADMAP.md` (thứ tự gate M06–M26) và `state.json` (`tasks[]`, `moris_v6`).

**Trạng thái nền hiện tại (đã kiểm chứng 2026-10-17):**

- `npm test` → **49 files / 475 tests pass 100%**; `npx tsc --noEmit` exit 0; `npm run build` **46 files** exit 0 (đã loại `.ts` khỏi dist — BUILD-01).
- M27 (subject lock) + M28 (size contract/gate) + M30 (B14/B15 + purge R2) đã xong **local**; chưa deploy, chưa commit (trừ khi chủ dự án yêu cầu).
- R2 purge đã thực thi theo phê duyệt: **376/376 object (11.14MB)**; bucket còn 1170 objects/32.22MB; orphan còn **77 (chỉ `parts/`)**; missing 0.
- Migration `20261017090000_catalogue_part_dimensions_proposal.sql` là **PROPOSAL ONLY** — Gate D chưa duyệt.

---

## 1. Nợ chờ dữ liệu / phê duyệt (blocker cứng — không tự làm)

| ID | Nợ | Bằng chứng | Blocker / điều kiện mở | Hành động kế tiếp | Test cần viết |
|---|---|---|---|---|---|
| GATE-D-01 | Áp bảng `catalogue_part_dimensions` + nạp dữ liệu đo kẹp (Q7 đo chậm) | `supabase/migrations/20261017090000_catalogue_part_dimensions_proposal.sql`; `functions/_lib/moris/v5/retrieval/sizeGate.js:loadCandidateDims` đã fail-open khi bảng chưa có | Gate D + chủ dự án duyệt; dữ liệu đo thật | Xin phê duyệt Gate D; ưu tiên đo các mã hay nhầm (Q7) | Đã có `tests/moris-size-gate.test.js` (404→null, cap 100 id); bổ sung test mapping `method`/`confidence` khi có dữ liệu thật |
| PILOT-01 | Pilot P1.2: 20 mã chụp theo thẻ chuẩn 4 marker — đo dung lượng WebP thật, index Vector Center front/back/detail, đọc lại listing | `pipeline_moris.md` §11.4/§12.3; ảnh `image 2/` là ảnh thô chưa theo thẻ chuẩn | Cần ảnh thật do chủ dự án chụp | Chạy harness `tools/eval-m27-real-photos.mjs` trên bộ pilot | Bổ sung harness đo **size-pair precision** của M28 + mask IoU có nhãn người |
| EVAL-01 | Dataset đóng băng mới + manifest SHA-256; 57-item hard-negative M21 (hiện **0/57** nhãn người) | `docs/moris-v6/M21.md`, `tools/review-moris-hard-negatives.mjs`; `TECH_DEBT_ROADMAP.md` dòng 19–20 | Chưa có nhãn người + holdout mới (holdout 31 ảnh cũ đã tiêu thụ, cấm tái dùng) | Review queue 57 mục; ghi 3 cặp mã Q4 (`3446950001/3446960001`, `3440010001/3889630101`, `3400530401/3462530001`) làm hard-negative khi có ảnh chuẩn | Test đọc manifest khẳng định split dev/holdout không giao nhau |
| M29-01 | Multi-view & Capture Enrichment — BLOCKED | `state.json moris_v6.M29`; Q13 giữ probe cap 3; Q14 chờ pilot | Kết quả pilot P1.2 | Không làm gì đến khi pilot xong | — |
| M18-01 | Acceptance multi-view pooling (đã code, chưa nghiệm thu) | `docs/moris-v6/M18.md`; xác minh read-only: 3421750001 có back+detail×2, 3421760001 chỉ front+thumb (chưa đồng đều) | Coverage đồng đều + ablation trên tập đóng băng | Chờ PILOT-01/EVAL-01 | Test fairness: candidate thiếu view không được cộng điểm multi-view |
| M22-01 | Geometry verifiers OFF (NO-GO trên dev split) | `functions/_lib/moris/v5/runtime/config.js:7-14` (`geometryVerification:false`…) | Chỉ mở khi dữ liệu mới chứng minh thắng; **cấm** tune lại holdout cũ | Chờ EVAL-01 | Giữ nguyên test ablation hiện có (`tests/moris-ablation.test.js`); không viết test mới đòi mở geometry |
| PROFILE-01 | Rủi ro fallback profile trong `searchVectorIndex` khi profile mới trả 0 dòng (query vector hybrid so với DB `cls_l2_v1`) | `functions/_lib/moris/v5/vector/search.js:49-63` | Cần xác minh read-only trạng thái re-index production | Kiểm tra read-only qua Vector Center/PostgREST khi được phép; không tự sửa | Test ghim hành vi fallback hiện tại (không silent error) |

## 2. Nợ vận hành / hạ tầng

| ID | Nợ | Bằng chứng | Mức độ | Hành động kế tiếp | Test cần viết |
|---|---|---|---|---|---|
| R2-01 | 77 object legacy prefix `parts/` giữ lại sau purge (ngoài `KEY_PATTERN` của purge-assets) | `/tmp/opencode/r2-purge-log.json`, `/tmp/opencode/r2-audit-after-purge.json` | Thấp (1.4MB) | Chờ chủ dự án quyết purge/giữ; nếu purge: mở `KEEP_PREFIXES` của `tools/r2-purge-orphans.mjs` | Test dry-run khẳng định `parts/` vẫn nằm trong KEEP mặc định |
| R2-02 | Quota monitor R2 (ngưỡng 10GB) chưa làm | `pipeline_moris.md` §11.4 (toán 4.500 ảnh ≈ 0.8–1.3GB) | Thấp | Viết script đọc usage; chỉ chạy read-only | Test parse output usage (fixture) |
| DEPLOY-01 | Chưa deploy bất kỳ thay đổi nào (M27/M28/M30 + purge) | `state.json` mọi task `deployed:false` | Trung bình | Chờ yêu cầu chủ dự án; theo `RELEASE_CHECKLIST.md` + M26 | — |
| SEC-01 | `GITHUB_TOKEN_PQV...` nằm trong `.env` local | `.env` (gitignored — `git check-ignore` xác nhận; `git grep ghp_` = 0 file tracked) | Thấp | Khuyến nghị xoay token nếu từng chia sẻ ngoài máy; tuyệt đối không thêm vào `PUBLIC_CONFIG_KEYS` | Giữ test build-static deny `.env` (`tests/frontend.test.js`) |
| TOOL-01 | `jpeg-js` cài `--no-save` (chỉ có trong `node_modules`, không reproducible trên máy mới) | `package.json` không có dependency; node_modules có jpeg-js | Thấp | Hoặc thêm dependency chính thức, hoặc bỏ hẳn nếu không còn dùng | Test import guard nếu giữ |
| BUILD-01 | ✅ ĐÃ SỬA 2026-10-17: `.ts` nguồn từng lọt vào `dist` (5 file `moris-*.ts`) — `tools/build-static.mjs` giờ loại cả `.mjs` + `.ts`; `tests/frontend.test.js` ghim 5 đường dẫn phải vắng mặt; build còn 46 files | `tools/build-static.mjs` (walk); test ghim `dist/src/moris/moris-*.ts` | Đã đóng | — | — |
| DOC-01 | ✅ ĐÃ SỬA 2026-10-17: `TECH_DEBT_ROADMAP.md` đã đồng bộ (bỏ refs `MORIS_V6_MASTER_PLAN.md` đã xoá — trỏ `git show 2657b49:<file>`; branch `feat/moris-v6` → `main`; liên kết register này) | `TECH_DEBT_ROADMAP.md` | Đã đóng | — | — |

## 3. Nợ kiểm thử (test backlog — ưu tiên cho phiên sau)

| # | Test cần viết | Mục đích | File gợi ý |
|---|---|---|---|
| T1 | ✅ ĐÃ VIẾT 2026-10-17 — 5 test tích hợp: gate sau hydrate lọc match/unknown + `size_evidence`; pool rỗng → `MORIS_SIZE_GATE_NO_MATCH`; bảng 404 → `dims_unavailable` giữ nguyên pool; tắt config / thiếu query size → không gọi dims | Ghim hành vi lắp ghép trong `orchestrator.js` (gate sau hydrate trước `rankMetadata`) bằng fetch stub dims thật | `tests/moris-size-gate-orchestrator.test.js` |
| T2 | UI contract test cho panel M28: `setCameraSizeUnknown(false)` khi gõ input; hint đổi trạng thái; payload size truyền đủ 4 tham số `sendMorisMessage` | Đã có assertion tĩnh `frontend.test.js`; chưa test hành vi | `tests/frontend.test.js` (đọc source) hoặc tách test đọc `src/app.js` |
| T3 | Đo size-pair precision/recall-loại-trừ của gate trên pilot (exit evidence M28 §12.4: ≥99%) | Chưa có số thật — **không được bịa**; cần ảnh pilot | Harness mới `tools/eval-m28-size-pair.mjs` |
| T4 | Mask IoU với ground-truth do người gán nhãn (alpha chỉ có 4 cutout) | Nợ còn lại của M27 | Mở rộng `tools/eval-m27-real-photos.mjs` |
| T5 | Test mapping dữ liệu thật `catalogue_part_dimensions` (method/confidence) sau Gate D | Chống hồi quy khi nạp dims thật | `tests/moris-size-gate.test.js` |
| T6 | ✅ ĐÃ VIẾT 2026-10-17 — 2 test: response 200 JSON không phải mảng → `null`; body không phải JSON → `null` (không ném) | Ghim nhánh fail-open còn lại của `loadCandidateDims` | `tests/moris-size-gate.test.js` |
| T7 | Test cho `purge-assets` với key `parts/` legacy (khi quyết định mở pattern) | Chống xoá nhầm | `tests/catalogue-delete.test.js` |

## 4. Nợ tài liệu / quy trình

- **DOC-01** ở mục 2 (đồng bộ roadmap cũ).
- `plan.md` các mục P2/P3 còn `[ ]`: EVAL đóng băng, S2 + A/B — đúng trạng thái (chưa được kích hoạt).
- `image 2/` (129 file) là dữ liệu tham chiếu của chủ dự án — **không** commit, **không** xử lý thêm nếu chưa được yêu cầu.
- Dirty tree: giữ nguyên các thay đổi chưa commit (M27/M28/M30 + docs). **Không** reset/clean/stash theo AGENTS.md.

## 5. Việc TUYỆT ĐỐI không được làm (nhắc lại Hiến pháp)

1. Không tạo vector/ghi index từ Editor; chỉ Trung tâm Vector AI khi người dùng xác nhận.
2. Không sửa database production / apply migration proposal nếu chưa Gate D + chủ dự án duyệt.
3. Không deploy, không commit khi chưa được yêu cầu.
4. Không bịa số liệu đo lường — mọi số phải từ log/harness thật (đã ghim 2026-10-17: focused 60/60, full 49 files/475 tests, build 46 files, purge 376/376).
5. Giữ nguyên auth/2FA/RLS/CSRF/anti-bot; không mở policy anon cho bảng dims.
