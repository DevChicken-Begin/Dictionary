# MORIS V6 — KẾ HOẠCH NÂNG CẤP DÀNH CHO CODEX CLI

> **Ủy quyền phiên 2026-10-16:** Chủ dự án yêu cầu chạy loop tuần tự từng task đến hết plan. Quy tắc giao từng prompt/dừng xin phép giữa các task được thay bằng checkpoint có test, bằng chứng, rủi ro và rollback trước khi chuyển task. Giữ nguyên điều kiện nghiệm thu; thiếu dữ liệu hoặc bằng chứng thì để `[ ]`. Không ghi production, không deploy; Gate D/E và phê duyệt dung lượng vẫn bắt buộc.

**Repository:** `PQVinh99-Glory/Dictionary`  
**Baseline đã review:** `main` / `02289afa79747722b992938bee7c2d0414f7a9d2` (2026-10-14)  
**Ngày lập kế hoạch:** 2026-10-16  
**Trạng thái:** KẾ HOẠCH, **không phải bằng chứng đã triển khai**.

> **Lối vào agent tiếp theo:** xem [roadmap nợ kỹ thuật](docs/moris-v6/TECH_DEBT_ROADMAP.md) và [handoff](docs/moris-v6/HANDOFF.md) trước khi chọn task; `state.json` là trạng thái hiện hành, checkpoint cũ bên dưới chỉ là lịch sử.

> Hệ thống hiện có Cloudflare Pages Functions + Supabase pgvector + Cloudflare R2, frontend static Vue/CDN và DINOv2 Web Worker. Bản kế hoạch này bám vào source đã review; Codex phải đọc lại file và kiểm tra HEAD trước khi sửa. **Không tự sửa production, không tự deploy, không tự xoá vector.**

## 0. BẤT BIẾN NGHIỆP VỤ — TUYỆT ĐỐI KHÔNG VI PHẠM

1. **Save/Create/Update trong Editor chỉ lưu metadata và ảnh; TUYỆT ĐỐI KHÔNG tạo/upsert/re-index vector.** Không gọi Worker DINOv2, `/api/moris/vector-upsert`, auto-queue hoặc offline signature enrollment từ Editor.
2. **Trung tâm Vector AI là nơi duy nhất chủ động tạo, thay thế, re-index vector** (single hoặc batch, khi có thao tác người dùng và quyền hợp lệ). Gỡ nút vector tại Editor. Mở Center, xem status, xem ảnh không được tự phát sinh vector.
3. **Không phình dữ liệu:** cùng một image asset + model + model version + preprocess + profile + view variant, thao tác lặp là idempotent (skip hoặc replace có chủ đích), không insert vô hạn. Không tự triển khai thêm biến thể `canon_gray_v2` hàng loạt: hiện production 545 SKU / 1.090 vector RGB (545 thumb + 545 front). Thử nghiệm variant phải có A/B và phê duyệt dung lượng.
4. Ảnh thay đổi => đánh dấu `stale` hoặc `needs_vector_update` ở Center; KHÔNG tự re-embed. Không tự huỷ/xoá vector cũ lúc save; thay thế/inactivate có quy trình và phê duyệt riêng.
5. **Query embedding** (tạo tạm khi người dùng tìm kiếm ảnh) khác với **index vector** (ghi lâu dài lên Supabase). Cấm chặn truy vấn tìm kiếm ảnh chỉ vì cấm auto indexing.
6. Bảo toàn đăng nhập/Gatekeeper 2FA, RLS, CSRF/anti-bot, CRUD catalogue, text chat, tìm mã/ID, mobile; không đưa service role/secret ra trình duyệt.
7. Một task = một phạm vi nhỏ/PR hoặc commit được review; không sửa assertion chỉ để tests xanh, không tuyên bố metric khi chưa đo; rollback rõ ràng.

## 1. Vấn đề thực tế được ghi nhận trong review

- `src/app.js` Editor có nút `vectorizeCurrentEditorPart()` và helper `vectorizeSavedPart()` dù auto-save flag đã OFF; **M02 phải gỡ luồng này chứ không khôi phục nút**.
- API `vector-upsert.js` kiểm tra trùng theo `record_id` + `asset_type`, quá rộng so với key có `view_variant`: biến thể thứ hai có thể bị bỏ qua.
- Worker có hybrid 384D (patch GeM/edge) và fallback CLS 384D cùng profile `cls_l2_v1`; cần định danh/fail-closed thay vì so sánh các biểu diễn khác cách tính.
- `scoreFusion.js` tính kết quả trước rồi `geometricReranker.js` ghi đè `final_score`; nhiều bằng chứng có thể bị mất.
- SQL `app_search_catalogue` cap 300, trong khi `src/app.js` gọi `p_limit:2000` cho filter → nguy cơ bỏ sót mã.
- Dữ liệu được đo read-only tại thời điểm review: 545 SKU, 1.090 vector active, 0 `canon_gray_v2`, tất cả `quality_score` NULL; 55/545 cặp `thumb/front` lệch số lỗ; 507/545 SKU thiếu `identifying_features`.
- Phép thử cross-view 80 mã: 78/80 top1, 79/80 top10, 80/80 top50 khi tra `thumb` so với tập `front`. Đây **không** là benchmark ảnh camera thực tế.

## 2. Quy trình triển khai cho Codex CLI

### Cách chạy

- Chạy trên môi trường phát triển được phép dùng Node >=22/Codex. Nếu PC công ty có Falcon hạn chế cài đặt/npm, dùng dev machine hoặc cloud runner đã được phê duyệt; **không vô hiệu hoá biện pháp bảo mật công ty**.
- Clone repo hoặc dùng checkout sạch; xác nhận `git status --short` và `git rev-parse HEAD` trước khi viết.
- Tạo nhánh `feat/moris-v6` từ main đã xác nhận. Không checkout/overwrite những thay đổi chưa commit của người khác.
- Đọc `AGENTS.md`, `state.json`, `plan.md` trước mỗi task; với task chỉ là khảo sát/chưa có bằng chứng phải để checklist `[ ]`.
- Trong Codex CLI, **mỗi lần chỉ giao đúng một task Mxx** từ file `CODEX_MORIS_V6_TASK_PROMPTS.md`; task xong mới đánh giá và chuyển task tiếp theo.
- `npm ci` / `npm test` / `npm run build` trên môi trường cho phép; TypeScript check chỉ chạy khi đã có compiler hợp lệ, không vô tình tải `tsc` lạ qua `npx`.
- Không tự tạo migration SQL suy đoán; trước bước nào đụng DB phải đọc schema/RPC thật và qua phê duyệt. Task định nghĩa migration và dry-run **không đồng nghĩa được áp dụng production**.

### Definition of Done (ÁP DỤNG CHO MỌI TASK)

1. Tóm tắt phát hiện trước sửa: file, hàm, cơ chế lỗi, rủi ro.
2. Diff tối thiểu, không sửa ngoài phạm vi; giữ compat API trừ khi task quy định.
3. Bổ sung regression test **trước hoặc cùng với fix**; báo lệnh, exit status và output thật.
4. Kiểm tra không tăng `catalogue_image_vectors` nếu không có thao tác explicit ở Center. Nếu task read-only: zero write.
5. Với thay đổi code ảnh/tìm kiếm: test cả ảnh không có lỗ, ảnh lỗi mask, left/right, front/back và phân biệt `unknown` với `0` khi liên quan.
6. Ghi `before/after`, tác động hiệu năng/tài nguyên và rollback path.
7. Chỉ đánh dấu checklist `[x]` khi có output đủ; cập nhật `state.json` và append lịch sử vào `plan.md` theo quy chuẩn repo. Không chỉnh sai baseline cũ.

### Gates (PHẢI DỪNG ĐỂ REVIEW)

- **GATE A:** Sau M05 — Editor không còn bất kỳ đường upsert nào; Center single/batch theo click, idempotency được test.
- **GATE B:** Sau M11 + M20 — Embedding contract ổn, benchmark baseline có thể tái lập, fix phân trang.
- **GATE C:** Sau M22 — Có báo cáo ablation trên tập gán nhãn; tính năng chưa chứng minh lợi ích không tự bật.
- **GATE D:** Trước migration hay reindex production — Chủ dự án duyệt số hàng dự kiến, dự phòng lưu trữ, backup và rollback.
- **GATE E:** Trước deploy — Full suite, staging E2E, kiểm tra an toàn và ký duyệt rollout.

## 3. Sơ đồ thứ tự khuyến nghị

`M00 → M01 → M02 → M03 → M04 → M05` **(ưu tiên cao nhất)**  
`M01 → M06 → M07 → M08 → M13 → M14`  
`M06 → M09 → M12 → M17 → M18`  
`M00 → M10`  
`M02 + M05 + M06 → M11`  
`M00 → M19 → M20`; `M08 + M19 + M20 → M21`  
`M07 + M13 → M15`; `M06 + M09 + M15 → M16` (tùy kết quả)  
`M12 + M14 + M15 + M17 + M18 + M20 + M21 → M22`  
`M04 + M05 + M08 + M22 → M23 → M24`; `M17 + M18 + M22 → M25`; `M23 + M24 + M25 → M26`.

M19/M20 được khởi động sớm song song với các task thuật toán vì benchmark là thước đo chứ không phải bước cuối.

## 4. Checklist tổng thể

### Phase A — Khóa luồng ghi vector và bảo vệ Editor

- [x] **M00 · P0** — Đóng băng baseline, xác minh branch và trạng thái test (deps: Không)
- [x] **M01 · P0** — Định nghĩa quyền sở hữu ghi vector và các invariants (deps: M00)
- [x] **M02 · P0** — Gỡ toàn bộ auto-vector/Vector nút Editor; Save chỉ lưu metadata/ảnh (deps: M01)
- [x] **M03 · P0** — Giới hạn mọi thao tác tạo vector vào Trung tâm Vector AI (deps: M02)
- [x] **M04 · P0** — Thiết kế upsert idempotent, chống nhân bản vector (deps: M03)
- [x] **M05 · P1** — Xác định trạng thái vector theo ảnh nguồn: missing/ready/stale/partial (deps: M04)

### Phase B — Chuẩn dữ liệu, vector và truy xuất

- [x] **M06 · P0** — Khóa hợp đồng embedding profile và đường fallback (deps: M01)
- [x] **M07 · P1** — Chính thức hóa canonicalization + quality gate (deps: M06)
- [x] **M08 · P1** — Geometry contract: phân biệt unknown và zero; kiểm tra nhất quán lỗ (deps: M07)
- [x] **M09 · P1** — Chuẩn hóa candidate retrieval và filters ở server (deps: M06)
- [x] **M10 · P1** — Sửa giới hạn phân trang lọc catalogue 300 vs 2000 (deps: M00)
- [x] **M11 · P1** — Quản trị riêng IndexedDB offline và bỏ side-effect Editor (deps: M02, M05, M06)

### Phase C — Benchmark sớm, thuật toán hình học và ranking

- [x] **M12 · P0** — Một nguồn tính điểm cuối duy nhất; không ghi đè fusion (deps: M09)
- [x] **M13 · P1** — Quy tắc orientation / mirror / chirality (deps: M07, M08)
- [ ] **M14 · P1** — Hole topology V2 — assignment tối ưu, xử lý đếm thiếu (deps: M08, M13)
- [ ] **M15 · P1** — Contour verifier và EFD có bảo vệ chất lượng mask (deps: M07, M13)
- [ ] **M16 · P2** — Local spatial patch reranking có feature flag (deps: M06, M09, M15)
- [x] **M17 · P1** — Reliability-aware fusion, thiếu tín hiệu không thưởng/phạt (deps: M12, M14, M15)
- [ ] **M18 · P1** — Multi-view candidate fusion và tập kết quả cấp SKU (deps: M09, M12, M17)
- [x] **M19 · P0** — Dataset manifest và chính sách ground truth (deps: M00)
- [x] **M20 · P0** — Evaluation CLI với top1/recall@10,@50/MRR/abstain/p95 (deps: M19)
- [ ] **M21 · P1** — Bộ hard-negative regression cơ khí (deps: M08, M19, M20)
- [ ] **M22 · P0** — Ablation, tuning và quyết định go/no-go bằng số liệu (deps: M12, M14, M15, M17, M18, M20, M21; M16 tùy chọn)

### Phase D — Migration, Trung tâm Vector AI, rollout

- [x] **M23 · P0** — Thiết kế migration an toàn, backup, dry-run và quota (deps: M04, M05, M08, M22)
- [x] **M24 · P0** — Trung tâm Vector AI: reindex thủ công theo batch có preview/dry-run (deps: M03, M04, M05, M06, M23)
- [x] **M25 · P1** — UI Moris: confidence có căn cứ, lý do khớp, low-quality/reject (deps: M17, M18, M22)
- [ ] **M26 · P0** — Staging E2E, canary, rollback và xác nhận phát hành (deps: M23, M24, M25)

## 5. Đặc tả chi tiết từng task

### M00 — Đóng băng baseline, xác minh branch và trạng thái test

**Nhóm:** Phase A · **Ưu tiên:** P0 · **Phụ thuộc:** Không  
**Files cần kiểm tra (không tự suy đoán thêm):** `AGENTS.md`, `state.json`, `plan.md`, `package.json`, `tests/`

**Công việc Codex phải làm:** Xác nhận SHA gốc; mở nhánh `feat/moris-v6`; chụp thống kê read-only (số SKU, vector, loại view, phiên bản); ghi lại lệnh và kết quả `npm test`, `npm run build`, `npm exec --no -- tsc --noEmit` nếu có TypeScript hợp lệ. Không sửa production, không dùng số test trong state.json làm bằng chứng đã chạy. Tạo `docs/moris-v6/BASELINE.md`.

**Test bắt buộc:** `git status --short`; `git rev-parse HEAD`; log chạy kiểm thử thực tế, nêu rõ lệnh không thể chạy.

**Nghiệm thu:** Có snapshot số liệu, lỗi baseline, SHA, môi trường Node và danh sách test chưa chạy; không thay đổi chức năng.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M01 — Định nghĩa quyền sở hữu ghi vector và các invariants

**Nhóm:** Phase A · **Ưu tiên:** P0 · **Phụ thuộc:** M00  
**Files cần kiểm tra (không tự suy đoán thêm):** `docs/moris-v6/ARCHITECTURE.md`, `AGENTS.md` (bổ sung tối thiểu), `tests/`

**Công việc Codex phải làm:** Định nghĩa Editor là WRITE METADATA/IMAGE ONLY; Trung tâm Vector AI là nguồn chủ động DUY NHẤT để create/replace/reindex vector. Không tạo vector từ savePart, upload, auto-queue, mount trang, auto-repair, IndexedDB enrollment trên editor. Vẽ call graph của `/api/moris/vector-upsert`, tất cả caller và trạng thái source-of-truth. Không nhầm `query embedding` phục vụ tìm kiếm với `index vector` lưu DB.

**Test bắt buộc:** Thử tìm reference tĩnh `vectorizeSavedPart`, `enqueueMorisVectorJob`, `vector-upsert`, `enrollSkuSignatureV2` để lập danh sách entry points.

**Nghiệm thu:** Có bảng ma trận sự kiện→quyền ghi vector, ranh giới rõ giữa “embed để search” và “upsert index”; Codex không tự thay đổi DB.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M02 — Gỡ toàn bộ auto-vector/Vector nút Editor; Save chỉ lưu metadata/ảnh

**Nhóm:** Phase A · **Ưu tiên:** P0 · **Phụ thuộc:** M01  
**Files cần kiểm tra (không tự suy đoán thêm):** `src/app.js`, `index.html`, `tests/frontend.test.js`, test bổ sung

**Công việc Codex phải làm:** Gỡ nút “Tạo vector” trong Editor và gỡ/khóa đường gọi `vectorizeCurrentEditorPart`, `vectorizeSavedPart` từ Editor. Xóa trigger queue nền còn sót (bao gồm call khi khởi tạo phiên), nhưng chỉ xóa helper sau khi chứng minh không còn caller cần thiết. `savePart` không gọi Worker DINOv2, `/api/moris/vector-upsert`, IndexedDB enroll hay ghi vector. Đổi thông báo Editor: “Lưu ảnh xong, mở Trung tâm Vector AI để tạo/cập nhật vector thủ công”. Bảo toàn CRUD ảnh, catalogue, login.

**Test bắt buộc:** Spy/mocks: lưu part mới, sửa metadata, thay ảnh, bấm Save nhiều lần; assert zero `/api/moris/vector-upsert`, zero worker embed, zero queue/enroll. Test UI không còn nút trong Editor.

**Nghiệm thu:** Mọi thao tác Editor vẫn lưu đúng nhưng không sinh vector hay chạy model; Center vẫn hoạt động.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M03 — Giới hạn mọi thao tác tạo vector vào Trung tâm Vector AI

**Nhóm:** Phase A · **Ưu tiên:** P0 · **Phụ thuộc:** M02  
**Files cần kiểm tra (không tự suy đoán thêm):** `tools/moris-vector-center.js`, `tools/moris-vector-center.html`, `functions/api/moris/vector-upsert.js`, test phân quyền

**Công việc Codex phải làm:** Khẳng định chỉ các nút single/batch/reindex rõ ràng trong Center mới gửi request ghi vector. Với batch cần confirm số SKU/asset, preview thay đổi; kiểm tra role server-side. Không mở endpoint vector-upsert cho người ngoài quyền; cân nhắc quyền hiện tại `converter/editor/admin` và ghi lại quyết định, không tự mở rộng. Không có trigger từ mở trang, danh sách hoặc edit/save.

**Test bắt buộc:** Mocks single và batch khi chưa click: zero writes; click single=đúng asset được chọn; batch chưa xác nhận=zero writes; 401/403 khi thiếu quyền.

**Nghiệm thu:** Ma trận hành vi được khóa bằng regression tests; thao tác ghi luôn do user chủ động ở Center.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M04 — Thiết kế upsert idempotent, chống nhân bản vector

**Nhóm:** Phase A · **Ưu tiên:** P0 · **Phụ thuộc:** M03  
**Files cần kiểm tra (không tự suy đoán thêm):** `functions/api/moris/vector-upsert.js`, `tools/moris-vector-center.js`, `supabase/migrations/` (CHỈ file đề xuất), `tests/moris-vector-features.test.js`

**Công việc Codex phải làm:** Sửa `prevent_duplicate`: hiện chỉ xét record_id+asset_type, làm bỏ qua `canon_gray_v2`; phải xét đầy đủ image/object key + model + preprocess + profile + `view_variant`. Thiết kế create/skip/replace có explicit mode ở Center; nhấn lặp lại với same asset+same profile+same variant không tăng row count. Nếu ảnh thay nguồn, không để vector cũ vô hạn ở trạng thái active; quy trình inactivate/replace cần review và transaction an toàn. Với baseline **chỉ** lập chỉ mục `canon_rgb_v2`; không bật thêm `canon_gray_v2` hàng loạt cho tới khi benchmark chứng minh lợi ích và owner phê duyệt ngân sách lưu trữ.

**Test bắt buộc:** Chạy cùng request 2 lần không tăng số row; variant RGB/gray được phân biệt (khi bật thử nghiệm); cùng asset loại khác không bị bỏ oan; partial failure không đánh dấu tất cả thành công; chạy thử trên DB test, không production.

**Nghiệm thu:** Bất biến idempotency cho tất cả key hợp lệ; không tự nhân đôi 1.090 vector hiện có; có kế hoạch rollback migration.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M05 — Xác định trạng thái vector theo ảnh nguồn: missing/ready/stale/partial

**Nhóm:** Phase A · **Ưu tiên:** P1 · **Phụ thuộc:** M04  
**Files cần kiểm tra (không tự suy đoán thêm):** `functions/api/moris/vector-items.js`, `tools/moris-vector-center.js`, RPC hiện hữu và file migration đề xuất

**Công việc Codex phải làm:** Không dùng một boolean `has_vector` cho cả SKU. Đối chiếu từng image asset và vector (object_key, updated_at, profile, variant, checksum nếu có) để xác định `missing`, `ready`, `stale`, `partial`, `failed`. Nếu thay ảnh/metadata, Editor không chạy model và không insert vector; Center hiển thị “Cần cập nhật” cho ảnh có vector lỗi thời. Khi object_key không đổi nhưng nội dung thay, chỉ tin checksum/version được đo đúng, tránh tự suy luận. Không tự xóa hay reindex lúc save.

**Test bắt buộc:** Các trường hợp không có vector, một trong hai view có vector, thay ảnh, stale profile, variant thiếu, object_key giữ nguyên nhưng version thay; trạng thái không được tự chuyển ready nếu thiếu bằng chứng.

**Nghiệm thu:** Center hiển thị đúng trạng thái ở mức asset; không một thay đổi Editor nào tự ghi vector.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M06 — Khóa hợp đồng embedding profile và đường fallback

**Nhóm:** Phase B · **Ưu tiên:** P0 · **Phụ thuộc:** M01  
**Files cần kiểm tra (không tự suy đoán thêm):** `src/moris/vector/dinov2.worker.js`, `src/moris/vector/browserDinov2.js`, `functions/_lib/moris/v5/vector/{profiles,encoder,contracts}.js`, `tests/`

**Công việc Codex phải làm:** Phân biệt rõ `CLS` và `384D Masked-GeM + Edge` dù cùng chiều vector; định danh theo cả model revision, preprocessing, tensor conversion, pooling và profile. Nếu Worker patch tokens không có, **fail closed** hoặc chuyển sang profile/index riêng; không lặng lẽ nhân CLS thành 256 patches rồi gắn nhãn hybrid. Chốt tương thích index cũ trước khi đổi profile; không ghi đè vector production.

**Test bắt buộc:** Golden fixture: shape [1,257,384], [1,384], tensor sai, profile sai, patch fallback; vector đủ norm, không NaN; profile khác bị 400.

**Nghiệm thu:** Không có hai thuật toán khác nhau cùng một profile; index cũ được cô lập hoặc có lộ trình chuyển đổi.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M07 — Chính thức hóa canonicalization + quality gate

**Nhóm:** Phase B · **Ưu tiên:** P1 · **Phụ thuộc:** M06  
**Files cần kiểm tra (không tự suy đoán thêm):** `src/moris/moris-layer1-optical.js`, `src/moris/vector/imageCanonicalizer.js`, `src/moris/vector/dinov2.worker.js`, `tests/moris-layer1-optical.test.ts`

**Công việc Codex phải làm:** Đối chiếu preprocess lúc lập chỉ mục từ Center và lúc query; thống nhất alpha/black-matte/live-camera, PCA, padding, 224x224, thuật toán tensor. Kiểm soát ảnh quá sáng, bóng đổ, vật thể chạm mép, nền nhiều màu và vật thể dài. Khi tách nền kém, đánh dấu mask unreliable; không giả rằng toàn ảnh là linh kiện. Không thêm model segmentation hoặc yêu cầu cài công cụ bên ngoài khi chưa benchmark.

**Test bắt buộc:** Bộ fixture alpha/black background, nền trắng/xám, shadow, tilt 0/90/180, vật thể chạm biên, vật thể rất dài; replay bảo đảm index/query canonicalization giống nhau.

**Nghiệm thu:** Cùng ảnh+profile sinh preprocessing tái lập; quality flags xuất ra rõ ràng, không làm sai cơ cấu vật thể.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M08 — Geometry contract: phân biệt unknown và zero; kiểm tra nhất quán lỗ

**Nhóm:** Phase B · **Ưu tiên:** P1 · **Phụ thuộc:** M07  
**Files cần kiểm tra (không tự suy đoán thêm):** `src/moris/moris-layer1-optical.js`, `functions/_lib/moris/v5/retrieval/{structuralEvidence,geometricReranker}.js`, `schemas`, test geometry

**Công việc Codex phải làm:** Tách `hole_count=0` hợp lệ khỏi `hole_count unknown` khi mask hỏng; không ép null thành 0. Ghi provenance/quality cho count, centroids, aspect ratio, scale. Kiểm tra 55/545 cặp thumb/front lệch count trong dữ liệu thực (chỉ đọc hoặc xuất báo cáo kỹ thuật ẩn code cần thiết), không tự sửa ồ ạt; xử lý hình học thiếu đúng theo evidence availability.

**Test bắt buộc:** 0 lỗ thật ≠ chưa đo; đếm lỗ ổn qua 180°; mặt trước/sau có che khuất; unknown không bị phạt như 0; property-based synthetic masks.

**Nghiệm thu:** Geometry contract có nullable/quality/version; report danh sách mâu thuẫn và kế hoạch làm sạch thủ công.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M09 — Chuẩn hóa candidate retrieval và filters ở server

**Nhóm:** Phase B · **Ưu tiên:** P1 · **Phụ thuộc:** M06  
**Files cần kiểm tra (không tự suy đoán thêm):** `functions/_lib/moris/v5/orchestrator.js`, `retrieval/{multiProbeSearch,vectorHitCollapse,candidatePool}.js`, `connectors/catalogue.js`

**Công việc Codex phải làm:** Bảo toàn filter `usage_side`,`view_mode` sau hydrate; collapse theo SKU nhưng giữ best hit/view và lịch sử probe, không mất thông tin để giải thích; không chỉ scan mặc định rồi bỏ lọc. Phân biệt raw cosine với RRF composite để không đặt sai ngưỡng. Giảm false-negative khi topK giới hạn; đối chiếu exact baseline và ANN theo profile.

**Test bắt buộc:** Một SKU có thumb/front/detail; 2 probes cạnh tranh; filter trái/phải; orphan vector; hit không có metadata; raw cosine vs fused không đánh tráo.

**Nghiệm thu:** Không trả ứng viên vi phạm filters; các tầng sử dụng cùng candidate identity và giữ bằng chứng.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M10 — Sửa giới hạn phân trang lọc catalogue 300 vs 2000

**Nhóm:** Phase B · **Ưu tiên:** P1 · **Phụ thuộc:** M00  
**Files cần kiểm tra (không tự suy đoán thêm):** `src/app.js`, `functions/_lib/moris/v5/connectors/supabase.js`, `supabase/migrations/2026101300010000_strict_feature_search_catalogue.sql` (chỉ đọc), test

**Công việc Codex phải làm:** Khắc phục frontend gọi `p_limit:2000` trong khi RPC cap 300: dùng phân trang đủ, hoặc RPC filter server có phân trang ổn định. Không tăng LIMIT vô kiểm soát. Áp dụng đúng cho ID exact, code substring và feature search; đảm bảo toàn bộ 545 SKU có thể được xét.

**Test bắt buộc:** Fixture >300, 545, 1000 và dữ liệu trùng thứ tự; mục tiêu nằm trang cuối vẫn được tìm; không làm suy giảm paging thường.

**Nghiệm thu:** Không false-negative vì giới hạn 300 hàng; SQL plan không tăng tải quá mức.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M11 — Quản trị riêng IndexedDB offline và bỏ side-effect Editor

**Nhóm:** Phase B · **Ưu tiên:** P1 · **Phụ thuộc:** M02, M05, M06  
**Files cần kiểm tra (không tự suy đoán thêm):** `src/app.js`, `src/moris/moris-worker-pipeline.js`, `src/moris/moris-idb.js`, `src/moris/vector/dinov2.worker.js`

**Công việc Codex phải làm:** Quyết định nhánh IndexedDB là search fallback có version/TTL độc lập, không ghi vào cloud; không enroll signature từ editor/save. Nếu cần enroll local, chỉ cho người dùng kích hoạt trong Center. Khi server có kết quả, offline không được gộp thay đổi top10 không có bằng chứng; khi server lỗi khác với “không tìm thấy”, UI phải phân biệt.

**Test bắt buộc:** Editor save không enroll; local missing/stale không thay candidate server; server 5xx không ngụy trang “không có mã”; test đồng bộ reload.

**Nghiệm thu:** Không còn split-brain bất ngờ giữa local và server; không ghi vector nền.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M12 — Một nguồn tính điểm cuối duy nhất; không ghi đè fusion

**Nhóm:** Phase C · **Ưu tiên:** P0 · **Phụ thuộc:** M09  
**Files cần kiểm tra (không tự suy đoán thêm):** `functions/_lib/moris/v5/retrieval/{scoreFusion,geometricReranker,structuralEvidence}.js`, `orchestrator.js`, `schemas/candidate.js`

**Công việc Codex phải làm:** Gộp bằng chứng vector, metadata, hole, aspect, conflict thành một policy ranking có hệ số và availability rõ ràng. Không để reranker hình học overwrite final_score đã fusion rồi biến mất metadata penalty; điểm số phải là ranking score, không gắn nhãn phần trăm xác suất. Unknown evidence không được auto=1 rồi nhận thưởng. Theo dõi giải thích từng tín hiệu.

**Test bắt buộc:** Metadata conflict không biến mất; thiếu hole/aspect không cộng điểm; hard negative 17-vs-5 holes được đẩy lên khi bằng chứng chắc chắn; cùng input→same output.

**Nghiệm thu:** Một đường xếp hạng có unit contract và breakdown; không double-count cùng tín hiệu.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M13 — Quy tắc orientation / mirror / chirality

**Nhóm:** Phase C · **Ưu tiên:** P1 · **Phụ thuộc:** M07, M08  
**Files cần kiểm tra (không tự suy đoán thêm):** `functions/_lib/moris/v5/guards/orientation.js`, `retrieval/geometricReranker.js`, `src/moris/geometry/pcaAligner.js`, tests

**Công việc Codex phải làm:** Chỉ cho phép phép biến đổi thích hợp theo loại part, view mode và usage side. Không mặc định mirror X/Y là tương đương hình thật ở mã left/right, chi tiết không đối xứng. Tách canonical rotation 180° và mirror của mặt trước/sau. Cờ is_symmetric cần dữ liệu tin cậy; không tự dựa vào field false hàng loạt làm ground truth.

**Test bắt buộc:** Ảnh quay 180° cùng part, left/right mirror phân biệt, front/back có thể đảo, đối xứng hợp lệ.

**Nghiệm thu:** Không vô tình xem mã trái/phải là một; kiểm tra orientation tách khỏi vector score.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M14 — Hole topology V2 — assignment tối ưu, xử lý đếm thiếu

**Nhóm:** Phase C · **Ưu tiên:** P1 · **Phụ thuộc:** M08, M13  
**Files cần kiểm tra (không tự suy đoán thêm):** `functions/_lib/moris/v5/retrieval/geometricReranker.js` hoặc module `holeMatcher.js` mới; `tests/moris-reranker.test.js`

**Công việc Codex phải làm:** Thay sort-by-X + so sánh phần tử cùng chỉ số bằng matching song phương tối ưu (Hungarian hoặc thuật toán đúng với kích thước nhỏ). Cost gồm tọa độ chuẩn hóa, diện tích tương đối, radius/is_big và missing-penalty; đánh giá mọi phép biến đổi hợp lệ từ M13. Nếu độ tin cậy lỗ thấp, hạ trọng số thay vì hard reject. Giới hạn CPU/tối đa lỗ để chặn DoS.

**Test bắt buộc:** Tâm lỗ trùng X khác Y, lỗ thêm/mất, lệch 1 vs 2, đối xứng, chirality, 17 vs 5; test deterministic và giới hạn thời gian.

**Nghiệm thu:** Hàm trả similarity + matched pairs + unmatched + reliability; benchmark hard-negative không xấu đi vượt gate.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M15 — Contour verifier và EFD có bảo vệ chất lượng mask

**Nhóm:** Phase C · **Ưu tiên:** P1 · **Phụ thuộc:** M07, M13  
**Files cần kiểm tra (không tự suy đoán thêm):** `src/moris/moris-layer3-rerank.js`, `src/moris/geometry/`, `functions/_lib/moris/v5/retrieval/` (module mới khi cần)

**Công việc Codex phải làm:** Mang contour/EFD vào đường rerank chính theo contract có version, không phụ thuộc cache IndexedDB trên từng máy. So sánh contour có căn chỉnh scale, rotation đúng, chamfer/distance transform hoặc EFD. Cần đường truyền metadata có kiểm soát: không tự phình DB vì lưu dense patches/contours của mọi ảnh trước khi đo ngân sách. Chỉ bật khi mask đạt quality threshold.

**Test bắt buộc:** Hình L/U giống vector nhưng khác mép, ngàm nhỏ; mask lỗi; scale/rotation; latency; không mirror trái/phải bất hợp lệ.

**Nghiệm thu:** Contour signal chứng minh cải thiện trên hard negatives được phép; có fallback an toàn.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M16 — Local spatial patch reranking có feature flag

**Nhóm:** Phase C · **Ưu tiên:** P2 · **Phụ thuộc:** M06, M09, M15  
**Files cần kiểm tra (không tự suy đoán thêm):** `src/moris/moris-layer2-embedding.js`, `src/moris/moris-layer3-rerank.js`, `functions/_lib/moris/v5/retrieval/`, test

**Công việc Codex phải làm:** Đưa Top-32 spatial key patches vào verifier cho Top-K ứng viên: so khớp chi tiết rãnh/ngàm/gờ sau căn chỉnh. Kiểm tra DINO output thực có patch tokens; không dùng 256 bản sao CLS làm spatial feature. Thiết kế lấy/tính patch chỉ khi cần, feature-flag OFF mặc định và không tự lưu bộ patch 256x384 vào DB production.

**Test bắt buộc:** Spatial/no-spatial fallback; fixture cạnh/tương phản; ranking ablation; giới hạn bộ nhớ và thời gian trên WASM/WebGPU.

**Nghiệm thu:** Chỉ bật nếu đo được cải thiện sau khi trừ chi phí latency/storage; không thay đổi profile cũ.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M17 — Reliability-aware fusion, thiếu tín hiệu không thưởng/phạt

**Nhóm:** Phase C · **Ưu tiên:** P1 · **Phụ thuộc:** M12, M14, M15  
**Files cần kiểm tra (không tự suy đoán thêm):** `functions/_lib/moris/v5/retrieval/scoreFusion.js`, `schemas/ranking.js`, `preprocess/quality.js`

**Công việc Codex phải làm:** Thiết kế available/quality riêng cho vector, hole graph, contour, aspect, patch; chuẩn hóa lại trọng số khi vắng tín hiệu. Chỉ áp dụng penalty mạnh cho bằng chứng xung đột có độ tin cậy cao. Loại bỏ việc áp 40% weight lỗ khi ảnh không có count; không dùng 0/1 mơ hồ.

**Test bắt buộc:** Thiếu count, count=0 thật, mask kém, metadata thiếu, view không chắc, lỗi endpoint; final ranking không NaN và không giả confidence.

**Nghiệm thu:** Phân rã điểm giải thích được, có test giới hạn và tính chất đơn điệu.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M18 — Multi-view candidate fusion và tập kết quả cấp SKU

**Nhóm:** Phase C · **Ưu tiên:** P1 · **Phụ thuộc:** M09, M12, M17  
**Files cần kiểm tra (không tự suy đoán thêm):** `functions/_lib/moris/v5/retrieval/{multiProbeSearch,vectorHitCollapse,candidatePool}.js`, `orchestrator.js`

**Công việc Codex phải làm:** Đo hiệu quả index 1 variant RGB/asset so với tùy chọn gray; query multi-probe có thể sử dụng nhưng không tự nhân vector lưu. Điều chỉnh RRF/margin trên *cùng đơn vị điểm*, phân biệt similarity thô với score trộn. Giữ best view evidence, áp dụng filter mặt trái/phải và trả 1 SKU duy nhất sau rerank.

**Test bắt buộc:** Bản ghi 2 views, duplicate probe, identical embeddings, correct SKU chỉ có view back, invalid usage_side.

**Nghiệm thu:** Top10 không trùng SKU, giữ đúng nguyên nhân khớp, không tự tăng số vector trên DB.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M19 — Dataset manifest và chính sách ground truth

**Nhóm:** Phase C · **Ưu tiên:** P0 · **Phụ thuộc:** M00  
**Files cần kiểm tra (không tự suy đoán thêm):** `evaluation/moris-v6/README.md`, `evaluation/moris-v6/manifest.example.jsonl`, script xác minh dataset

**Công việc Codex phải làm:** Định nghĩa dataset từ ảnh catalogue và ảnh chụp xưởng có quyền sử dụng: `query_id`, `expected_sku`, view, lighting, angle, source group, known/unknown, mask/hole labels (nếu có). Tách trường hợp same-asset, cross-view và true camera. Không đưa secret, link có token, ảnh nội bộ vào git công khai; lưu ảnh nội bộ trong vùng được phép. Chốt test set bất biến và split để tránh leakage.

**Test bắt buộc:** Manifest schema validation; duplicate image hash, missing labels, leaking same physical shot across train/test; test tự chạy trên fixture synthetic nếu chưa có ảnh thật.

**Nghiệm thu:** Có data dictionary, script kiểm tra dataset và ghi rõ số mẫu thật; không bịa 80%/90%.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M20 — Evaluation CLI với top1/recall@10,@50/MRR/abstain/p95

**Nhóm:** Phase C · **Ưu tiên:** P0 · **Phụ thuộc:** M19  
**Files cần kiểm tra (không tự suy đoán thêm):** `tools/evaluate-moris-v6.mjs` (mới), `evaluation/moris-v6/`, `tests/`

**Công việc Codex phải làm:** Tạo runner **offline/read-only** ăn query, ground truth và output candidate đã snapshot. Báo Top1, Recall@10, Recall@50, MRR@10, unknown false-accept, retrieval misses, rerank misses, latency p50/p95; bootstrap CI khi đủ mẫu. Không ghi index/vector. Xuất JSON và MD kết quả có dataset SHA, commit SHA, n, timestamp, parameters.

**Test bắt buộc:** Synthetic case Top1 đúng/sai, no-answer, repeated query, topK shrink; metric consistency & deterministic seed.

**Nghiệm thu:** Có baseline tái lập được; phân biệt cross-view 78/80 tự kiểm thử với benchmark camera thật chưa chạy.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M21 — Bộ hard-negative regression cơ khí

**Nhóm:** Phase C · **Ưu tiên:** P1 · **Phụ thuộc:** M08, M19, M20  
**Files cần kiểm tra (không tự suy đoán thêm):** `evaluation/moris-v6/`, `tests/moris-hard-negatives.test.js`

**Công việc Codex phải làm:** Đưa cặp `3405030101`↔`3427740001` (khác 17/5 lỗ), cặp `3425000001`↔`3424990001` (3/3 lỗ), 55 cặp mismatch thumb/front vào candidate fixture/manifest có truy xuất hợp lệ; không đưa nhận định cùng loại camera nếu chỉ là ảnh catalogue. Tạo thêm nhóm L/R, no holes, shadow, glare, rotated, long thin part, same-outline-different-punch. Quy trình curator xác nhận nhãn từng trường hợp.

**Test bắt buộc:** Tests giữ đúng vị trí tương đối theo đặc trưng khi có đủ fixture, không hardcode SKU vào thuật toán; test data manifest đóng băng.

**Nghiệm thu:** Mỗi regression gắn bằng chứng ảnh, expected outcome và đầu ra trước/sau; không overfit test bằng rule riêng cho mã.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M22 — Ablation, tuning và quyết định go/no-go bằng số liệu

**Nhóm:** Phase C · **Ưu tiên:** P0 · **Phụ thuộc:** M12, M14, M15, M17, M18, M20, M21; M16 tùy chọn  
**Files cần kiểm tra (không tự suy đoán thêm):** `evaluation/moris-v6/results/` (chỉ báo cáo không dữ liệu nhạy cảm), `docs/moris-v6/DECISION.md`

**Công việc Codex phải làm:** Chạy nhiều cấu hình trên cùng benchmark: global-only; +hole; +contour; +patch; +multi-probe; rerank confidence/reject. Điều chỉnh weight trên development split, đánh giá cuối trên holdout chưa nhìn; đo phân tầng theo camera, ánh sáng, nhóm part. Không đặt mục tiêu đạt 90% giả khi thiếu tập thật. Nếu Recall@50 yếu, quay về encoder/preprocess; nếu Recall@50 tốt nhưng Top1 yếu, đầu tư reranker.

**Test bắt buộc:** Báo chỉ số trước/sau, cỡ mẫu, mức biến động, latency và storage; regression gate cho kịch bản quan trọng.

**Nghiệm thu:** Bản quyết định kỹ thuật với bằng chứng; tính năng không cải thiện có thể giữ OFF hoặc loại bỏ.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M23 — Thiết kế migration an toàn, backup, dry-run và quota

**Nhóm:** Phase D · **Ưu tiên:** P0 · **Phụ thuộc:** M04, M05, M08, M22  
**Files cần kiểm tra (không tự suy đoán thêm):** `supabase/migrations/` (file đề xuất), `docs/moris-v6/DB_MIGRATION.md`

**Công việc Codex phải làm:** Nếu cần cột `embedding_signature_version`, asset digest, trạng thái stale hoặc unique semantics, viết migration mới additive và reverse plan. SQL phải xem schema/thực trạng quyền/RLS/SECURITY DEFINER; không cập nhật production trực tiếp trong task. Dự tính trước số hàng, kích thước thêm, index bloat, giới hạn mỗi SKU. Không chạy purge/truncate, xóa vector không có backup và phê duyệt.

**Test bắt buộc:** Review diff schema, dry-run ở local/staging, restore rehearsal, chạy RLS/advisor được hỗ trợ, kiểm thử RPC quyền.

**Nghiệm thu:** Có tài liệu thủ tục apply/rollback và xác nhận owner trước bước production.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M24 — Trung tâm Vector AI: reindex thủ công theo batch có preview/dry-run

**Nhóm:** Phase D · **Ưu tiên:** P0 · **Phụ thuộc:** M03, M04, M05, M06, M23  
**Files cần kiểm tra (không tự suy đoán thêm):** `tools/moris-vector-center.js`, `functions/api/moris/{vector-upsert,vector-items,reindex-batch}.js`, test E2E

**Công việc Codex phải làm:** Tạo lựa chọn rõ ràng `Chỉ tạo phần thiếu`, `Cập nhật phần stale`, `Rebuild có xác nhận`; hiển thị dự báo số asset, số vector bị thay, ước lượng tăng thực tế. Manual click mới tạo embedding; chunk <=20 theo API, retry idempotent, progress và lỗi từng asset. Chỉ bật Gray variant sau A/B benchmark và chấp thuận. Giữ nguyên tính năng admin purge cũ nhưng tuyệt đối không tự gọi.

**Test bắt buộc:** Batch 0, 1, >20, retry timeout, pause/resume, 409 duplicate, partial failure, refresh status; không ghi khi chưa confirm; repeated rebuild không tăng rows.

**Nghiệm thu:** Tạo vector trong Center duy nhất; có số liệu actual before/after và rollback; không tạo từ Editor.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M25 — UI Moris: confidence có căn cứ, lý do khớp, low-quality/reject

**Nhóm:** Phase D · **Ưu tiên:** P1 · **Phụ thuộc:** M17, M18, M22  
**Files cần kiểm tra (không tự suy đoán thêm):** `src/app.js`, `index.html`, `functions/_lib/moris/v5/presentation/{publicResult,userMessage}.js`, frontend tests

**Công việc Codex phải làm:** Hiển thị ranking score như điểm so khớp, không công bố 90% probability nếu chưa calibration; show nguyên nhân `holes`, `contour`, `view`, `quality`. Nếu không đủ evidence hoặc ảnh không có mã, đưa hướng dẫn chụp lại/không có ứng viên. Giữ luồng Chat text, ID exact, filter và click mở detail. Không thêm nút vector vào Editor.

**Test bắt buộc:** Empty result, unknown, mask unreliable, 2 ứng viên sát điểm, OR orientation ambiguity, UI mobile và desktop.

**Nghiệm thu:** Người vận hành không bị dẫn dắt bởi confidence giả; ứng viên đúng click được.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

### M26 — Staging E2E, canary, rollback và xác nhận phát hành

**Nhóm:** Phase D · **Ưu tiên:** P0 · **Phụ thuộc:** M23, M24, M25  
**Files cần kiểm tra (không tự suy đoán thêm):** `docs/moris-v6/RELEASE_CHECKLIST.md`, `tests/`, `state.json`, `plan.md` (append thay vì ghi đè lịch sử)

**Công việc Codex phải làm:** Chạy full suite trên commit release, smoke login 2FA/RLS/CSRF/anti-bot, Editor save không upsert, Vector Center manual only, tìm ảnh camera, text, mobile/WebGPU/WASM. Canary với feature flag, so sánh Top1/Recall@10/false accepts/p95 và kích thước index. Có rollback cả app + vector profile + migration; không cần deploy khi chưa có owner approval.

**Test bắt buộc:** `npm test`, `npm run build`, TS check khi cài hợp lệ, snapshot logs, E2E staging; ghi rõ đã chạy/chưa chạy.

**Nghiệm thu:** Go/no-go minh bạch, release sign-off, production không tự update vector; cập nhật state/plan có evidence và commit.

**Báo cáo kết thúc task:** Tóm tắt diff, file sửa, tests+output, tác động rows/storage, rủi ro còn lại, rollback, commit hash; nếu blocker nêu rõ và giữ `[ ]`.

## 6. Acceptance matrix nghiệp vụ (regression bất biến)

| Sự kiện | Lập chỉ mục vector DB? | Kỳ vọng |
|---|---:|---|
| Editor: tạo SKU mới và Save | **Không** | SKU/ảnh lưu, Center hiển thị missing |
| Editor: sửa text và Save | **Không** | Metadata cập nhật, không chạy model |
| Editor: thay ảnh và Save | **Không** | Ảnh lưu, vector hiện có có thể stale; không insert mới |
| Editor: Save 10 lần | **Không** | Vector count không đổi |
| Trung tâm Vector AI: mở tab / xem status | **Không** | Chỉ GET/read |
| Trung tâm Vector AI: tạo single đúng một asset | **Có, theo click** | Thêm nếu thiếu; nếu trùng thì skip/replace explicit |
| Trung tâm Vector AI: batch chưa Confirm | **Không** | Không gọi Worker/upsert |
| Trung tâm Vector AI: batch đã Confirm | **Có, có giới hạn** | Có progress, lỗi từng asset, chunk <=20 |
| Trung tâm Vector AI: bấm lại cùng key/profile/variant | **Không tăng rows** | Idempotent |
| Moris: người dùng chụp ảnh để tìm kiếm | **Không ghi DB** | Chỉ query embedding tạm, search, trả TopK |
| Moris: query lỗi hay mask không tin cậy | **Không ghi DB** | Báo lỗi/low confidence, không fake đúng mã |
| Xóa ảnh hoặc SKU | **Không tạo** | Vector orphan/stale được xử lý theo lifecycle đã duyệt; không tự purge ồ ạt |

## 7. Baseline và targets (phân biệt thực tế và mong muốn)

**Read-only baseline xác thực trong đợt review**: 545 SKU; 1.090 vectors active; 545 thumb + 545 front, chỉ `canon_rgb_v2`; 55/545 cặp count lệch; 507/545 không có `identifying_features`; test vector `thumb→front` mẫu 80 mã cho Top1 = 78/80, Top10 = 79/80, Top50 = 80/80. Dữ liệu có thể thay đổi, M00 phải snapshot lại.

**Không gọi 78/80 là độ chính xác camera.** M19–M22 mới xác lập Camera Top1, Recall@10/50, unknown FAR, latency. Mục tiêu đề xuất (không phải kết quả): Recall@50 >=98% trên tập camera có nhãn; Top1 >=90% và false accepts đạt mức do nghiệp vụ phê duyệt. Nếu thiếu mẫu, không báo hoàn tất theo phần trăm.

**Storage target:** lúc Editor lưu, thay đổi tổng số vector phải đúng bằng **0**. Lúc Center re-run cùng ảnh/profile/view, tăng số vector phải đúng bằng **0**. Mọi gia tăng ngoài những asset mới được xác nhận phải có giải trình và approval.

## 8. Risk register, rollback và quyết định sản phẩm

| Rủi ro | Biện pháp bắt buộc |
|---|---|
| Vô tình ghi vector khi Save | M02 regression spy trên mọi đường; M26 E2E DB count |
| Vector nhân bản vô hạn | M04 composite-key idempotency, M24 preview counts |
| Ẩn lỗi bằng fallback CLS | M06 fail-closed / profile khác |
| Lệch lỗ do shadow/occlusion | M07/M08 quality, M14 robust matching |
| Sai do mirror trái/phải | M13 chirality policy |
| Rerank mất evidence trước | M12 single scoring owner |
| DB bloat do probes/patches | V6 baseline 1 RGB variant/asset; gray/patch storage OFF cho tới khi chứng minh |
| Regression chat/RLS/CSRF | M26 full gate + rollback release |
| Migrations gây mất dữ liệu | M23 staging, backup, owner approval, rollback |

### Bộ lệnh gợi ý (trên môi trường dev được phép)

```cmd
cd C:\path\to\Dictionary
git status --short
git rev-parse HEAD
git checkout -b feat/moris-v6
npm ci
npm test
npm run build
```

Nếu `npm` không có hoặc chính sách công ty cấm, **dừng ở bước cài/kiểm thử và báo blocker**; không làm ngầm hoặc khẳng định đã pass. Không thay thế bằng cài đặt portable/third-party khi chưa được IT cho phép.

## 9. Quy tắc hoàn thành

Chỉ merge khi một nhóm task qua gate. Mỗi prompt giao Codex phải gắn Task ID, scope, test, điều cấm, output contract. **Không cho Codex tự đọc kế hoạch rồi thực hiện 27 task một lần**. Dùng `CODEX_MORIS_V6_TASK_PROMPTS.md` để copy prompt đúng task.

> **Cập nhật phạm vi 2026-10-16:** Chủ dự án yêu cầu bỏ qua staging và tiếp tục các bước còn lại. Staging phải ghi `skipped_by_owner`, không được ghi đã pass. Không thay đổi giới hạn cấm ghi production/deploy; benchmark, local tests, rủi ro và rollback vẫn bắt buộc.

## Checkpoint final local — 2026-10-16

391/391 tests (42 files), TypeScript/build49, local E2E12/12, local SQL data+ACL restore/rollback passed. Staging skipped by owner, not passed. Dev93/global Top1 58; frozen holdout31/global Top1 20, Recall10 29, Recall50 31. NO-GO; experimental verifiers OFF. No production writes/deploy/commit. See docs/moris-v6/DECISION.md and RELEASE_CHECKLIST.md.

Open acceptance: M14 hard-negative non-regression (previous code/unit completion is not full acceptance), M15 real benefit, M16 device/WebGPU budget, M18 multi-view/gray A/B, M21 curated cases, M22 full evaluation scope, M26 release sign-off/canary. Historical checkboxes in plan.md retain their original checkpoint context; state.json and current master/quick task tables carry the latest status.

## Local checkpoint closed — quota restraint

Owner requested closing the current task without further quota-heavy loops. Runtime image geometry defaults OFF based on development evidence, with explicit text constraints preserved; approved hard-negative snapshot hashes require SHA-256 format. Actual verification:395/395 tests,43files; TypeScript/build49 and local E2E12/12 pass. Logs: docs/moris-v6/evidence/M22-gate-*.log. No new benchmark or test run scheduled; remaining quota is unknown.

Remaining M14/M15/M16/M18/M21/M22/M26 acceptance is unverified; no blanket completion or release claim. Staging skipped by owner. No production writes/deploy/commit. Rollback only the geometry flag/orchestrator and evidence-validator/test hunks, preserving owner changes; reenabling geometry restores the measured regression and is not recommended without new evidence.

## M21 review-link checkpoint

Catalogue review evidence was linked without inference:55/55 legacy refs resolved;59 local front-image hashes checked. All57 cases remain unlabelled/pending curator. New focused tests8/8 and full unit suite398/398 (44files) pass. See `docs/moris-v6/M21.md`; no production writes/deploy.

M21 review queue now includes optional frozen-development ranking context. Only11/57 items have a matching development query; both specified pairs lack one, and no holdout was used. Still0 curator outcomes. Focused review tests10/10 pass; full suite398/398 predates the final two focused additions.

## Agent handoff

Before continuing, read [docs/moris-v6/HANDOFF.md](docs/moris-v6/HANDOFF.md). It records exact remaining gates, current evidence and quota constraints. Do not rerun heavy inference; staging skipped; preserve dirty tree and production prohibition.
