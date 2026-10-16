# MORIS V6 — LỘ TRÌNH TRIỂN KHAI NHANH

Điểm vào agent kế tiếp: [TECH_DEBT_ROADMAP.md](docs/moris-v6/TECH_DEBT_ROADMAP.md); trạng thái chi tiết tại [HANDOFF.md](docs/moris-v6/HANDOFF.md) và `state.json`.

> **Ủy quyền phiên 2026-10-16:** Chủ dự án yêu cầu chạy loop tuần tự từng task đến hết plan. Quy tắc giao từng prompt/dừng xin phép giữa các task được thay bằng checkpoint có test, bằng chứng, rủi ro và rollback trước khi chuyển task. Giữ nguyên điều kiện nghiệm thu; thiếu dữ liệu hoặc bằng chứng thì để `[ ]`. Không ghi production, không deploy; Gate D/E và phê duyệt dung lượng vẫn bắt buộc.

**Quy tắc ưu tiên:** không tự tạo vector từ Editor. Editor chỉ ghi metadata/ảnh. Vector Center only, explicit user action, idempotent. Không auto batch index. Mọi triển khai phải có test. Không ghi Supabase production nếu chưa duyệt.

## Phase A: Khóa luồng ghi vector và bảo vệ Editor

- [x] M00 (P0) Đóng băng baseline, xác minh branch và trạng thái test — sau Không
- [x] M01 (P0) Định nghĩa quyền sở hữu ghi vector và các invariants — sau M00
- [x] M02 (P0) Gỡ toàn bộ auto-vector/Vector nút Editor; Save chỉ lưu metadata/ảnh — sau M01
- [x] M03 (P0) Giới hạn mọi thao tác tạo vector vào Trung tâm Vector AI — sau M02
- [x] M04 (P0) Thiết kế upsert idempotent, chống nhân bản vector — sau M03
- [x] M05 (P1) Xác định trạng thái vector theo ảnh nguồn: missing/ready/stale/partial — sau M04

## Phase B: Chuẩn dữ liệu, vector và truy xuất

- [x] M06 (P0) Khóa hợp đồng embedding profile và đường fallback — sau M01
- [x] M07 (P1) Chính thức hóa canonicalization + quality gate — sau M06
- [x] M08 (P1) Geometry contract: phân biệt unknown và zero; kiểm tra nhất quán lỗ — sau M07
- [x] M09 (P1) Chuẩn hóa candidate retrieval và filters ở server — sau M06
- [x] M10 (P1) Sửa giới hạn phân trang lọc catalogue 300 vs 2000 — sau M00
- [x] M11 (P1) Quản trị riêng IndexedDB offline và bỏ side-effect Editor — sau M02, M05, M06

## Phase C: Benchmark sớm, thuật toán hình học và ranking

- [x] M12 (P0) Một nguồn tính điểm cuối duy nhất; không ghi đè fusion — sau M09
- [x] M13 (P1) Quy tắc orientation / mirror / chirality — sau M07, M08
- [ ] M14 (P1) Hole topology V2 — assignment tối ưu, xử lý đếm thiếu — sau M08, M13
- [ ] M15 (P1) Contour verifier và EFD có bảo vệ chất lượng mask — sau M07, M13
- [ ] M16 (P2) Local spatial patch reranking có feature flag — sau M06, M09, M15
- [x] M17 (P1) Reliability-aware fusion, thiếu tín hiệu không thưởng/phạt — sau M12, M14, M15
- [ ] M18 (P1) Multi-view candidate fusion và tập kết quả cấp SKU — sau M09, M12, M17
- [x] M19 (P0) Dataset manifest và chính sách ground truth — sau M00
- [x] M20 (P0) Evaluation CLI với top1/recall@10,@50/MRR/abstain/p95 — sau M19
- [x] M21 (P1) Bộ hard-negative regression cơ khí — sau M08, M19, M20
- [ ] M22 (P0) Ablation, tuning và quyết định go/no-go bằng số liệu — sau M12, M14, M15, M17, M18, M20, M21; M16 tùy chọn

## Phase D: Migration, Trung tâm Vector AI, rollout

- [x] M23 (P0) Thiết kế migration an toàn, backup, dry-run và quota — sau M04, M05, M08, M22
- [x] M24 (P0) Trung tâm Vector AI: reindex thủ công theo batch có preview/dry-run — sau M03, M04, M05, M06, M23
- [x] M25 (P1) UI Moris: confidence có căn cứ, lý do khớp, low-quality/reject — sau M17, M18, M22
- [ ] M26 (P0) Staging E2E, canary, rollback và xác nhận phát hành — sau M23, M24, M25

**Review gates:** GATE A=M05; GATE B=M11+M20; GATE C=M22; GATE D=trước DB migration/reindex production; GATE E=M26.

Bằng chứng M00–M05: `docs/moris-v6/PHASE_A_REVIEW.md`; đây là triển khai local, không phải sign-off production.

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
