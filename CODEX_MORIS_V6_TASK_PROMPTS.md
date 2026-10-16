# CODEX CLI — PROMPTS THỰC THI MORIS V6 TỪNG TASK

> **Ủy quyền phiên 2026-10-16:** Chủ dự án yêu cầu chạy loop tuần tự từng task đến hết plan. Quy tắc giao từng prompt/dừng xin phép giữa các task được thay bằng checkpoint có test, bằng chứng, rủi ro và rollback trước khi chuyển task. Giữ nguyên điều kiện nghiệm thu; thiếu dữ liệu hoặc bằng chứng thì để `[ ]`. Không ghi production, không deploy; Gate D/E và phê duyệt dung lượng vẫn bắt buộc.

**Quan trọng:** Copy **một** prompt Mxx tại một thời điểm. Chỉ chuyển task mới sau khi Codex báo files changed, tests, bằng chứng, rollback và anh kiểm tra. File này đi cùng `MORIS_V6_MASTER_PLAN.md`.

> Trước khi chọn prompt tiếp theo, đọc [TECH_DEBT_ROADMAP.md](docs/moris-v6/TECH_DEBT_ROADMAP.md), [HANDOFF.md](docs/moris-v6/HANDOFF.md) và `state.json`. Roadmap/state mới nhất quyết định gate còn mở; các checkpoint cũ trong prompt này chỉ để tham khảo lịch sử.

## Prompt bootstrap — dán một lần khi mở phiên Codex mới

```text
Bạn là coding agent trong repository PQVinh99-Glory/Dictionary. Trước khi thay đổi code, hãy đọc AGENTS.md, state.json, plan.md, MORIS_V6_MASTER_PLAN.md và xác minh git status, HEAD, branch. Chỉ thực hiện task Mxx mà tôi đưa, không thực hiện task kế tiếp, không tự deploy, không tự sửa Supabase production, không chạy purge/truncate/delete. Bảo toàn auth/2FA/RLS/CSRF/anti-bot.

BẤT BIẾN NGHIỆP VỤ: Editor khi create/update/save/upload ảnh không được tự tạo/upsert/reindex/enroll vector, không chạy Worker DINOv2, không enqueue; Editor không có nút tạo vector. CHỈ Trung tâm Vector AI cho phép tạo, cập nhật hoặc reindex vector qua nhấn nút chủ động (single/batch) và quyền hợp lệ. Moris query ảnh được tạo embedding tạm để SEARCH nhưng KHÔNG ghi database. Tạo lại cùng asset+profile+variant phải idempotent, không tăng rows. Không tự kích hoạt thêm gray variant và không tự lưu patch descriptors hàng loạt.

Quy trình từng task: (1) giải thích lỗi và chỉ ra file/hàm đang dùng; (2) bổ sung test regression; (3) diff tối thiểu; (4) chạy test phù hợp và npm test/npm run build khi môi trường cho phép; (5) báo output thật, tác động index/storage, rollback; (6) nếu pass và có bằng chứng mới đánh dấu checklist trong plan.md, state.json. Không sửa asserts để cho qua. Không cài package không kiểm soát. Không giả mạo kết quả hay dữ liệu.
```

## Prompts theo task

### M00 — Đóng băng baseline, xác minh branch và trạng thái test

```text
Hãy triển khai DUY NHẤT task M00 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P0; Phụ thuộc phải hoàn thành: Không.
Files cần kiểm tra: `AGENTS.md`, `state.json`, `plan.md`, `package.json`, `tests/`.
Yêu cầu: Xác nhận SHA gốc; mở nhánh `feat/moris-v6`; chụp thống kê read-only (số SKU, vector, loại view, phiên bản); ghi lại lệnh và kết quả `npm test`, `npm run build`, `npm exec --no -- tsc --noEmit` nếu có TypeScript hợp lệ. Không sửa production, không dùng số test trong state.json làm bằng chứng đã chạy. Tạo `docs/moris-v6/BASELINE.md`.
Bằng chứng test cần có: `git status --short`; `git rev-parse HEAD`; log chạy kiểm thử thực tế, nêu rõ lệnh không thể chạy.
Definition of Done: Có snapshot số liệu, lỗi baseline, SHA, môi trường Node và danh sách test chưa chạy; không thay đổi chức năng.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M01 — Định nghĩa quyền sở hữu ghi vector và các invariants

```text
Hãy triển khai DUY NHẤT task M01 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P0; Phụ thuộc phải hoàn thành: M00.
Files cần kiểm tra: `docs/moris-v6/ARCHITECTURE.md`, `AGENTS.md` (bổ sung tối thiểu), `tests/`.
Yêu cầu: Định nghĩa Editor là WRITE METADATA/IMAGE ONLY; Trung tâm Vector AI là nguồn chủ động DUY NHẤT để create/replace/reindex vector. Không tạo vector từ savePart, upload, auto-queue, mount trang, auto-repair, IndexedDB enrollment trên editor. Vẽ call graph của `/api/moris/vector-upsert`, tất cả caller và trạng thái source-of-truth. Không nhầm `query embedding` phục vụ tìm kiếm với `index vector` lưu DB.
Bằng chứng test cần có: Thử tìm reference tĩnh `vectorizeSavedPart`, `enqueueMorisVectorJob`, `vector-upsert`, `enrollSkuSignatureV2` để lập danh sách entry points.
Definition of Done: Có bảng ma trận sự kiện→quyền ghi vector, ranh giới rõ giữa “embed để search” và “upsert index”; Codex không tự thay đổi DB.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M02 — Gỡ toàn bộ auto-vector/Vector nút Editor; Save chỉ lưu metadata/ảnh

```text
Hãy triển khai DUY NHẤT task M02 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P0; Phụ thuộc phải hoàn thành: M01.
Files cần kiểm tra: `src/app.js`, `index.html`, `tests/frontend.test.js`, test bổ sung.
Yêu cầu: Gỡ nút “Tạo vector” trong Editor và gỡ/khóa đường gọi `vectorizeCurrentEditorPart`, `vectorizeSavedPart` từ Editor. Xóa trigger queue nền còn sót (bao gồm call khi khởi tạo phiên), nhưng chỉ xóa helper sau khi chứng minh không còn caller cần thiết. `savePart` không gọi Worker DINOv2, `/api/moris/vector-upsert`, IndexedDB enroll hay ghi vector. Đổi thông báo Editor: “Lưu ảnh xong, mở Trung tâm Vector AI để tạo/cập nhật vector thủ công”. Bảo toàn CRUD ảnh, catalogue, login.
Bằng chứng test cần có: Spy/mocks: lưu part mới, sửa metadata, thay ảnh, bấm Save nhiều lần; assert zero `/api/moris/vector-upsert`, zero worker embed, zero queue/enroll. Test UI không còn nút trong Editor.
Definition of Done: Mọi thao tác Editor vẫn lưu đúng nhưng không sinh vector hay chạy model; Center vẫn hoạt động.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M03 — Giới hạn mọi thao tác tạo vector vào Trung tâm Vector AI

```text
Hãy triển khai DUY NHẤT task M03 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P0; Phụ thuộc phải hoàn thành: M02.
Files cần kiểm tra: `tools/moris-vector-center.js`, `tools/moris-vector-center.html`, `functions/api/moris/vector-upsert.js`, test phân quyền.
Yêu cầu: Khẳng định chỉ các nút single/batch/reindex rõ ràng trong Center mới gửi request ghi vector. Với batch cần confirm số SKU/asset, preview thay đổi; kiểm tra role server-side. Không mở endpoint vector-upsert cho người ngoài quyền; cân nhắc quyền hiện tại `converter/editor/admin` và ghi lại quyết định, không tự mở rộng. Không có trigger từ mở trang, danh sách hoặc edit/save.
Bằng chứng test cần có: Mocks single và batch khi chưa click: zero writes; click single=đúng asset được chọn; batch chưa xác nhận=zero writes; 401/403 khi thiếu quyền.
Definition of Done: Ma trận hành vi được khóa bằng regression tests; thao tác ghi luôn do user chủ động ở Center.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M04 — Thiết kế upsert idempotent, chống nhân bản vector

```text
Hãy triển khai DUY NHẤT task M04 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P0; Phụ thuộc phải hoàn thành: M03.
Files cần kiểm tra: `functions/api/moris/vector-upsert.js`, `tools/moris-vector-center.js`, `supabase/migrations/` (CHỈ file đề xuất), `tests/moris-vector-features.test.js`.
Yêu cầu: Sửa `prevent_duplicate`: hiện chỉ xét record_id+asset_type, làm bỏ qua `canon_gray_v2`; phải xét đầy đủ image/object key + model + preprocess + profile + `view_variant`. Thiết kế create/skip/replace có explicit mode ở Center; nhấn lặp lại với same asset+same profile+same variant không tăng row count. Nếu ảnh thay nguồn, không để vector cũ vô hạn ở trạng thái active; quy trình inactivate/replace cần review và transaction an toàn. Với baseline **chỉ** lập chỉ mục `canon_rgb_v2`; không bật thêm `canon_gray_v2` hàng loạt cho tới khi benchmark chứng minh lợi ích và owner phê duyệt ngân sách lưu trữ.
Bằng chứng test cần có: Chạy cùng request 2 lần không tăng số row; variant RGB/gray được phân biệt (khi bật thử nghiệm); cùng asset loại khác không bị bỏ oan; partial failure không đánh dấu tất cả thành công; chạy thử trên DB test, không production.
Definition of Done: Bất biến idempotency cho tất cả key hợp lệ; không tự nhân đôi 1.090 vector hiện có; có kế hoạch rollback migration.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M05 — Xác định trạng thái vector theo ảnh nguồn: missing/ready/stale/partial

```text
Hãy triển khai DUY NHẤT task M05 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P1; Phụ thuộc phải hoàn thành: M04.
Files cần kiểm tra: `functions/api/moris/vector-items.js`, `tools/moris-vector-center.js`, RPC hiện hữu và file migration đề xuất.
Yêu cầu: Không dùng một boolean `has_vector` cho cả SKU. Đối chiếu từng image asset và vector (object_key, updated_at, profile, variant, checksum nếu có) để xác định `missing`, `ready`, `stale`, `partial`, `failed`. Nếu thay ảnh/metadata, Editor không chạy model và không insert vector; Center hiển thị “Cần cập nhật” cho ảnh có vector lỗi thời. Khi object_key không đổi nhưng nội dung thay, chỉ tin checksum/version được đo đúng, tránh tự suy luận. Không tự xóa hay reindex lúc save.
Bằng chứng test cần có: Các trường hợp không có vector, một trong hai view có vector, thay ảnh, stale profile, variant thiếu, object_key giữ nguyên nhưng version thay; trạng thái không được tự chuyển ready nếu thiếu bằng chứng.
Definition of Done: Center hiển thị đúng trạng thái ở mức asset; không một thay đổi Editor nào tự ghi vector.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M06 — Khóa hợp đồng embedding profile và đường fallback

```text
Hãy triển khai DUY NHẤT task M06 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P0; Phụ thuộc phải hoàn thành: M01.
Files cần kiểm tra: `src/moris/vector/dinov2.worker.js`, `src/moris/vector/browserDinov2.js`, `functions/_lib/moris/v5/vector/{profiles,encoder,contracts}.js`, `tests/`.
Yêu cầu: Phân biệt rõ `CLS` và `384D Masked-GeM + Edge` dù cùng chiều vector; định danh theo cả model revision, preprocessing, tensor conversion, pooling và profile. Nếu Worker patch tokens không có, **fail closed** hoặc chuyển sang profile/index riêng; không lặng lẽ nhân CLS thành 256 patches rồi gắn nhãn hybrid. Chốt tương thích index cũ trước khi đổi profile; không ghi đè vector production.
Bằng chứng test cần có: Golden fixture: shape [1,257,384], [1,384], tensor sai, profile sai, patch fallback; vector đủ norm, không NaN; profile khác bị 400.
Definition of Done: Không có hai thuật toán khác nhau cùng một profile; index cũ được cô lập hoặc có lộ trình chuyển đổi.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M07 — Chính thức hóa canonicalization + quality gate

```text
Hãy triển khai DUY NHẤT task M07 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P1; Phụ thuộc phải hoàn thành: M06.
Files cần kiểm tra: `src/moris/moris-layer1-optical.js`, `src/moris/vector/imageCanonicalizer.js`, `src/moris/vector/dinov2.worker.js`, `tests/moris-layer1-optical.test.ts`.
Yêu cầu: Đối chiếu preprocess lúc lập chỉ mục từ Center và lúc query; thống nhất alpha/black-matte/live-camera, PCA, padding, 224x224, thuật toán tensor. Kiểm soát ảnh quá sáng, bóng đổ, vật thể chạm mép, nền nhiều màu và vật thể dài. Khi tách nền kém, đánh dấu mask unreliable; không giả rằng toàn ảnh là linh kiện. Không thêm model segmentation hoặc yêu cầu cài công cụ bên ngoài khi chưa benchmark.
Bằng chứng test cần có: Bộ fixture alpha/black background, nền trắng/xám, shadow, tilt 0/90/180, vật thể chạm biên, vật thể rất dài; replay bảo đảm index/query canonicalization giống nhau.
Definition of Done: Cùng ảnh+profile sinh preprocessing tái lập; quality flags xuất ra rõ ràng, không làm sai cơ cấu vật thể.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M08 — Geometry contract: phân biệt unknown và zero; kiểm tra nhất quán lỗ

```text
Hãy triển khai DUY NHẤT task M08 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P1; Phụ thuộc phải hoàn thành: M07.
Files cần kiểm tra: `src/moris/moris-layer1-optical.js`, `functions/_lib/moris/v5/retrieval/{structuralEvidence,geometricReranker}.js`, `schemas`, test geometry.
Yêu cầu: Tách `hole_count=0` hợp lệ khỏi `hole_count unknown` khi mask hỏng; không ép null thành 0. Ghi provenance/quality cho count, centroids, aspect ratio, scale. Kiểm tra 55/545 cặp thumb/front lệch count trong dữ liệu thực (chỉ đọc hoặc xuất báo cáo kỹ thuật ẩn code cần thiết), không tự sửa ồ ạt; xử lý hình học thiếu đúng theo evidence availability.
Bằng chứng test cần có: 0 lỗ thật ≠ chưa đo; đếm lỗ ổn qua 180°; mặt trước/sau có che khuất; unknown không bị phạt như 0; property-based synthetic masks.
Definition of Done: Geometry contract có nullable/quality/version; report danh sách mâu thuẫn và kế hoạch làm sạch thủ công.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M09 — Chuẩn hóa candidate retrieval và filters ở server

```text
Hãy triển khai DUY NHẤT task M09 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P1; Phụ thuộc phải hoàn thành: M06.
Files cần kiểm tra: `functions/_lib/moris/v5/orchestrator.js`, `retrieval/{multiProbeSearch,vectorHitCollapse,candidatePool}.js`, `connectors/catalogue.js`.
Yêu cầu: Bảo toàn filter `usage_side`,`view_mode` sau hydrate; collapse theo SKU nhưng giữ best hit/view và lịch sử probe, không mất thông tin để giải thích; không chỉ scan mặc định rồi bỏ lọc. Phân biệt raw cosine với RRF composite để không đặt sai ngưỡng. Giảm false-negative khi topK giới hạn; đối chiếu exact baseline và ANN theo profile.
Bằng chứng test cần có: Một SKU có thumb/front/detail; 2 probes cạnh tranh; filter trái/phải; orphan vector; hit không có metadata; raw cosine vs fused không đánh tráo.
Definition of Done: Không trả ứng viên vi phạm filters; các tầng sử dụng cùng candidate identity và giữ bằng chứng.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M10 — Sửa giới hạn phân trang lọc catalogue 300 vs 2000

```text
Hãy triển khai DUY NHẤT task M10 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P1; Phụ thuộc phải hoàn thành: M00.
Files cần kiểm tra: `src/app.js`, `functions/_lib/moris/v5/connectors/supabase.js`, `supabase/migrations/2026101300010000_strict_feature_search_catalogue.sql` (chỉ đọc), test.
Yêu cầu: Khắc phục frontend gọi `p_limit:2000` trong khi RPC cap 300: dùng phân trang đủ, hoặc RPC filter server có phân trang ổn định. Không tăng LIMIT vô kiểm soát. Áp dụng đúng cho ID exact, code substring và feature search; đảm bảo toàn bộ 545 SKU có thể được xét.
Bằng chứng test cần có: Fixture >300, 545, 1000 và dữ liệu trùng thứ tự; mục tiêu nằm trang cuối vẫn được tìm; không làm suy giảm paging thường.
Definition of Done: Không false-negative vì giới hạn 300 hàng; SQL plan không tăng tải quá mức.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M11 — Quản trị riêng IndexedDB offline và bỏ side-effect Editor

```text
Hãy triển khai DUY NHẤT task M11 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P1; Phụ thuộc phải hoàn thành: M02, M05, M06.
Files cần kiểm tra: `src/app.js`, `src/moris/moris-worker-pipeline.js`, `src/moris/moris-idb.js`, `src/moris/vector/dinov2.worker.js`.
Yêu cầu: Quyết định nhánh IndexedDB là search fallback có version/TTL độc lập, không ghi vào cloud; không enroll signature từ editor/save. Nếu cần enroll local, chỉ cho người dùng kích hoạt trong Center. Khi server có kết quả, offline không được gộp thay đổi top10 không có bằng chứng; khi server lỗi khác với “không tìm thấy”, UI phải phân biệt.
Bằng chứng test cần có: Editor save không enroll; local missing/stale không thay candidate server; server 5xx không ngụy trang “không có mã”; test đồng bộ reload.
Definition of Done: Không còn split-brain bất ngờ giữa local và server; không ghi vector nền.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M12 — Một nguồn tính điểm cuối duy nhất; không ghi đè fusion

```text
Hãy triển khai DUY NHẤT task M12 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P0; Phụ thuộc phải hoàn thành: M09.
Files cần kiểm tra: `functions/_lib/moris/v5/retrieval/{scoreFusion,geometricReranker,structuralEvidence}.js`, `orchestrator.js`, `schemas/candidate.js`.
Yêu cầu: Gộp bằng chứng vector, metadata, hole, aspect, conflict thành một policy ranking có hệ số và availability rõ ràng. Không để reranker hình học overwrite final_score đã fusion rồi biến mất metadata penalty; điểm số phải là ranking score, không gắn nhãn phần trăm xác suất. Unknown evidence không được auto=1 rồi nhận thưởng. Theo dõi giải thích từng tín hiệu.
Bằng chứng test cần có: Metadata conflict không biến mất; thiếu hole/aspect không cộng điểm; hard negative 17-vs-5 holes được đẩy lên khi bằng chứng chắc chắn; cùng input→same output.
Definition of Done: Một đường xếp hạng có unit contract và breakdown; không double-count cùng tín hiệu.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M13 — Quy tắc orientation / mirror / chirality

```text
Hãy triển khai DUY NHẤT task M13 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P1; Phụ thuộc phải hoàn thành: M07, M08.
Files cần kiểm tra: `functions/_lib/moris/v5/guards/orientation.js`, `retrieval/geometricReranker.js`, `src/moris/geometry/pcaAligner.js`, tests.
Yêu cầu: Chỉ cho phép phép biến đổi thích hợp theo loại part, view mode và usage side. Không mặc định mirror X/Y là tương đương hình thật ở mã left/right, chi tiết không đối xứng. Tách canonical rotation 180° và mirror của mặt trước/sau. Cờ is_symmetric cần dữ liệu tin cậy; không tự dựa vào field false hàng loạt làm ground truth.
Bằng chứng test cần có: Ảnh quay 180° cùng part, left/right mirror phân biệt, front/back có thể đảo, đối xứng hợp lệ.
Definition of Done: Không vô tình xem mã trái/phải là một; kiểm tra orientation tách khỏi vector score.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M14 — Hole topology V2 — assignment tối ưu, xử lý đếm thiếu

```text
Hãy triển khai DUY NHẤT task M14 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P1; Phụ thuộc phải hoàn thành: M08, M13.
Files cần kiểm tra: `functions/_lib/moris/v5/retrieval/geometricReranker.js` hoặc module `holeMatcher.js` mới; `tests/moris-reranker.test.js`.
Yêu cầu: Thay sort-by-X + so sánh phần tử cùng chỉ số bằng matching song phương tối ưu (Hungarian hoặc thuật toán đúng với kích thước nhỏ). Cost gồm tọa độ chuẩn hóa, diện tích tương đối, radius/is_big và missing-penalty; đánh giá mọi phép biến đổi hợp lệ từ M13. Nếu độ tin cậy lỗ thấp, hạ trọng số thay vì hard reject. Giới hạn CPU/tối đa lỗ để chặn DoS.
Bằng chứng test cần có: Tâm lỗ trùng X khác Y, lỗ thêm/mất, lệch 1 vs 2, đối xứng, chirality, 17 vs 5; test deterministic và giới hạn thời gian.
Definition of Done: Hàm trả similarity + matched pairs + unmatched + reliability; benchmark hard-negative không xấu đi vượt gate.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M15 — Contour verifier và EFD có bảo vệ chất lượng mask

```text
Hãy triển khai DUY NHẤT task M15 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P1; Phụ thuộc phải hoàn thành: M07, M13.
Files cần kiểm tra: `src/moris/moris-layer3-rerank.js`, `src/moris/geometry/`, `functions/_lib/moris/v5/retrieval/` (module mới khi cần).
Yêu cầu: Mang contour/EFD vào đường rerank chính theo contract có version, không phụ thuộc cache IndexedDB trên từng máy. So sánh contour có căn chỉnh scale, rotation đúng, chamfer/distance transform hoặc EFD. Cần đường truyền metadata có kiểm soát: không tự phình DB vì lưu dense patches/contours của mọi ảnh trước khi đo ngân sách. Chỉ bật khi mask đạt quality threshold.
Bằng chứng test cần có: Hình L/U giống vector nhưng khác mép, ngàm nhỏ; mask lỗi; scale/rotation; latency; không mirror trái/phải bất hợp lệ.
Definition of Done: Contour signal chứng minh cải thiện trên hard negatives được phép; có fallback an toàn.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M16 — Local spatial patch reranking có feature flag

```text
Hãy triển khai DUY NHẤT task M16 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P2; Phụ thuộc phải hoàn thành: M06, M09, M15.
Files cần kiểm tra: `src/moris/moris-layer2-embedding.js`, `src/moris/moris-layer3-rerank.js`, `functions/_lib/moris/v5/retrieval/`, test.
Yêu cầu: Đưa Top-32 spatial key patches vào verifier cho Top-K ứng viên: so khớp chi tiết rãnh/ngàm/gờ sau căn chỉnh. Kiểm tra DINO output thực có patch tokens; không dùng 256 bản sao CLS làm spatial feature. Thiết kế lấy/tính patch chỉ khi cần, feature-flag OFF mặc định và không tự lưu bộ patch 256x384 vào DB production.
Bằng chứng test cần có: Spatial/no-spatial fallback; fixture cạnh/tương phản; ranking ablation; giới hạn bộ nhớ và thời gian trên WASM/WebGPU.
Definition of Done: Chỉ bật nếu đo được cải thiện sau khi trừ chi phí latency/storage; không thay đổi profile cũ.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M17 — Reliability-aware fusion, thiếu tín hiệu không thưởng/phạt

```text
Hãy triển khai DUY NHẤT task M17 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P1; Phụ thuộc phải hoàn thành: M12, M14, M15.
Files cần kiểm tra: `functions/_lib/moris/v5/retrieval/scoreFusion.js`, `schemas/ranking.js`, `preprocess/quality.js`.
Yêu cầu: Thiết kế available/quality riêng cho vector, hole graph, contour, aspect, patch; chuẩn hóa lại trọng số khi vắng tín hiệu. Chỉ áp dụng penalty mạnh cho bằng chứng xung đột có độ tin cậy cao. Loại bỏ việc áp 40% weight lỗ khi ảnh không có count; không dùng 0/1 mơ hồ.
Bằng chứng test cần có: Thiếu count, count=0 thật, mask kém, metadata thiếu, view không chắc, lỗi endpoint; final ranking không NaN và không giả confidence.
Definition of Done: Phân rã điểm giải thích được, có test giới hạn và tính chất đơn điệu.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M18 — Multi-view candidate fusion và tập kết quả cấp SKU

```text
Hãy triển khai DUY NHẤT task M18 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P1; Phụ thuộc phải hoàn thành: M09, M12, M17.
Files cần kiểm tra: `functions/_lib/moris/v5/retrieval/{multiProbeSearch,vectorHitCollapse,candidatePool}.js`, `orchestrator.js`.
Yêu cầu: Đo hiệu quả index 1 variant RGB/asset so với tùy chọn gray; query multi-probe có thể sử dụng nhưng không tự nhân vector lưu. Điều chỉnh RRF/margin trên *cùng đơn vị điểm*, phân biệt similarity thô với score trộn. Giữ best view evidence, áp dụng filter mặt trái/phải và trả 1 SKU duy nhất sau rerank.
Bằng chứng test cần có: Bản ghi 2 views, duplicate probe, identical embeddings, correct SKU chỉ có view back, invalid usage_side.
Definition of Done: Top10 không trùng SKU, giữ đúng nguyên nhân khớp, không tự tăng số vector trên DB.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M19 — Dataset manifest và chính sách ground truth

```text
Hãy triển khai DUY NHẤT task M19 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P0; Phụ thuộc phải hoàn thành: M00.
Files cần kiểm tra: `evaluation/moris-v6/README.md`, `evaluation/moris-v6/manifest.example.jsonl`, script xác minh dataset.
Yêu cầu: Định nghĩa dataset từ ảnh catalogue và ảnh chụp xưởng có quyền sử dụng: `query_id`, `expected_sku`, view, lighting, angle, source group, known/unknown, mask/hole labels (nếu có). Tách trường hợp same-asset, cross-view và true camera. Không đưa secret, link có token, ảnh nội bộ vào git công khai; lưu ảnh nội bộ trong vùng được phép. Chốt test set bất biến và split để tránh leakage.
Bằng chứng test cần có: Manifest schema validation; duplicate image hash, missing labels, leaking same physical shot across train/test; test tự chạy trên fixture synthetic nếu chưa có ảnh thật.
Definition of Done: Có data dictionary, script kiểm tra dataset và ghi rõ số mẫu thật; không bịa 80%/90%.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M20 — Evaluation CLI với top1/recall@10,@50/MRR/abstain/p95

```text
Hãy triển khai DUY NHẤT task M20 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P0; Phụ thuộc phải hoàn thành: M19.
Files cần kiểm tra: `tools/evaluate-moris-v6.mjs` (mới), `evaluation/moris-v6/`, `tests/`.
Yêu cầu: Tạo runner **offline/read-only** ăn query, ground truth và output candidate đã snapshot. Báo Top1, Recall@10, Recall@50, MRR@10, unknown false-accept, retrieval misses, rerank misses, latency p50/p95; bootstrap CI khi đủ mẫu. Không ghi index/vector. Xuất JSON và MD kết quả có dataset SHA, commit SHA, n, timestamp, parameters.
Bằng chứng test cần có: Synthetic case Top1 đúng/sai, no-answer, repeated query, topK shrink; metric consistency & deterministic seed.
Definition of Done: Có baseline tái lập được; phân biệt cross-view 78/80 tự kiểm thử với benchmark camera thật chưa chạy.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M21 — Bộ hard-negative regression cơ khí

```text
Hãy triển khai DUY NHẤT task M21 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P1; Phụ thuộc phải hoàn thành: M08, M19, M20.
Files cần kiểm tra: `evaluation/moris-v6/`, `tests/moris-hard-negatives.test.js`.
Yêu cầu: Đưa cặp `3405030101`↔`3427740001` (khác 17/5 lỗ), cặp `3425000001`↔`3424990001` (3/3 lỗ), 55 cặp mismatch thumb/front vào candidate fixture/manifest có truy xuất hợp lệ; không đưa nhận định cùng loại camera nếu chỉ là ảnh catalogue. Tạo thêm nhóm L/R, no holes, shadow, glare, rotated, long thin part, same-outline-different-punch. Quy trình curator xác nhận nhãn từng trường hợp.
Bằng chứng test cần có: Tests giữ đúng vị trí tương đối theo đặc trưng khi có đủ fixture, không hardcode SKU vào thuật toán; test data manifest đóng băng.
Definition of Done: Mỗi regression gắn bằng chứng ảnh, expected outcome và đầu ra trước/sau; không overfit test bằng rule riêng cho mã.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M22 — Ablation, tuning và quyết định go/no-go bằng số liệu

```text
Hãy triển khai DUY NHẤT task M22 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P0; Phụ thuộc phải hoàn thành: M12, M14, M15, M17, M18, M20, M21; M16 tùy chọn.
Files cần kiểm tra: `evaluation/moris-v6/results/` (chỉ báo cáo không dữ liệu nhạy cảm), `docs/moris-v6/DECISION.md`.
Yêu cầu: Chạy nhiều cấu hình trên cùng benchmark: global-only; +hole; +contour; +patch; +multi-probe; rerank confidence/reject. Điều chỉnh weight trên development split, đánh giá cuối trên holdout chưa nhìn; đo phân tầng theo camera, ánh sáng, nhóm part. Không đặt mục tiêu đạt 90% giả khi thiếu tập thật. Nếu Recall@50 yếu, quay về encoder/preprocess; nếu Recall@50 tốt nhưng Top1 yếu, đầu tư reranker.
Bằng chứng test cần có: Báo chỉ số trước/sau, cỡ mẫu, mức biến động, latency và storage; regression gate cho kịch bản quan trọng.
Definition of Done: Bản quyết định kỹ thuật với bằng chứng; tính năng không cải thiện có thể giữ OFF hoặc loại bỏ.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M23 — Thiết kế migration an toàn, backup, dry-run và quota

```text
Hãy triển khai DUY NHẤT task M23 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P0; Phụ thuộc phải hoàn thành: M04, M05, M08, M22.
Files cần kiểm tra: `supabase/migrations/` (file đề xuất), `docs/moris-v6/DB_MIGRATION.md`.
Yêu cầu: Nếu cần cột `embedding_signature_version`, asset digest, trạng thái stale hoặc unique semantics, viết migration mới additive và reverse plan. SQL phải xem schema/thực trạng quyền/RLS/SECURITY DEFINER; không cập nhật production trực tiếp trong task. Dự tính trước số hàng, kích thước thêm, index bloat, giới hạn mỗi SKU. Không chạy purge/truncate, xóa vector không có backup và phê duyệt.
Bằng chứng test cần có: Review diff schema, dry-run ở local/staging, restore rehearsal, chạy RLS/advisor được hỗ trợ, kiểm thử RPC quyền.
Definition of Done: Có tài liệu thủ tục apply/rollback và xác nhận owner trước bước production.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M24 — Trung tâm Vector AI: reindex thủ công theo batch có preview/dry-run

```text
Hãy triển khai DUY NHẤT task M24 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P0; Phụ thuộc phải hoàn thành: M03, M04, M05, M06, M23.
Files cần kiểm tra: `tools/moris-vector-center.js`, `functions/api/moris/{vector-upsert,vector-items,reindex-batch}.js`, test E2E.
Yêu cầu: Tạo lựa chọn rõ ràng `Chỉ tạo phần thiếu`, `Cập nhật phần stale`, `Rebuild có xác nhận`; hiển thị dự báo số asset, số vector bị thay, ước lượng tăng thực tế. Manual click mới tạo embedding; chunk <=20 theo API, retry idempotent, progress và lỗi từng asset. Chỉ bật Gray variant sau A/B benchmark và chấp thuận. Giữ nguyên tính năng admin purge cũ nhưng tuyệt đối không tự gọi.
Bằng chứng test cần có: Batch 0, 1, >20, retry timeout, pause/resume, 409 duplicate, partial failure, refresh status; không ghi khi chưa confirm; repeated rebuild không tăng rows.
Definition of Done: Tạo vector trong Center duy nhất; có số liệu actual before/after và rollback; không tạo từ Editor.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M25 — UI Moris: confidence có căn cứ, lý do khớp, low-quality/reject

```text
Hãy triển khai DUY NHẤT task M25 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P1; Phụ thuộc phải hoàn thành: M17, M18, M22.
Files cần kiểm tra: `src/app.js`, `index.html`, `functions/_lib/moris/v5/presentation/{publicResult,userMessage}.js`, frontend tests.
Yêu cầu: Hiển thị ranking score như điểm so khớp, không công bố 90% probability nếu chưa calibration; show nguyên nhân `holes`, `contour`, `view`, `quality`. Nếu không đủ evidence hoặc ảnh không có mã, đưa hướng dẫn chụp lại/không có ứng viên. Giữ luồng Chat text, ID exact, filter và click mở detail. Không thêm nút vector vào Editor.
Bằng chứng test cần có: Empty result, unknown, mask unreliable, 2 ứng viên sát điểm, OR orientation ambiguity, UI mobile và desktop.
Definition of Done: Người vận hành không bị dẫn dắt bởi confidence giả; ứng viên đúng click được.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```

### M26 — Staging E2E, canary, rollback và xác nhận phát hành

```text
Hãy triển khai DUY NHẤT task M26 trong MORIS_V6_MASTER_PLAN.md.
Ưu tiên: P0; Phụ thuộc phải hoàn thành: M23, M24, M25.
Files cần kiểm tra: `docs/moris-v6/RELEASE_CHECKLIST.md`, `tests/`, `state.json`, `plan.md` (append thay vì ghi đè lịch sử).
Yêu cầu: Chạy full suite trên commit release, smoke login 2FA/RLS/CSRF/anti-bot, Editor save không upsert, Vector Center manual only, tìm ảnh camera, text, mobile/WebGPU/WASM. Canary với feature flag, so sánh Top1/Recall@10/false accepts/p95 và kích thước index. Có rollback cả app + vector profile + migration; không cần deploy khi chưa có owner approval.
Bằng chứng test cần có: `npm test`, `npm run build`, TS check khi cài hợp lệ, snapshot logs, E2E staging; ghi rõ đã chạy/chưa chạy.
Definition of Done: Go/no-go minh bạch, release sign-off, production không tự update vector; cập nhật state/plan có evidence và commit.
Nghiêm cấm phá invariant: Editor Save không tự vector hóa; chỉ Center single/batch explicit; không tăng rows khi re-run cùng key; không sửa production/deploy; không bịa metric.
Trước khi sửa hãy tóm tắt call graph/impact. Kết thúc xuất: [Files changed], [Test commands + exact outcomes], [DB writes/rows delta], [Risks], [Rollback], [Commit hash nếu có], [Next review gate]. Nếu gặp blocker, không tự lách.
```


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
