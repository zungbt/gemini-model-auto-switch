# Gemini Model Auto-Switch (extension cho Waterfox)

Extension WebExtension (manifest MV3) cho Waterfox 6.x / Firefox: khi tải `https://gemini.google.com/app`, nó tự mở menu model và chọn đúng model + mức tư duy bạn đã ghim trong popup. Cần Waterfox 6 hoặc Firefox 127 trở lên. Cài xong phải mở popup, chọn model rồi bấm **Lưu**: chưa chọn thì extension không làm gì.

## Cài đặt (dành cho người dùng)

Không cần biết lập trình. Mất khoảng một phút.

1. **Tải file về:** vào trang [Releases](https://github.com/zungbt/gemini-model-auto-switch/releases/latest) và bấm vào file có đuôi `.xpi` (ví dụ `gemini-model-auto-switch-1.3.0.xpi`).
2. **Cài vào Waterfox:** mở Waterfox rồi **kéo file `.xpi` vừa tải thả vào cửa sổ trình duyệt**. Khi hiện hộp thoại hỏi, bấm **Thêm** (Add).
   - Cách khác: gõ `about:addons` vào thanh địa chỉ → bấm biểu tượng bánh răng ⚙ → **Install Add-on From File…** → chọn file `.xpi`.
3. **Chọn model:** mở [gemini.google.com](https://gemini.google.com/app), bấm biểu tượng extension trên thanh công cụ, chọn model (và mức tư duy nếu muốn) rồi bấm **Lưu**.

Từ lần sau, mỗi lần mở Gemini extension tự chọn đúng model bạn đã lưu. Muốn đổi thì mở lại popup.

Trên Gemini bản sidebar AI của Waterfox (mở từ menu thanh bên) cũng dùng được y như vậy.

**Firefox thường thì sao?** Firefox bản chính thức chỉ cho cài add-on đã được Mozilla ký, mà bản này chưa ký, nên có thể báo “add-on không được xác minh”. Dùng Waterfox thì không bị chặn. Firefox Developer Edition, Nightly và ESR cũng cài được sau khi đặt `xpinstall.signatures.required` thành `false` trong `about:config`.

**Gỡ cài đặt:** `about:addons` → Extensions → ⋯ cạnh “Gemini Model Auto-Switch” → Remove.

## Cho người phát triển

**Chạy thử tạm thời (mất khi khởi động lại trình duyệt):** mở `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → chọn `manifest.json` trong repo.

**Đóng gói `.xpi`:**

```bash
node build.mjs     # cần Node >= 22.2, ra dist/gemini-model-auto-switch-<version>.xpi
```

Chỉ đóng gói các file extension thật sự dùng (không kèm README, `build.mjs`, v.v.). Đừng dùng `Compress-Archive` của PowerShell 5.1: nó ghi đường dẫn bằng `\` và Firefox coi gói là hỏng.

**Bản đã ký cho Firefox thường:** nộp `.xpi` lên https://addons.mozilla.org/developers/ với kênh **On your own** (unlisted) để nhận file đã ký, hoặc đăng công khai lên addons.mozilla.org để người dùng cài bằng một cú bấm.

**Phát hành:** tăng `version` trong `manifest.json`, chạy `node build.mjs`, rồi đính kèm file trong `dist/` vào một GitHub Release.

## Dùng

Bấm icon extension trên toolbar:

| Mục | Ý nghĩa |
|---|---|
| Tự động chuyển model | Bật/tắt toàn bộ hành vi tự động |
| Model | Danh sách model lấy từ menu của Gemini (đúng ngôn ngữ và tài khoản của bạn) |
| Mức tư duy | Các mức trong menu con “Cấp độ tư duy” của model đang dùng; hoặc “Giữ nguyên” |
| Lấy danh sách từ Gemini | Mở menu trên tab Gemini, đọc model và mức rồi đóng lại. Tự chạy lần đầu mở popup |
| Ghi log ra console | In tiến trình ra DevTools console của trang (F12) |
| Lưu | Ghi cài đặt; content script áp dụng ngay trên tab đang mở |
| Chọn ngay | Bắt buộc thử lại một lần, kể cả khi bạn vừa bấm gì đó trên trang |

## Chọn model và mức (không phụ thuộc ngôn ngữ)

Model được chọn theo `data-mode-id` của Gemini, không so chữ, nên đổi ngôn ngữ giao diện vẫn chạy. Mức tư duy được chọn theo *vị trí* của mục trong menu con (các mục này không có ID), nên nếu Google đổi thứ tự hoặc thêm bớt mức thì cần chọn lại. Danh sách mức là của model đang dùng trên Gemini; model không có menu con thì bỏ qua mức. Chọn “Giữ nguyên mức hiện tại” nếu không muốn add-on đụng tới mức.

Model đã lưu mà menu hiện tại không còn thì popup vẫn giữ nó trong danh sách (ghi “đã lưu, không thấy trong menu hiện tại”), nên bấm Lưu không làm mất lựa chọn.

## Sidebar AI của Firefox/Waterfox

Extension chạy cả trong sidebar **AI chatbot** (khung `gemini.google.com` hẹp ~470px). Ở bề rộng hẹp Gemini đổi giao diện: nút chọn model nằm trên thanh tiêu đề và các mức tư duy nằm sẵn trong cùng menu thay vì submenu; extension xử lý cả hai kiểu. Sidebar không phải tab nên popup không gửi tin trực tiếp được; khi tab đang xem không có script Gemini, popup đăng lệnh vào `storage` (`cmd`) và script trong sidebar trả lời ở `cmdResult`. Nhờ vậy "Lấy danh sách", "Lưu" và "Chọn ngay" dùng được khi Gemini chỉ mở trong sidebar. Nếu vẫn không kết nối được, popup hiện ghi chú lần chạy gần nhất của script (bề rộng, nút model, lỗi).

## Không làm phiền

- **Nhớ lần trước (chỉ khi để “Giữ nguyên mức”):** sau khi chọn xong, add-on nhớ chữ hiện trên nút chọn model (ví dụ "Flash Cao"). Lần sau mở Gemini mà thấy đúng chữ đó thì nó không mở menu nữa. Khi bạn ghim cả mức tư duy thì không dùng lối tắt này, vì nút không cho thấy mức (ở sidebar chỉ ghi "Gemini Flash"); nó mở menu một lần mỗi lần tải trang để kiểm tra thật. Hai model hiện cùng một chữ trên nút thì không phân biệt được; bấm **Chọn ngay** để ép kiểm tra.
- **Giấu menu:** khi buộc phải mở menu, `quiet.css` làm menu không hiện ra (menu vẫn nhận thao tác của add-on bình thường), nên bạn không thấy nó nháy.
- Xong thì bỏ focus khỏi nút chọn model để Gemini không hiện tooltip "Chuyển đổi mô hình".

## Cách nó hoạt động

- Content script chạy trên `gemini.google.com`, tìm nút chọn model: ưu tiên `button.input-area-switch` (nút có nhãn “Mở công cụ chọn chế độ, hiện tại là Flash”), sau đó tới `aria-label` chứa “chế độ”/“model”/“mô hình”, cuối cùng là nút có chữ như “Flash”, “Pro”, “Thinking” và có `aria-haspopup`.
- Nó bấm mở menu, tìm mục có đúng `data-mode-id` đã ghim trong overlay (`.cdk-overlay-pane`, `[role="menu"]`, …). Mục đó đã có dấu `.selected` thì không bấm lại, chỉ chỉnh mức tư duy nếu cần.
- Sau khi bấm model, nó chỉ coi là xong khi mục được đánh dấu `.selected` hoặc menu đã đóng; sau đó chỉnh mức tư duy (nếu có ghim).
- Đóng menu bằng `Esc` chỉ khi menu còn mở. Nếu sau 0,5 s nút vẫn báo menu đang mở thì mới bấm lại nút để đóng.
- Nếu chưa tìm thấy nút/mục, nó thử lại mỗi 1,5 s; tổng cộng tối đa 15 lần (kể cả những lần bị hoãn vì bạn đang thao tác), và thất bại kiểu “không thấy model / chưa xác nhận / không thấy mức” thì dừng sau 3 lần.
- **Chạy một lần mỗi lần tải trang:** nó chờ đến khi nút chọn model xuất hiện rồi chọn ngay, sau đó đứng yên (không có vòng lặp hay theo dõi nào). Nó chỉ làm lại khi bạn bấm **Chọn ngay** / **Lưu** trong popup, hoặc đổi cài đặt. Chuyển sang hội thoại khác trong cùng trang không tự chọn lại; tải lại trang hoặc bấm **Chọn ngay**.
- Các yêu cầu không chạy chồng lên nhau: yêu cầu đến sau chờ yêu cầu trước xong (tối đa 30 s) rồi mới chạy.
- Không giành quyền với bạn: nếu bạn vừa bấm/gõ trong 3 giây, nó bỏ qua lượt đó (chỉ tính thao tác thật của bạn, không tính cú bấm do chính add-on tạo ra).

## Khi không chuyển được

Bấm **Lấy danh sách từ Gemini** để đọc lại menu, chọn model và mức rồi bấm **Lưu** / **Chọn ngay**.

Nếu vẫn không được, bật **Ghi log ra console** và xem log `[gemini-model-switch]` trong DevTools của tab Gemini.

## Cấu trúc

| File | Nội dung |
|---|---|
| `manifest.json` | Khai báo MV3, quyền `storage` + `activeTab`, content script cho `gemini.google.com` |
| `quiet.css` | Giấu menu model trong lúc add-on thao tác |
| `content.js` | Toàn bộ logic tìm nút/menu, chọn model theo ID, chỉnh mức, bấm và xác nhận |
| `popup.html` / `popup.js` | Giao diện cấu hình và trạng thái |
| `icon.svg` | Icon extension và nút trên toolbar |
| `build.mjs` | Đóng gói `dist/*.xpi` (không phụ thuộc thư viện ngoài) |
