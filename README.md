# Udemy Vietsub AI

Extension Chrome: lấy phụ đề tiếng Anh gốc của bài giảng Udemy, ghép thành câu trọn vẹn, dịch sang tiếng Việt bằng DeepSeek (có ngữ cảnh cả bài) và hiển thị thay cho sub của Udemy.

## Cài đặt
1. Chrome → `chrome://extensions` → bật **Developer mode**.
2. **Load unpacked** → chọn thư mục này.
3. Bấm icon extension → **Cài đặt** → dán DeepSeek API key → Lưu.
4. Tải lại trang bài giảng Udemy. Nên tắt CC của Udemy đi (extension tự hiện sub riêng).

## Cách hoạt động
- Mở bài giảng → video tự dừng → dịch xong tự phát tiếp. Bản dịch được lưu, xem lại không tốn tiền.
- Popup → **Dịch trước cả khoá** để dịch sẵn mọi bài.
- Sửa code xong: bấm nút reload extension ở `chrome://extensions` rồi tải lại trang Udemy.
- Lỗi xem ở DevTools Console của trang Udemy (lọc `[UVS]`).

## File
- `vtt.js` — đọc WebVTT, ghép dòng thành câu.
- `content.js` — gọi API Udemy, dịch theo batch, cache, hiển thị đè lên video, dịch cả khoá.
- `background.js` — proxy tải file VTT và gọi DeepSeek.
- `popup.*`, `options.*` — giao diện.
