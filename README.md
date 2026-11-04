# Gemini Model Auto-Switch

Extension cho Waterfox / Firefox / Edge: mỗi lần mở [Gemini](https://gemini.google.com/app), tự chọn đúng model và mức tư duy bạn đã chọn. Chạy cả trong sidebar AI của Waterfox.

## Cài đặt

1. Tải file `.xpi` mới nhất ở trang [Releases](https://github.com/zungbt/gemini-model-auto-switch/releases/latest).
2. Mở Waterfox, kéo file `.xpi` thả vào cửa sổ, bấm **Thêm**.
3. Mở Gemini, bấm biểu tượng extension, chọn model (và mức tư duy), bấm **Lưu**.

Xong. Từ giờ mỗi lần mở Gemini nó tự chọn lại. Chưa chọn model ở bước 3 thì extension không làm gì.

Gỡ: `about:addons` → Extensions → Remove.

## Cài trên Edge

1. Tải file `.zip` mới nhất ở trang [Releases](https://github.com/zungbt/gemini-model-auto-switch/releases/latest) và giải nén.
2. Mở `edge://extensions`, bật **Chế độ nhà phát triển** (Developer mode), bấm **Tải tiện ích đã giải nén** (Load unpacked), chọn thư mục vừa giải nén.
3. Mở Gemini, bấm biểu tượng extension, chọn model (và mức tư duy), bấm **Lưu**.

Trên Edge, extension chạy trong tab Gemini; sidebar của Edge không được hỗ trợ. Đừng tắt Developer mode: Edge sẽ tắt luôn extension.

Cập nhật: Edge không tự cập nhật bản này. Giải nén file `.zip` mới đè lên thư mục cũ, rồi bấm **Tải lại** (Reload) ở extension trong `edge://extensions`.
Gỡ: `edge://extensions` → **Xoá** (Remove).

## Dùng

| Mục | Ý nghĩa |
|---|---|
| Tự động chuyển model | Bật/tắt |
| Model / Mức tư duy | Lấy từ menu của Gemini, đúng ngôn ngữ và tài khoản của bạn |
| Lấy danh sách từ Gemini | Đọc lại danh sách model và mức |
| Lưu | Lưu và áp dụng ngay |
| Chọn ngay | Chạy lại một lần |

Nó chỉ chạy một lần mỗi lần tải trang, rồi đứng yên. Nếu bạn đang gõ hoặc cuộn, nó đợi bạn dừng. Mở hội thoại mới trong cùng trang thì không tự chọn lại; tải lại trang hoặc bấm **Chọn ngay**.

## Không chuyển được?

Bấm **Lấy danh sách từ Gemini**, chọn lại rồi **Lưu**. Vẫn lỗi thì bật **Ghi log ra console** và xem log `[gemini-model-switch]` trong DevTools (F12) của tab Gemini.

## Cho người phát triển

- Chạy thử tạm: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → chọn `manifest.json`.
- Đóng gói: `node build.mjs` (Node ≥ 22.2) → `dist/gemini-model-auto-switch-<version>.xpi` (Firefox) và `.zip` (Edge, cùng nội dung). Đừng dùng `Compress-Archive` của PowerShell 5.1: nó ghi đường dẫn bằng `\` và Firefox coi gói là hỏng.
- Model chọn theo `data-mode-id` của Gemini (không phụ thuộc ngôn ngữ), mức tư duy theo vị trí trong menu.
- Test trên Edge: `node test/edge-smoke.mjs` (Node ≥ 22.4) mở Edge với profile tạm, nạp extension và kiểm tra qua DevTools protocol. Thêm `--lang=en --width=430` cho giao diện hẹp tiếng Anh, `--fresh` để tạo lại profile.
- `content.js` là toàn bộ logic, `popup.*` là giao diện, `quiet.css` giấu menu trong lúc extension thao tác.
