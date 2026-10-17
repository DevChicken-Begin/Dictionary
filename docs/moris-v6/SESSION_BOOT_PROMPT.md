# Moris V6 — Prompt khởi động phiên mới

> Cách dùng: mở phiên agent mới tại repo `/workspaces/Dictionary`, dán nguyên khối **PROMPT** bên dưới làm tin nhắn đầu tiên. Agent mới vào đúng ngữ cảnh mà không cần đọc lại toàn bộ codebase.

---

## PROMPT (copy từ đây)

Bạn là agent tiếp nhận dự án **Catalogue AI (Dictionary)** — nhánh công việc **"Moris V6 nâng cấp tìm kiếm ảnh linh kiện"**. Phiên trước đã hoàn tất nghiên cứu & thiết kế; phiên này **thi hành nâng cấp**. KHÔNG đọc toàn bộ codebase — chỉ đọc các file được chỉ định dưới đây.

### 0. Đọc theo đúng thứ tự (khoảng 10 phút, đủ ngữ cảnh)

1. `AGENTS.md` — Hiến pháp, bắt buộc tuân thủ.
2. `state.json` — xem `current_session.last_checkpoint` + `resumption_prompt`, task cuối `task_22_asset_standard_r2_replace_plan`, và `moris_v6.M27/M28/M29/M30`.
3. `pipeline_moris.md` — tài liệu nghiên cứu trung tâm (~650 dòng). Đọc kỹ **§10, §11, §12**; §0–9 chỉ tra khi cần.
4. `plan.md` — các mục cuối (checkpoint 2026-10-17) là checklist việc.
5. `docs/moris-v6/HANDOFF.md` + `docs/moris-v6/TECH_DEBT_ROADMAP.md` — ràng buộc quota/production (HANDOFF đã đồng bộ ngày 2026-10-17).

### 1. Trạng thái repo thực tế (đã kiểm chứng — không cần dò lại)

- Worktree `/workspaces/Dictionary`; branch `main`. Toàn bộ tài liệu Moris V6 (`pipeline_moris.md`, `plan.md`, `state.json`, `SESSION_BOOT_PROMPT.md`, `docs/moris-v6/HANDOFF.md`) đã được commit và push lên `origin/main` ngày 2026-10-17 — worktree sạch lúc bàn giao.
- Commit nền trước bàn giao: `2657b49` (trùng tip `origin/feat/moris-v6`) — dùng hash này để đọc file đã bị xoá: `MORIS_V6_MASTER_PLAN.md`, `MORIS_V6_QUICK_CHECKLIST.md`, `CODEX_MORIS_V6_TASK_PROMPTS.md` do CHỦ DỰ ÁN xoá — KHÔNG khôi phục.
- Tự xác nhận trước khi làm: `git status --short && git log --oneline -3`. Nếu có thay đổi mới → là công việc đang làm dở, không xoá. KHÔNG `git reset --hard`, KHÔNG `git clean`; không commit/push/deploy khi chưa được yêu cầu.
- Kiểm thử: `npm test` (vitest), `npx tsc --noEmit`, `npm run build` — ưu tiên focused test để tiết kiệm quota.

### 2. Bối cảnh dự án trong 10 dòng

- Stack: Vue 3 CDN + Cloudflare Pages Functions + Supabase (pgvector halfvec 384D) + Cloudflare R2 (`catalogue-images`).
- Moris = tìm kiếm ảnh linh kiện dập kim loại. Runtime: profile `hybrid_gem3_edge_55_45_pseudorgb_u8_v1` / canonical `kim_canon_v3_letterbox` / dinov2-small 384D; geometry/contour/patch đang OFF (M22 NO-GO).
- Bất biến: Editor chỉ CRUD metadata+ảnh, KHÔNG ghi vector; chỉ **Trung tâm Vector AI** ghi vector (role admin/editor/converter, xác nhận người dùng); query embedding tạm; giữ 2FA/RLS/CSRF/anti-bot.
- Vấn đề gốc: pipeline bất biến tỉ lệ (crop sát vật + letterbox 224×224, toạ độ chuẩn hoá) → **không phân biệt 2 mã cùng hình dạng khác kích thước**; DB không có cột mm.
- Quyết định đã chốt với chủ dự án: (a) chuẩn **5 asset/mã = thumb + front + back + 2 detail**; (b) thay ảnh phải **xoá** object R2 cũ (không ghi chồng); (c) size = cặp `(length_mm, width_mm)` theo trục PCA, `L ≥ W`; (d) cấm generative inpainting.
- Kế hoạch chi tiết đã viết sẵn trong `pipeline_moris.md` §12 — việc còn lại là thi hành **P0 → P3**.

### 3. Cheat-sheet file:line (khỏi dò codebase)

| Khu vực | Vị trí |
|---|---|
| Editor lưu mã (upload + replace assets) | `src/app.js` — `savePart` :1889, `mergeAsset` :1883, `uploadToR2` :1815-1836, `deleteCurrentPart` :1953 |
| Nén ảnh WebP client | `src/app.js` — `compressImageToWebp` :1748-1764, tham số chất lượng :1825-1832 |
| API upload R2 | `functions/api/upload.js` — asset types :7, giới hạn 10MB :9, PUT key :157-166 |
| Xoá mã (1 mã / hàng loạt) | `functions/api/catalogue/delete-part.js`; `bulk-delete.js` :81-93; `delete-all.js` |
| Ghi vector (Vector Center) | `functions/api/moris/vector-upsert.js` :117,136; `tools/moris-vector-center.js` :325,466 |
| Query đa ảnh | `functions/_lib/moris/v5/retrieval/multiProbeSearch.js` :36 (cap 3); `vectorHitCollapse.js` :14 |
| Runtime config / vector search | `functions/_lib/moris/v5/runtime/config.js` :7-14; `functions/_lib/moris/v5/vector/search.js` :49-63 (fallback profile) |
| Layer 1 / tensor DINOv2 | `src/moris/moris-layer1-optical.ts` (mask flags :354-373, letterbox :757-770); `src/moris/vector/dinov2.worker.js` :225-239 |

**3 phát hiện quan trọng (đã xác minh code, chi tiết trong `pipeline_moris.md` §4/§11.4):** B13 — không có phân loại hình dạng lỗ từ ảnh; B14 — thay ảnh trong editor **không xoá** object R2 cũ; B15 — xoá 1 mã **không purge R2** (chỉ bulk-delete purge).

### 4. Việc của phiên này

**P0 — thu từ chủ dự án (hỏi ngay đầu phiên nếu chưa có):**
1. Trả lời **Q1–Q8** (`pipeline_moris.md` §8), **Q9–Q11** (§10.7), **Q12–Q14** (§11.5). Q15 đã trả lời.
2. Xác minh read-only 2 mã `3421750001` / `3421760001` trên Trang Trung tâm Vector AI (`asset_type` + `has_vector`) → chốt mâu thuẫn M18 snapshot (16-10 ghi chỉ front/thumb).
3. Duyệt phạm vi **M30**.

**P1 — code S1 (đúng thứ tự, mỗi việc kèm focused test; chi tiết §12.3):**
1. **M30** — sửa B14 (xoá object R2 cũ khi replace) + B15 (purge R2 khi xoá lẻ), audit orphan, quota monitor.
2. **Pilot 20 mã** — chụp chuẩn 5 ảnh, đo dung lượng WebP thật (thay ước lượng), index Vector Center front/back/detail, đọc lại listing xác nhận.
3. **M27** — tap-to-lock + readiness 5 điều kiện + classifier bóng/chói + voting đa khung + hole-shape evidence; giữ nguyên canonicalization v3, không re-index.
4. **M28** — UI nhập size (cạnh dài/ngắn + "không rõ") + gate 2 tầng phía query (fail-open).

**P2 — EVAL:** dataset đóng băng + manifest SHA-256; đo mask IoU, hole-shape accuracy, size gate precision, Top1/Recall@10, ablation multi-view — theo quota.
**P3 — gated:** CHỈ khi Gate D + owner duyệt: S2 `kim_canon_v4_*` + re-index 4.500 vector + A/B.

### 5. Luật bất di bất dịch

- Không ghi production / deploy / re-index / đổi canonicalization khi chưa qua **Gate D** + owner duyệt. **S1 không re-index.**
- Không chạy lại inference nặng (545 ảnh, holdout, full benchmark) chỉ để xác nhận số cũ; hỏi trước khi tốn quota. Holdout 31 ảnh đã dùng — không tái sử dụng.
- Bỏ qua staging (không hỏi lại URL).
- Sau **MỖI** task: cập nhật `state.json` (tasks + `moris_v6` status) và đánh dấu `plan.md` theo AGENTS.md §II; ghi checkpoint rõ ràng.
- Báo cáo trung thực, kèm evidence (output test/log); không tuyên bố thành công khi chưa chạy.
- Ngôn ngữ: tiếng Việt; trả lời ngắn gọn, không lan man.
- Điều gì chưa rõ → **hỏi chủ dự án**, không suy đoán (theo AGENTS.md).

### 6. Bắt đầu ngay

1. Chạy 1 lần `git status --short && git rev-parse --short HEAD` để xác nhận trạng thái ở mục 1.
2. Hỏi chủ dự án các mục P0 chưa được cung cấp.
3. Triển khai P1 bước 1 (M30) ngay khi được duyệt — bắt đầu bằng việc đọc 4 file trong bảng mục 3 + `pipeline_moris.md` §11.4/§12.2.
4. Kết thúc phiên: cập nhật `state.json` + `plan.md`, ghi rõ việc đã xong / đang chờ / bằng chứng.

## (hết PROMPT)
