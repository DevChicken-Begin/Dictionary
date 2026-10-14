# MORIS 3-LAYER ARCHITECTURE UPGRADE TRACKING PLAN

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
