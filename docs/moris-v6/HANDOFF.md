# Moris V6 — Bàn giao khi quota còn thấp

Cập nhật: 2026-10-16. Mục đích: agent tiếp theo tiếp tục đúng phạm vi, không chạy lại các lượt inference tốn tài nguyên và không nhầm mục đã code với gate đã nghiệm thu.

> Bắt đầu nhanh: đọc [TECH_DEBT_ROADMAP.md](TECH_DEBT_ROADMAP.md) để nắm thứ tự xử lý và các nguồn thông tin chuẩn; roadmap là kiểm kê gate Moris đã biết, không thay cho audit toàn repository.

## Ràng buộc không đổi

- Đọc `AGENTS.md`, `state.json`, file này và `MORIS_V6_MASTER_PLAN.md` trước khi sửa.
- Không ghi database production, không deploy, không dùng secret trong chat hoặc `.env` cho thao tác ghi. Không tạo commit khi chưa được yêu cầu.
- Chủ dự án yêu cầu bỏ qua staging; giữ trạng thái `skipped`, tuyệt đối không ghi staging pass và không hỏi lại URL staging.
- Chủ dự án yêu cầu tránh vượt quota. Mức quota còn lại chưa được đo. Không chạy lại model WASM trên 545 ảnh, holdout, benchmark hay full suite chỉ để xác nhận số cũ. Báo chủ dự án trước khi cân nhắc một lượt tốn tài nguyên mới.
- Holdout31 ảnh đã được mở và dùng. Không dùng lại để chỉnh/tối ưu hoặc gọi là holdout chưa xem.

## Git và checkpoint

Branch `feat/moris-v6`, HEAD `02289afa79747722b992938bee7c2d0414f7a9d2`; worktree có khoảng139 mục thay đổi/untracked tại checkpoint, chưa commit. Bảo toàn mọi thay đổi gốc, gồm tài liệu bị xóa, `image/`, `image 2/` và `dist/version.json`. Không dùng `git reset --hard`, `git clean` hoặc hoàn tác hàng loạt. `git diff --check` sạch ở lần rà gần nhất.

## Trạng thái task

Đã triển khai và ghi test/evidence: M06–M13, M17, M19–M20, M23–M25. Đây là trạng thái triển khai trong worktree, không phải chấp thuận production.

| Task | Trạng thái nghiệm thu hiện tại |
|---|---|
| M14 | Code và test tổng hợp có; mở lại gate vì ablation geometry kém global trên development và chưa có hard-negative curator xác nhận. |
| M15 | Contour có implementation nhưng OFF; chưa chứng minh cải thiện trên hard negatives thật. |
| M16 | Patch có implementation nhưng OFF; WebGPU/device budget chưa đo. |
| M18 | SKU/view fusion có tests; chưa có tập ảnh nhiều view/gray A/B phù hợp. |
| M21 | Bộ review liên kết 57 mục; 0 curator outcome, chưa có before/after case snapshots đã duyệt. |
| M22 | Đã chạy benchmark hiện có, quyết định NO-GO. Không gọi task đạt toàn bộ nghiệm thu còn thiếu. |
| M26 | Local checks đạt phần nào; staging được chủ dự án bỏ qua. Chưa canary, release approval hay sign-off. |

## Bằng chứng hiện có

- Tập camera do chủ dự án xác nhận:124 ảnh, 93 development và31 holdout; manifest SHA-256 `128f2d9a7c0ec6fc4ee73109df48dc93232eb2e67cc5a351855c241620f89a1a`. Cùng545 reference ảnh catalogue, 669/669 inference thành công.
- Development/global: Top1 58/93, Recall@10 78/93, Recall@50 88/93. Geometry/contour/patch: Top1 54/93, Recall@10 75/93.
- Holdout/global đã dùng: Top1 20/31, Recall@10 29/31, Recall@50 31/31. Geometry variants bằng global trên holdout vì reliable masks 0/31. NO-GO; không suy ra FAR vì không có unknown-negative set.
- Local HNSW so với exact: mean Top50 overlap 99.9785%, min98%, 93 truy vấn/545 vectors; đây là ANN fidelity, không phải nhận diện chính xác.
- Runtime automatic image geometry mặc định OFF theo lựa chọn development; ràng buộc người dùng nhập bằng text vẫn giữ. Thay đổi này không bật production.
- M21 queue giải được55/55 legacy refs, xác minh59 hash front; tất cả57 outcomes còn null/pending. Ranking development liên kết11 mục; 46 không có query development, gồm cả hai cặp SKU được nêu. Không dùng holdout.
- Lần full suite mới nhất:398/398 ở44 files, nhưng xảy ra trước khi thêm hai test focused cuối. Hai test file review gần nhất đạt10/10. Không được ghi rằng full suite hiện tại có400 test nếu chưa chạy. TS `npx tsc --noEmit` exit0, build49 files và local E2E12/12 thuộc checkpoint ứng dụng trước các thay đổi review-tool-only. Staging/auth2FA không được E2E thật.

Xem [DECISION.md](DECISION.md), [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md), [M21.md](M21.md), [M22.md](M22.md), [M14.md](M14.md), [M15.md](M15.md), [M16.md](M16.md), [M18.md](M18.md), [DB_MIGRATION.md](DB_MIGRATION.md).

## Việc cần có trước khi đóng các gate

1. Curator cần mở `evaluation/moris-v6/hard-negative-review-queue.json` và ảnh local tại `evaluation/moris-v6/private/catalogue-front/`. Đối chiếu front/thumb, điền người review, thời điểm, expected outcome và ảnh/hash phù hợp; metadata mismatch không tự chứng minh ảnh sai. Tạo ranking snapshots trước/sau thật cho case đã duyệt. Hai cặp SKU chỉ định không có query trong development; cần query/dữ liệu mới, không lấy holdout cũ để tuning.
2. Muốn tune encoder/geometry, thu bộ ảnh camera mới có SKU/view/lighting/angle/session đã xác nhận, tách development và holdout chưa mở. Định nghĩa unknown-negative set nếu cần FAR. Trên dữ liệu mới chạy global/hole/contour/patch/multi-probe/reject ablation; chọn cấu hình trên development, đóng băng hash rồi mới chạy holdout đúng một lần.
3. M18 cần ảnh cùng SKU ở front/back hoặc nhiều view đã gán nhãn và ground truth phù hợp. Metadata snapshot hiện có545 `single_face`, không có cờ symmetry đã xác minh; không coi thumb là back view. Gray probe hiện còn bị gate trong worker/orientation policy.
4. M16 cần thiết bị thật được phép dùng để đo WASM/WebGPU latency, memory và chất lượng. Local headless Chromium thấy `navigator.gpu` nhưng `requestAdapter()` trả null.
5. M26 chỉ tiếp tục phần phát hành theo quyền hạn được cấp. URL Pages đã cung cấp là production branch `main`; owner yêu cầu bỏ qua staging, và production/deploy vẫn bị cấm. Local E2E12/12 dùng fixture auth/R2/model; không đại diện 2FA/RLS/CSRF/anti-bot trên staging.

## Tiếp tục tiết kiệm quota

Trước hết xử lý nhãn curator và thiết bị/dataset ở trên; việc này chưa cần chạy lại inference. Khi chủ dự án cho phép chi quota, agent tiếp theo chạy focused tests, rồi full suite/TS/build theo đúng file đã thay đổi. Chỉ inference ảnh mới khi có split mới, không chạy lại 545 reference hay holdout cũ. Báo cáo mọi chỉ số từ output thật, cập nhật state và ba checklist, và để `[ ]` cho gate chưa đạt.

Các lần xác minh gần đây: [full-test398.log](evidence/M21-review-final-full-test.log), [focused-test10.log](evidence/M21-review-link-tests.log), [M22 decision](evidence/M22-holdout-summary.json), [M21 review counts](evidence/M21-development-priority.json), [release checks](evidence/M22-gate-e2e.log).
