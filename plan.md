# KẾ HOẠCH CHI TIẾT & CHECKLIST TIẾN ĐỘ (PLAN.MD)
## Dự án: Catalogue AI (Dictionary)

> [!NOTE]
> File này dùng để bám sát tiến độ từng bước theo đúng Hiến pháp Agent (`agent.md`). Mỗi task chỉ được đánh dấu hoàn thành `[x]` sau khi đã code xong, chạy unit test thành công và cập nhật bộ nhớ trạng thái `state.json`.

---

### BẢNG THEO DÕI TIẾN ĐỘ TỔNG THỂ

- [x] **Task 0: Khởi tạo Hiến pháp, RAM State và Checklist**
  - [x] Tạo `agent.md` & `AGENTS.md` (Hiến pháp Agent: Quy tắc CẤM KỴ & PHẢI LÀM).
  - [x] Tạo `state.json` (Bộ nhớ RAM ghi nhận tiến trình, khôi phục phiên trong 5s).
  - [x] Tạo `plan.md` (Checklist chi tiết từng task).
  - [x] Cấu hình đồng bộ vào thư mục `.agents/` tương thích agy CLI.

- [x] **Task 1: Sửa lỗi mở cổng 2FA cho user mới "trinh"**
  - [x] Mở rộng TOTP verify window từ `window = 1` lên `window = 2` (±60s) trong `functions/_lib/gatekeeper.js` & `verify-otp.js`.
  - [x] Thêm bộ lọc chuẩn hóa Base32 (xóa khoảng trắng, tự sửa ký tự nhầm lẫn phổ biến `0->O`, `1->I`).
  - [x] Hỗ trợ tìm user theo cả username thuần ("trinh") và email ảo ("trinh@users.catalogue.vn").
  - [x] Tích hợp tính năng tạo mã QR SVG trực tiếp trong Admin UI (`index.html` & `src/app.js`) khi tạo user hoặc xem 2FA để quét trực tiếp bằng Microsoft Authenticator (tránh lỗi gõ tay 32 ký tự).
  - [x] Chuẩn hóa reload mở cổng trong `gatekeeper.js` dùng `window.location.replace('/')`.
  - [x] Chạy unit test xác thực `tests/gatekeeper.test.js` & `tests/auth-api.test.js` (100% pass).
  - [x] Cập nhật `state.json` và đánh dấu checklist.

- [x] **Task 2: Sửa lỗi Checkbox chọn hàng loạt & Khắc phục lỗi reset về Trang 1**
  - [x] Loại bỏ `content-visibility: auto` và `contain-intrinsic-size` trên `.catalog-card` trong `index.html` để triệt tiêu lỗi ảo hóa DOM và miss sự kiện click/render.
  - [x] Chuyển đổi icon check sang declarative inline SVG, đảm bảo card được đánh dấu amber ring và checkmark ngay lập tức, đồng bộ 100% với số lượng trên thanh tham số nổi.
  - [x] Chuẩn hóa string ID trong `isPartSelected` và `togglePartSelection`.
  - [x] Sửa các hàm `executeBulkDelete`, `deleteCurrentPart`, `savePart`: giữ nguyên `this.page` hiện tại (`loadParts(false)`) thay vì ép về trang 0 (chỉ lùi 1 trang nếu trang hiện tại bị xóa trống).
  - [x] Chạy unit test xác thực `tests/catalogue-delete.test.js` & `tests/frontend.test.js` (100% pass).
  - [x] Cập nhật `state.json` và đánh dấu checklist.

- [x] **Task 3: Dời các mục hướng dẫn trong ô chứa ảnh (image.png) lên header**
  - [x] Tìm vị trí 3 badge hướng dẫn `[wcImgTabLabel]`, `[Zoom ...x]`, `[Cuộn để phóng to · kéo để di chuyển]` trong `index.html` (dòng 1316-1320).
  - [x] Dời các badge này lên thanh header cạnh tiêu đề "Ảnh Catalogue Linh Kiện {{ weightCalc.selected.code }}" (dòng 1255).
  - [x] Kiểm tra layout đảm bảo khung nhìn ảnh hoàn toàn thông thoáng, không còn bất kỳ chi tiết nào bị che khuất.
  - [x] Chạy unit test kiểm tra `tests/frontend.test.js` (100% pass).
  - [x] Cập nhật `state.json` và đánh dấu checklist.

- [x] **Task 4: Tự động trỏ thẳng và mở chi tiết mã hàng ngay khi nhấp kết quả Moris**
  - [x] Nâng `z-index` của `.detail-overlay` lên `z-[95]` (trên mức `z-80` của Moris).
  - [x] Cập nhật hàm `openMorisCandidate(candidate)` trong `src/app.js`: chủ động đóng panel Moris (`this.closeMoris()`) và mở thẳng `openDetail(candidate)`.
  - [x] Đảm bảo khi nhấp vào kết quả, người dùng được xem trực tiếp ngay lập tức hình ảnh, thông số kỹ thuật và 3D pan/zoom của mã hàng mà không bị che khuất.
  - [x] Chạy unit test xác thực `tests/frontend.test.js` (100% pass).
  - [x] Cập nhật `state.json` và đánh dấu checklist.

- [x] **Task 5: Đồng bộ tên hiển thị "Vinh" cho user pquangvinh1999@gmail.com**
  - [x] Cập nhật database: set `profiles.username = 'Vinh'` cho user `pquangvinh1999@gmail.com` (UUID `8d091a3a-d7ed-482a-aff9-efef01a4ba9a`).
  - [x] Cập nhật `isSystemAdminEmail` trong `functions/_lib/auth.js` nhận diện cả `vinh`, `pquangvinh1999` và `pquangvinh1999@gmail.com`.
  - [x] Đồng bộ frontend `isSystemAdmin` và hiển thị trong `index.html`, `src/app.js`, đảm bảo mọi nơi đều hiển thị "Vinh".
  - [x] Chạy unit test xác thực `tests/auth-api.test.js` (100% pass).
  - [x] Cập nhật `state.json` và đánh dấu checklist.

- [x] **Task 6: Review và nghiên cứu giải pháp tối ưu kiến trúc 3 lớp Moris đạt độ chính xác >= 80% (dữ liệu thật)**
  - [x] Rà soát toàn diện Lớp 1 (DINOv2 coarse embedding), Lớp 2 (Metadata & Structural Evidence), Lớp 3 (Geometric Re-ranking).
  - [x] Khảo sát thực tế trên 122 mã hiện có trong database (`catalogue_image_vectors` có 244 hàng với `hole_count`, `aspect_ratio`, `hole_centroids` đầy đủ 100%).
  - [x] Chạy thử nghiệm đối sánh thực nghiệm trên toàn bộ 122 cặp ảnh thực tế (kết quả đạt Top 1: 99.2%, Top 5: 100%, Top 10: 100% với ảnh chuẩn; và Top 5: 100%, Top 10: 100% khi mô phỏng nhiễu góc chụp điện thoại).
  - [x] Xác định nguyên nhân gốc rễ: Server trước đây bỏ qua `hole_centroids` & `aspect_ratio`, chỉ phạt cứng nhị phân khi lệch 1 lỗ khiến mã chuẩn bị đẩy xuống Top 5.
  - [x] Tích hợp `geometricReranker` vào `functions/_lib/moris/v5/orchestrator.js` hỗ trợ so khớp tâm lỗ (centroid Euclidean distance), xoay lật gương (Mirror Invariant) và tỷ lệ khung hình.
  - [x] Lập báo cáo chuyên sâu trung thực, không bịa đặt số liệu theo đúng hiến pháp.
  - [x] Cập nhật `state.json` và đánh dấu checklist hoàn tất.

- [x] **Task 7: Lọc chuẩn xác đặc điểm nhận dạng ở Chatbox Moris theo cặp Số + Chữ, loại bỏ nhồi nhét Top 10**
  - [x] Xây dựng thuật toán phân tích và khớp đặc điểm nhận dạng (`featureMatcher`):
    - Trích xuất key số và key chữ từ query (ví dụ: "6 lỗ tròn" -> số `6`, chữ `"lỗ tròn"`).
    - Phân tách `identifying_features` trong catalogue theo dấu phẩy `,` (ví dụ: "6 lỗ tròn, 2 Lỗ vuông, 4 Lỗ oval, 3 lỗ tam giác").
    - So khớp chính xác: số query phải bằng đúng số trong phân đoạn (6 không khớp 16 hay 60); chữ phải khớp đúng loại (lỗ tròn không khớp lỗ vuông).
    - Không phân biệt hoa thường (case-insensitive: "4 lỗ oval" khớp "4 Lỗ oval").
  - [x] Sửa `functions/api/moris/chat.js`: khi tìm theo đặc điểm nhận dạng, CHỈ trả về các mã có kết quả là `TRUE`, tuyệt đối KHÔNG fallback lấy 15 mã từ catalogue (`pool.slice(0, 15)`). Nếu 1 mã true thì trả về đúng 1 mã.
  - [x] Viết unit test xác thực kiểm thử case "6 lỗ tròn" vs "16 lỗ tròn", hoa thường, và không trả về top 10 rác (`tests/moris-features-filter.test.js` 18 tests pass).
  - [x] Cập nhật `state.json` và đánh dấu checklist.

- [x] **Task 8: Tối ưu tìm kiếm bằng hình ảnh tải từ ngoài vào và đồng bộ kiến trúc 3 lớp Moris**
  - [x] Bổ sung nút "Tải ảnh từ máy" trong Modal Camera Moris để người dùng linh hoạt chuyển đổi khi gặp linh kiện to và dài.
  - [x] Đảm bảo khi gửi ảnh từ máy (file upload) vào Moris, ảnh được giữ nguyên tỉ lệ gốc, chạy qua DINOv2 + PCA + Hole Topology trích xuất đầy đủ `geometry: { hole_count, aspect_ratio, hole_centroids }`.
  - [x] Tinh chỉnh điều kiện áp dụng Lớp 3 `geometricReranker` trong `orchestrator.js` hỗ trợ linh kiện dài dựa trên `aspect_ratio` ngay cả khi số lỗ bằng 0 hoặc rỗng.
  - [x] Viết unit test xác thực luồng xử lý và đồng bộ 3 lớp (`tests/moris-reranker.test.js` pass).
  - [x] Cập nhật `state.json` và đánh dấu checklist.

- [x] **Task 9: Bổ sung Hiến pháp Agent (agent.md / AGENTS.md)**
  - [x] Bổ sung điều khoản 5 vào mục I. CÁC ĐIỀU CẤM KỴ: Cấm tự ý làm khi chưa hiểu rõ hoặc thiếu thông tin, phải hỏi lại người dùng.
  - [x] Đồng bộ vào `AGENTS.md`, `agent.md`, `.agents/agent.md`.

- [x] **Task 10: Sắp xếp danh sách kết quả Top 10 của Moris theo tỷ lệ lớn trở xuống**
  - [x] Cập nhật `geometricReranker.js`: gán `final_score` và `match_score` bằng `geo.final_score` để candidate lưu giữ điểm số sau khi re-rank.
  - [x] Cập nhật `orchestrator.js` và `candidatePool.js`: sắp xếp danh sách ứng viên theo điểm số cuối cùng giảm dần (descending).
  - [x] Cập nhật `publicResult.js`: đảm bảo danh sách `candidates` và câu trả lời text trong `buildMorisUserMessage` luôn được sắp xếp từ tỷ lệ lớn trở xuống.
  - [x] Cập nhật `src/app.js` (`applyMorisSearchResults`): sắp xếp mảng candidates theo `morisCandidatePercent(c)` giảm dần, đảm bảo mã đạt 68% (3465490001) đứng ở Top 1 thay vì Top 3.
  - [x] Chạy unit test kiểm thử (`tests/moris-reranker.test.js` pass 100%, toàn bộ suite 167 tests pass) và cập nhật `state.json`.

- [x] **Task 11: Đồng bộ xóa sạch toàn bộ dữ liệu Vector AI khi xóa ảnh/mã ở main chính**
  - [x] Khảo sát cơ sở dữ liệu: phát hiện 2 vector mồ côi (orphan) của mã 104342 trong `catalogue_image_vectors` bị tồn đọng do `record_id` kiểu text không kích hoạt FK cascade và RPC cũ không gọi xóa vector.
  - [x] Dọn dẹp thực tế: trực tiếp xóa 2 vector mồ côi đưa số lượng vector về 247 vectors / 123 linh kiện trong database Supabase thực tế.
  - [x] Tạo endpoint `functions/api/catalogue/delete-part.js`: xóa đơn lẻ mã linh kiện và đồng thời xóa triệt để toàn bộ vector liên quan trong `catalogue_image_vectors` qua Supabase Service Role.
  - [x] Cập nhật `functions/api/catalogue/bulk-delete.js`: khi admin xóa hàng loạt, tự động batch DELETE toàn bộ vector liên quan trong `catalogue_image_vectors`.
  - [x] Cập nhật `functions/api/catalogue/delete-all.js`: xóa sạch bảng `catalogue_image_vectors` qua Service Role khi xóa tất cả.
  - [x] Cập nhật `src/app.js`:
    - `deleteCurrentPart()`: gọi `/api/catalogue/delete-part` đồng bộ xóa bản ghi lẫn vector AI, dọn dẹp job trong hàng đợi local (`removeMorisVectorJob`).
    - `executeBulkDelete()`: sau khi xóa xong, dọn dẹp toàn bộ job các mã đã chọn trong hàng đợi local (`removeMorisVectorJobs`).
    - `executeDeleteAll()`: dọn sạch hàng đợi vector local (`clearAllMorisVectorJobs`).
  - [x] Tạo migration `supabase/migrations/2026101200020000_cascade_delete_vectors_on_part_delete.sql` cập nhật các RPC `app_delete_part`, `app_bulk_delete_parts` và trigger `trg_kim_cleanup_vectors_on_delete`.
  - [x] Viết unit tests kiểm thử toàn diện `tests/catalogue-delete.test.js` (12 tests pass 100%).
  - [x] Chạy toàn bộ test suite (`npm test`: 173/173 tests pass 100%) và build static (`npm run build`).
  - [x] Cập nhật bộ nhớ RAM `state.json` và checklist `plan.md`.

- [x] **Task 12: Tối ưu chuẩn xác logic tìm kiếm đặc điểm nhận dạng ở Main Catalogue & Chatbox Moris và Bỏ modal Xóa tất cả ở main chính**
  - [x] Bỏ nút và modal "Xóa tất cả" ở giao diện main chính (`index.html`).
  - [x] Nâng cấp thuật toán bóc tách và so khớp đặc điểm nhận dạng (`functions/_lib/moris/v5/retrieval/featureMatcher.js`):
    - Phân tách theo dấu phẩy `,` thành các phân đoạn độc lập.
    - Bóc tách trong từng phân đoạn thành cặp Key Số ("2") và Key Chữ ("lỗ tròn").
    - Ranh giới số nghiêm ngặt: số 2 chỉ lọc đúng 2 (tuyệt đối không lọc 20, 22, 12).
    - Loại hình dáng nghiêm ngặt: "lỗ tròn" chỉ lọc đúng lỗ tròn (tuyệt đối không lọc lỗ vuông, oval).
    - Hỗ trợ so khớp nhiều đặc điểm kết hợp ngăn cách bởi dấu phẩy (AND logic).
  - [x] Đồng bộ logic tìm kiếm đặc điểm nhận dạng vào Thanh tìm kiếm ở Main Catalogue Linh Kiện (`src/app.js`):
    - Nhận diện query đặc điểm nhận dạng trên thanh tìm kiếm main.
    - Lọc nghiêm ngặt theo cặp Số + Chữ, loại bỏ triệt để mã 22 lỗ tròn, 20 lỗ tròn, 12 lỗ tròn khi tìm 2 lỗ tròn.
  - [x] Đồng bộ vào Chatbox Moris (`functions/api/moris/chat.js` & `functions/_lib/moris/v5/orchestrator.js`):
    - Đảm bảo quét đầy đủ danh mục khi lọc đặc điểm nhận dạng.
    - Tích hợp featureMatcher vào cả chat RAG lẫn orchestrator search fallback.
  - [x] Tạo migration PostgreSQL `supabase/migrations/2026101300010000_strict_feature_search_catalogue.sql` cập nhật RPC `app_search_catalogue` hỗ trợ word boundary số và phân tách dấu phẩy (đã thực thi thành công lên Supabase).
  - [x] Viết bộ unit test toàn diện cho các case 2 lỗ tròn vs 22 lỗ tròn vs 20 lỗ tròn, lỗ vuông, lỗ oval, dấu phẩy và kiểm tra giao diện.
  - [x] Chạy toàn bộ unit test (`npm test`: 182/182 tests pass 100%), build static (`npm run build`), cập nhật `state.json` và đánh dấu `plan.md`.




