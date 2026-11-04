# Hỗ trợ Microsoft Edge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extension chạy được trên Edge (tab Gemini và Gemini ghim ở sidebar Edge) từ cùng một mã nguồn với bản Waterfox, cài bằng Load unpacked hoặc file `.zip`.

**Architecture:** Giữ một bộ file, một `manifest.json` cho cả Firefox/Waterfox và Edge (Chromium bỏ qua `browser_specific_settings`, chỉ cảnh báo). Sửa đúng ba chỗ Chromium khác Firefox: cách trả lời `runtime.onMessage`, icon (Chromium không đọc SVG), và gói `.zip`. Kiểm chứng bằng một script smoke test Node, không dependency, điều khiển Edge qua Chrome DevTools Protocol (CDP).

**Tech Stack:** WebExtensions MV3, JavaScript thuần, Node ≥ 22.4 (cần `WebSocket` toàn cục; máy đang có Node 24.14), Edge 156 (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`).

**Spec:** không có file spec riêng. Các quyết định lấy từ hội thoại ngày 2026-11-04:
- Phạm vi: chạy cả trong **tab** lẫn **sidebar Edge**. Nếu Edge không cho content script chạy trong sidebar thì **báo lại, không cố lách**.
- Phát hành: **Load unpacked**, và `build.mjs` xuất thêm **`.zip`**.
- Giữ thay đổi chưa commit trong `content.js` (chạy lại khi trang hiện ra hoặc được focus), commit nó làm nền.

## Đã kiểm chứng trước khi viết plan

- Edge 156 **vẫn nhận** `--load-extension=<dir>`. Đã chạy với profile tạm: extension có trong `Secure Preferences`, `location 8` (command line), không bị disable.
- Gemini khi chưa đăng nhập vẫn có nút chọn model. Chỉ model "3.5 Flash-Lite" có `data-mode-id`, nên với profile test chỉ chạy được đường "model đã đúng sẵn". Đường bấm đổi model đã được chứng minh trên Waterfox với tài khoản thật.
- Waterfox, giao diện tiếng Anh, rộng 434px: selector `[data-test-id*="mode" i]` trúng thẻ bọc `BARD-MODE-SWITCHER`. Bấm vào đó không mở menu, dẫn tới `no-item` ×3. Tiếng Việt không bị vì `button[aria-label*="chế độ" i]` đứng trước. Xem Task 4.

## Global Constraints

- Không thêm dependency, không `package.json`. Build: `node build.mjs` (Node ≥ 22.2). Test: `node test/edge-smoke.mjs` (Node ≥ 22.4).
- Một `manifest.json` cho mọi trình duyệt. Giữ nguyên `browser_specific_settings.gecko` (id `gemini-model-switch@pixel3d.local`, `strict_min_version` `127.0`).
- Chuỗi hiển thị cho người dùng bằng tiếng Việt, comment trong code bằng tiếng Anh, đúng như code hiện có.
- Smoke test **không bao giờ** dùng profile Edge thật của người dùng. Luôn dùng `--user-data-dir=%TEMP%\gms-edge-<lang>`.
- `build.mjs` chỉ đóng gói những file mà manifest/popup tham chiếu. File test và `docs/` không được lọt vào gói.
- Sửa tối thiểu: không refactor `content.js`/`popup.js` ngoài những dòng task chỉ ra.

## Review Focus

1. **Sidebar Edge hẹp + giao diện không phải tiếng Việt:** picker trúng thẻ bọc → `no-item` ×3 → bỏ cuộc. Người dùng mong model vẫn được chọn. Test: Task 4, `--lang=en --width=430` cho ra `seen.reason === 'ok'`.
2. **Popup mở khi Gemini nằm ở sidebar Edge, không phải tab:** `tabs.sendMessage` thất bại, popup phải đi đường storage. Người dùng mong popup vẫn hiện "Hiện tại: …". Test: Task 5, check `storage-cmd`.
3. **Popup mở trên tab Gemini trong Edge:** nếu Chromium không nhận Promise trả về từ `onMessage`, popup sẽ báo "Không kết nối được". Test: Task 2, check `message-status`.
4. **Icon trên thanh công cụ Edge:** SVG không hiển thị, người dùng sẽ thấy chữ cái mặc định. Test: Task 3, check `icons`, cộng với một lần nhìn tận mắt.
5. **Waterfox không được hỏng** sau khi đổi `onMessage` và icon. Test: Task 2 và Task 3, kiểm tra thủ công trên Waterfox (bước có ghi rõ).

---

### Task 0: Commit nền

**Files:** Modify: `content.js` (đã sửa sẵn, chưa commit)

- [ ] **Step 1:** Tạo branch và commit thay đổi đang có.

```bash
git checkout -b feat/edge-support
git add content.js docs/superpowers/plans/2026-11-04-edge-support.md
git commit -m "fix: retry the pinned model when the page is shown or focused again"
```

Expected: `git status --short` rỗng.

---

### Task 1: Smoke test Edge qua CDP

**Files:**
- Create: `test/edge-smoke.mjs`

**Interfaces:**
- Produces: CLI `node test/edge-smoke.mjs [--ext=<dir>] [--lang=vi|en] [--width=<px>] [--fresh] [--sidebar] [--keep-open]`. `--ext` mặc định là thư mục gốc repo. `--sidebar` thêm ở Task 5. In mỗi check một dòng `PASS <name>` hoặc `FAIL <name>: <chi tiết>`. Exit code 0 khi mọi check đã chạy đều PASS. Các task sau thêm check vào file này, theo tên: `injected`, `list-options`, `auto-select` (task này), `message-status` (Task 2), `icons` (Task 3), `sidebar-injected` và `storage-cmd` (Task 5).
- Helper nội bộ dùng chung cho các task sau:
  - `evalIn(sessionId, contextId, expression) -> Promise<any>`: gọi `Runtime.evaluate` với `awaitPromise: true, returnByValue: true`, ném lỗi khi có `exceptionDetails`.
  - `contentContext(sessionId) -> Promise<number>`: đợi tối đa 20 giây.
  - `openExtensionPage(path) -> Promise<{sessionId, contextId}>`: mở `chrome-extension://<id>/<path>` thành tab mới, lấy main context của trang. Dùng ở Task 2, 3, 5.
  - `checkAutoSelect(sessionId) -> Promise<void>`: logic của check `auto-select` bên dưới. Task 5 dùng lại cho target sidebar.
- Mỗi check bọc `try/catch`. Exception thì in `FAIL <name>: <message>` rồi chạy tiếp, không làm harness chết.
- Thứ tự cố định: `injected` → `list-options` → `auto-select` (lúc này tab Gemini vẫn ở trước, không bị Chromium hãm timer như tab nền) → các check cần trang extension.
- Khi thoát: gửi `Browser.close` qua CDP. Nếu sau 5 giây chưa tắt thì kill PID đã spawn.
- Edge sẽ báo cảnh báo "Unrecognized manifest key 'browser_specific_settings'" trong `edge://extensions`. Đó là cảnh báo bình thường, không phải lỗi, đừng sửa manifest vì nó.

Cách chạy Edge: `msedge.exe --user-data-dir=%TEMP%\gms-edge-<lang> --no-first-run --no-default-browser-check --lang=<lang> --window-size=1400,900 --remote-debugging-port=9333 --load-extension=<--ext> about:blank`.
- `--fresh`: xóa thư mục profile trước khi chạy.
- `--keep-open`: không đóng Edge khi xong.
- Mặc định: `--lang=vi`, không emulation chiều rộng.

Trình tự CDP. Đây là phần implementer không tự suy ra được:
1. Poll `GET http://127.0.0.1:9333/json/version` (tối đa 15 giây) để lấy `webSocketDebuggerUrl`, rồi mở một `WebSocket` tới browser.
2. `Target.createTarget {url: "about:blank"}`, sau đó `Target.attachToTarget {targetId, flatten: true}` để lấy `sessionId`. Mọi lệnh tới trang đều kèm `sessionId`.
3. `Runtime.enable`, `Page.enable`. Nếu có `--width`: `Emulation.setDeviceMetricsOverride {width, height: 900, deviceScaleFactor: 0, mobile: false}`. Không dùng `--window-size` để thu hẹp, vì cửa sổ Edge có chiều rộng tối thiểu và có thể không xuống được 430px. Sau đó `Page.navigate {url: "https://gemini.google.com/app"}`. Emulation phải đặt trước khi tải trang, để content script ghi đúng `seen.width`.
4. Từ các event `Runtime.executionContextCreated`, lấy context của content script: `context.auxData.type === "isolated"` và `context.name === "Gemini Model Auto-Switch"`. Extension id là phần host của `context.origin` (`chrome-extension://<id>`).
5. Trong isolated world có sẵn `chrome.*` **và** các hàm top-level của `content.js` (`listOptions`, `state`…), vì content script là classic script. Step 2 kiểm chứng điều này. Nếu sai, dừng lại và báo, không đoán.

- [ ] **Step 1: Viết harness với ba check**
  - `injected`: tìm được context ở bước 4 trong vòng 20 giây.
  - `list-options`: `await listOptions()` trả về `ok === true` và có ít nhất 1 model có `id` khác rỗng.
  - `auto-select` (`checkAutoSelect`). Phải đúng thứ tự sau, vì ghi settings sẽ làm trang hiện tại tự chạy ngay (`content.js` listener `storage.onChanged`, nhánh `scheduleAuto(0)`), rồi ghi `applied` (`rememberApplied`). Nếu không xóa `applied`, lần tải sau sẽ trả `ok` chỉ nhờ so khớp chữ (`state.settings.applied === appliedKey(picker)`) mà không mở menu.
    1. `set({enabled: true, modeId: <id đầu tiên khác rỗng>, target: <label>, levelIndex: -1})`.
    2. Đợi 5 giây cho lần chạy trên trang cũ xong.
    3. `set({applied: '', seen: null})`, ghi lại `t = Date.now()` trong trang (đồng hồ của trình duyệt).
    4. `Page.reload`, đợi context mới.
    5. Poll `chrome.storage.local.get('seen')` tối đa 20 giây.

    PASS khi `seen.reason === 'ok'` **và** `seen.at > t`, nghĩa là bản ghi đến từ trang mới chứ không phải trang cũ ghi muộn. FAIL thì in cả `seen`.

- [ ] **Step 2: Chạy**

Run: `node test/edge-smoke.mjs --fresh`
Expected: `PASS injected`, `PASS list-options`, `PASS auto-select`, exit 0.
Nếu `injected` PASS mà `list-options` báo `listOptions is not defined` thì giả định ở bước 5 sai. Dừng và báo.

- [ ] **Step 3: Kiểm tra gói không lẫn file test**

Run: `node build.mjs`
Expected: danh sách file in ra không có `test/edge-smoke.mjs`.

- [ ] **Step 4: Commit**

```bash
git add test/edge-smoke.mjs
git commit -m "test: Edge smoke test over the DevTools protocol"
```

---

### Task 2: `runtime.onMessage` trả lời được trên cả Chromium

**Files:**
- Modify: `content.js`, dòng `api.runtime.onMessage.addListener((message) => handleCommand(message?.type));` (trong `init()`)
- Test: `test/edge-smoke.mjs`

- [ ] **Step 1: Thêm check `message-status`.** `openExtensionPage('popup.html')`. Trong context đó, evaluate:
  `chrome.tabs.query({url: 'https://gemini.google.com/*'}).then(([t]) => chrome.tabs.sendMessage(t.id, {type: 'status'}))`.
  PASS khi kết quả là object có key `enabled` (kiểu boolean).
  (Lúc mở, `popup.js` `load()` tự gửi lệnh qua storage, vì tab đang active là chính trang popup. Tab Gemini lúc đó nằm nền, `visibilityState` là `hidden`, nên không trả lời. Popup tự bỏ sau 3 giây, không ảnh hưởng tới check.)

- [ ] **Step 2: Chạy.** `node test/edge-smoke.mjs`
  - FAIL (`sendMessage` reject với "The message port closed before a response was received", hoặc trả `undefined`): đúng như dự đoán, làm tiếp Step 3.
  - PASS (Edge 156 đã nhận Promise): ghi chú vào báo cáo, **bỏ Step 3–4**, giữ check, commit chỉ file test.

- [ ] **Step 3: Đổi listener sang dạng `sendResponse`, dùng được cho cả hai trình duyệt.** Gọi `handleCommand(message?.type)`.
  - Kết quả là `undefined`: `return` (không giữ kênh).
  - Ngược lại: `.then(sendResponse, (error) => sendResponse({ ok: false, lastError: String(error) }))` rồi `return true`.

  Phải có nhánh reject. Nếu thiếu, khi `listOptions`/`attemptSelection` ném lỗi thì `sendResponse` không bao giờ được gọi, và popup treo ở "Đang lấy danh sách…". Popup đã hiểu dạng `{ok: false, lastError}` (`fetchLists` và nút Chọn ngay).

- [ ] **Step 4: Chạy lại.** `node test/edge-smoke.mjs`. Expected: mọi check PASS.

- [ ] **Step 5: Kiểm tra Waterfox (thủ công, người dùng hoặc agent có Marionette).** Load Temporary Add-on từ repo, mở tab Gemini, bấm icon extension. Expected: popup hiện "Hiện tại: …", không phải "Không kết nối được…". Bấm **Chọn ngay**: hiện "Xong: …".

- [ ] **Step 6: Commit**

```bash
git add content.js test/edge-smoke.mjs
git commit -m "fix: answer popup messages with sendResponse so Chromium gets a reply"
```

---

### Task 3: Icon PNG

**Files:**
- Create: `icon-128.png` (render từ `icon.svg`, giữ `icon.svg` làm nguồn). Chỉ một cỡ: hình đơn giản, trình duyệt tự thu nhỏ cho toolbar. Không render 16px bằng headless vì cửa sổ headless quá nhỏ dễ ra sai kích thước.
- Modify: `manifest.json` (`icons`, `action.default_icon`)
- Test: `test/edge-smoke.mjs`

- [ ] **Step 1: Thêm check `icons`.** Trong context của `openExtensionPage('popup.html')`, evaluate `chrome.runtime.getManifest()`. PASS khi mọi giá trị trong `icons` và `action.default_icon` kết thúc bằng `.png`, và `fetch(chrome.runtime.getURL(path))` trả về `ok` với content-type `image/png`.

- [ ] **Step 2: Chạy.** Expected: `FAIL icons` (vẫn là `icon.svg`).

- [ ] **Step 3: Render PNG.**
  `msedge.exe --headless --disable-gpu --hide-scrollbars --user-data-dir=%TEMP%\gms-edge-render --default-background-color=00000000 --window-size=128,128 --screenshot=<repo>\icon-128.png <file:///%TEMP%/gms-icon.html>`.
  - `gms-icon.html` là trang tạm, không commit: `<body style="margin:0"><img src="file:///<repo>/icon.svg" width="128" height="128">`.
  - Kiểm tra kích thước: `node -e "const b=require('fs').readFileSync('icon-128.png');console.log(b.readUInt32BE(16), b.readUInt32BE(20))"` phải in `128 128`. Sai thì dừng và báo.
  - Mở PNG bằng mắt: nền trong suốt, hình không bị cắt.

- [ ] **Step 4: Sửa manifest.** `icons`: `{"128": "icon-128.png"}`. `action.default_icon`: `"icon-128.png"`.

- [ ] **Step 5: Chạy lại.** `node test/edge-smoke.mjs`. Expected: mọi check PASS.

- [ ] **Step 6: Nhìn tận mắt (người dùng).**
  - Edge: `edge://extensions`, Load unpacked repo, ghim icon. Phải thấy đúng hình ngôi sao, không phải chữ "G".
  - Waterfox: Load Temporary Add-on. Icon vẫn đúng.

- [ ] **Step 7: Commit**

```bash
git add icon-128.png manifest.json test/edge-smoke.mjs
git commit -m "feat: PNG icons, which Chromium requires"
```

---

### Task 4: Nút chọn model ở giao diện hẹp, ngôn ngữ khác tiếng Việt

> Có thể cắt task này nếu bạn chỉ dùng giao diện tiếng Việt. Nó nằm trong plan vì sidebar Edge luôn hẹp.

**Files:**
- Modify: `content.js`, mảng `PICKER_SELECTORS`
- Test: `test/edge-smoke.mjs` (không thêm check, chỉ chạy với tham số khác)

- [ ] **Step 1: Tái hiện.** `node test/edge-smoke.mjs --fresh --lang=en --width=430`. Expected: `FAIL list-options` với "Không đọc được danh sách model từ menu", vì `listOptions` dùng cùng `findModelPicker` nên bấm trúng thẻ bọc. `auto-select` cũng FAIL vì không có id để ghim (check này lấy id từ `list-options`; không có id thì in `FAIL auto-select: no model id`).
  Nếu PASS thì Edge không tái hiện lỗi đã thấy trên Waterfox: ghi chú và bỏ task này.

- [ ] **Step 2: Sửa.** Thêm `'button[aria-label*="mode picker" i]'` vào `PICKER_SELECTORS`, ngay sau `'button[aria-label*="chọn chế độ" i]'` (trước các selector `data-test-id`). Nhãn nút thật là "Open mode picker, currently …".

- [ ] **Step 3: Chạy lại cả hai ngôn ngữ.**
  - `node test/edge-smoke.mjs --lang=en --width=430`
  - `node test/edge-smoke.mjs --lang=vi`

  Expected: cả hai lần mọi check đều PASS.

- [ ] **Step 4: Commit**

```bash
git add content.js
git commit -m "fix: find the real mode picker button in the narrow layout of English Gemini"
```

---

### Task 5: Sidebar Edge (kiểm chứng trước, rồi mới hỗ trợ)

**Files:**
- Modify: `test/edge-smoke.mjs` (chế độ `--sidebar`)
- Modify: `README.md`, chỉ khi kết luận là "không chạy được"

**Interfaces:**
- Consumes: `evalIn`, `contentContext`, `openExtensionPage`, `checkAutoSelect` (Task 1). Id extension lấy từ `context.origin` của isolated context trong target sidebar.

- [ ] **Step 1: Thêm chế độ `--sidebar`.** Không mở tab Gemini, và bỏ qua các check của tab (`injected`, `list-options`, `auto-select`, `message-status`, `icons`). In ra hướng dẫn cho người dùng: "Trong cửa sổ Edge vừa mở: bật sidebar, thêm gemini.google.com làm app, mở nó." Sau đó poll `Target.getTargets` tối đa 180 giây, tìm **mọi** target (bất kể `type`) có `url` bắt đầu bằng `https://gemini.google.com`, rồi attach (`flatten: true`). Check:
  - `sidebar-injected`: tìm được isolated context của extension trong target đó.
  - `storage-cmd`: chỉ chạy khi `sidebar-injected` PASS. Kiểm tra qua chính giao diện popup, không tự ghi `cmd`. Tự ghi sẽ đua với lệnh mà `popup.js` `load()` gửi ngay khi mở, và `finish()` của popup xóa `cmd`/`cmdResult`. Cách làm: `openExtensionPage('popup.html')`, poll `document.getElementById('status').textContent` tối đa 45 giây (lớn hơn timeout 40 giây của `viaStorage`) cho tới khi khác rỗng và khác "Đang lấy danh sách từ Gemini…". PASS khi nội dung **không** bắt đầu bằng "Không kết nối được". FAIL thì in nguyên nội dung.
  - Profile `%TEMP%\gms-edge-vi` được giữ lại giữa các lần chạy, nên người dùng chỉ phải thêm app vào sidebar một lần.

- [ ] **Step 2: Chạy cùng người dùng.** `node test/edge-smoke.mjs --sidebar --keep-open`, người dùng thao tác trên cửa sổ Edge. Ghi lại `type` và `url` của target tìm thấy.

- [ ] **Step 3: Rẽ nhánh theo kết quả, không sửa code extension trong task này.**
  - **Cả hai PASS:** sidebar chạy được. Chạy thêm `checkAutoSelect(<session của target sidebar>)`, expected PASS. Id model lấy bằng `listOptions()` trong isolated context của sidebar.
  - **`sidebar-injected` FAIL** (không có target, hoặc target không có context của extension): Edge không cho content script vào sidebar. **Dừng, báo người dùng.** Thêm một dòng vào README: "Trên Edge, extension chỉ chạy trong tab Gemini, không chạy trong sidebar của Edge."
  - **`storage-cmd` FAIL nhưng `sidebar-injected` PASS:** in `document.visibilityState` của target sidebar. Đó là điều kiện để frame trả lời lệnh (`content.js`, listener `cmd`). Báo người dùng trước khi sửa.

- [ ] **Step 4: Commit**

```bash
git add test/edge-smoke.mjs README.md
git commit -m "test: check the extension inside the Edge sidebar"
```

---

### Task 6: Gói `.zip`, README, version

**Files:**
- Modify: `build.mjs` (cuối file: ghi thêm `.zip`; comment đầu file nhắc đến Edge)
- Modify: `README.md` (thêm mục cài trên Edge)
- Modify: `manifest.json` (`version`: `1.3.0` → `1.4.0`)

- [ ] **Step 1: `build.mjs` ghi cùng buffer ra hai file:** `dist/<slug>-<version>.xpi` và `dist/<slug>-<version>.zip`. In cả hai đường dẫn.

- [ ] **Step 2: Kiểm tra gói.**

Run: `node build.mjs`, rồi `tar -tf dist/gemini-model-auto-switch-1.4.0.zip`
Expected: đúng 6 file `content.js`, `icon-128.png`, `manifest.json`, `popup.html`, `popup.js`, `quiet.css`, với `manifest.json` ở gốc. Không có `icon.svg`, `test/`, `docs/`. Không đường dẫn nào chứa `\`.

- [ ] **Step 3: Cài thử từ zip.** `mkdir %TEMP%\gms-zip` rồi `tar -xf dist/gemini-model-auto-switch-1.4.0.zip -C %TEMP%\gms-zip`. Run: `node test/edge-smoke.mjs --ext=%TEMP%\gms-zip`. Expected: mọi check PASS.

- [ ] **Step 4: README.** Thêm mục `## Cài trên Edge`, cùng giọng văn với phần cài Waterfox, ba bước:
  1. Tải `.zip` ở Releases và giải nén.
  2. `edge://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư mục vừa giải nén.
  3. Mở Gemini, chọn model, bấm Lưu.

  Sửa dòng đầu README "Extension cho Waterfox / Firefox" thành "Extension cho Waterfox / Firefox / Edge". Nếu Task 5 kết luận sidebar không chạy thì giữ dòng giới hạn đã thêm ở Task 5. Thêm `node test/edge-smoke.mjs` vào mục "Cho người phát triển".

- [ ] **Step 5: Commit**

```bash
git add build.mjs README.md manifest.json
git commit -m "feat: Edge package (.zip) and install guide; 1.4.0"
```
