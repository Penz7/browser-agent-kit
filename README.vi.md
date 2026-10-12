<div align="center">

# 🧭 Browser Agent Kit

**Cho mọi AI agent điều khiển Chrome của bạn, theo đúng cách Claude in Chrome làm.**

Codex · Claude Code · Antigravity · Cursor · Gemini CLI · Windsurf · Cline / Roo / OpenCode (DeepSeek, Qwen, GLM…)

[Cài đặt](#-cài-đặt-trong-2-phút) · [Cách hoạt động](#-cách-hoạt-động) · [Tool](#-các-tool-agent-có) · [Bảo mật](#-bảo-mật) · [Sự cố](#-sự-cố-thường-gặp)

</div>

---

Một extension Chrome + một MCP server. Agent nào nói được MCP là dùng được, cùng một bộ tool, cùng một hành vi: mở tab trong group riêng, viền sáng và con trỏ nhìn thấy được trên tab đang thao tác, click theo phần tử, cuộn mượt, tải file lên không cần hộp thoại hệ điều hành, đọc trang có cấu trúc, chụp màn hình, chạy JS, đọc console, nút **Dừng** cho bạn.

| | |
|---|---|
| 🧩 **Dùng chung** | Nhiều agent chạy cùng lúc vẫn dùng chung một extension, tự điều phối |
| 🎯 **Click chính xác** | Mỗi phần tử có `ref_N`, agent click theo ref thay vì đoán tọa độ |
| 👁 **Hai cách nhìn** | `read_page` cho cấu trúc, `screenshot` cho hình ảnh, phối hợp theo nhu cầu |
| 🔒 **An toàn mặc định** | Allowlist site, từ chối trang web nối vào hub, nội dung trang được đánh dấu là dữ liệu |
| ⚡ **Hai chế độ** | *Real*: sự kiện thật qua Chrome debugger. *Fast*: không debugger, nhẹ và nhanh |
| 🟣 **Nhìn thấy agent làm gì** | Tab group "Agent", viền tím, thanh trạng thái, vòng sáng tại điểm click, nút Dừng |

---

## 🚀 Cài đặt trong 2 phút

Yêu cầu: **Node.js 18+**, **Google Chrome**, quyền truy cập repo này trên GitHub.

### 1. Lấy code và chạy wizard

```bash
gh repo clone Penz7/browser-agent-kit ~/.browser-agent-kit
cd ~/.browser-agent-kit && npm install && npm run setup
```

Không có `gh` thì dùng `git clone git@github.com:Penz7/browser-agent-kit.git ~/.browser-agent-kit`.

Wizard sẽ:

1. **Tự dò** agent đã cài trên máy (Codex, Claude Code, Antigravity, Cursor, Gemini CLI, Windsurf) và ghi config MCP cho tất cả.
2. **Mở** `chrome://extensions` và **copy sẵn** đường dẫn extension vào clipboard.
3. **Chờ** extension kết nối rồi báo OK.

### 2. Nạp extension (một lần, Chrome bắt buộc làm tay)

Trong tab `chrome://extensions` vừa mở: bật **Developer mode** (góc phải trên) → **Load unpacked** → dán đường dẫn (đã trong clipboard) → Open. Một trang chào mừng sẽ hiện ra, chấm xanh nghĩa là đã nối.

### 3. Cho phép site rồi dùng

Mở site cần thao tác, bấm icon extension → **Allow this site**. Rồi trong agent:

> Mở tab mới, vào example.com, đọc tiêu đề trang.

Xong. Tab mới nằm trong group **Agent**, viền tím khi agent đang thao tác.

<details>
<summary><b>Chỉ cài cho một agent cụ thể</b></summary>

```bash
npm run setup -- antigravity        # hoặc: codex | claude | cursor | gemini | windsurf
npm run setup -- codex claude       # nhiều agent một lúc
npm run setup -- json               # in khối JSON cho Cline, Roo Code, OpenCode, Kiro…
npm run setup -- antigravity --workspace   # chỉ bật cho dự án hiện tại (.agents/mcp_config.json)
npm run setup -- antigravity --token       # sinh token bảo mật, xem mục Bảo mật
```

| Agent | File được ghi |
|---|---|
| Codex CLI | `~/.codex/config.toml` |
| Claude Code | `claude mcp add browser --scope user` |
| Antigravity | `~/.gemini/config/mcp_config.json` (và file cũ `~/.gemini/antigravity/mcp_config.json` nếu có) |
| Cursor | `~/.cursor/mcp.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Cline, Roo, OpenCode, Kiro, Zed… | dán khối JSON từ `setup json` vào phần MCP của client |
| DeepSeek, Qwen, GLM… | các model này dùng qua Cline / Roo / OpenCode, làm như dòng trên |

Antigravity: sau khi ghi config, mở panel agent → `…` → **MCP Servers** → **Manage MCP Servers** → **Refresh**.
</details>

<details>
<summary><b>Dạy agent cách dùng trình duyệt</b></summary>

Tool có mô tả đầy đủ và server gửi kèm hướng dẫn qua MCP `instructions`, hầu hết agent tự biết dùng. Muốn chắc hơn:

- Dán `configs/AGENTS.md.snippet` vào `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` của dự án.
- Claude Code: copy `skill/SKILL.md` vào `~/.claude/skills/browser-agent-kit/SKILL.md`.
- Antigravity: tạo `.agents/rules/browser.md` với nội dung của snippet.
</details>

<details>
<summary><b>Cập nhật</b></summary>

```bash
cd ~/.browser-agent-kit && git pull && npm install
```

Rồi bấm ↻ trên thẻ Browser Agent Kit trong `chrome://extensions`.
</details>

---

## 🔍 Cách hoạt động

```
Agent (Codex / Claude / Antigravity / …)
   │  MCP qua stdio
   ▼
server/   MCP server (Node) ── ws://127.0.0.1:7851 ──▶  extension/   Chrome extension (MV3)
          hub: process đầu giữ port,                          │ chrome.debugger (CDP) + content script
          agent sau relay qua hub                             ▼
                                                        Tab trong Chrome của bạn
```

- **Agent** chỉ sinh lời gọi tool dạng JSON. **Server** dịch thành lệnh gửi qua WebSocket. **Extension** thực thi bằng API Chrome và trả kết quả.
- **Vòng lặp** quan sát → suy luận → hành động: sau mỗi hành động agent nhận screenshot mới để tự kiểm tra.
- **Ref ổn định**: content script gắn `ref_N` cho phần tử tương tác, sống tới khi trang điều hướng. Click theo ref tự cuộn phần tử vào giữa màn hình và báo nếu bị che.
- **Tọa độ không lệch**: screenshot thu nhỏ về 1024px ngang; server và extension cùng tính một hệ số scale từ viewport nên tọa độ model đưa khớp cả trên Retina.
- **Nhiều agent**: process server đầu tiên là hub, process sau tự thành leaf và relay. Không cần cấu hình.

### Chế độ Real và Fast

| | Real (mặc định) | Fast |
|---|---|---|
| Chuột, phím | Sự kiện thật qua Chrome DevTools Protocol | Sự kiện DOM giả lập từ content script |
| Thanh "is debugging this browser" | Hiện khi làm việc, tự ẩn sau 60s rảnh | Chỉ hiện khi dùng phím tắt, JS, console, kéo thả |
| Console / network | Bắt được khi debugger đang gắn | Chỉ khi debugger được gắn tạm |
| Phù hợp | Site khó, editor, kiểm tra `isTrusted` | Thao tác nhanh, giảm phiền |

Đổi trong icon extension → Settings → *Input mode*.

---

## 🛠 Các tool agent có

Tên tool giống Claude in Chrome nên prompt và skill viết cho Claude dùng lại được.

| Tool | Việc làm |
|---|---|
| `tabs_context` · `tabs_create` · `tabs_close` | liệt kê, mở (vào group Agent), đóng tab |
| `navigate` | tới URL, `back`, `forward`, chờ load xong |
| `computer` | `screenshot`, `left/right/middle/double/triple_click`, `left_click_drag`, `mouse_move`, `type`, `key`, `scroll`, `wait`, `zoom`. Click theo `ref` hoặc `coordinate` |
| `read_page` | cây trang rút gọn, mỗi phần tử tương tác có `ref_N`; iframe (kể cả cross-origin) được liệt kê ngay trong trang với ref dạng `f12_ref_3` |
| `find` | tìm phần tử theo mô tả tự nhiên, trả về ref |
| `get_page_text` | text toàn trang, phân trang bằng `offset` |
| `form_input` | điền nhiều ô một lượt, bắn đúng event cho React / Vue |
| `javascript_tool` | chạy JS trong trang qua CDP, không bị CSP chặn |
| `read_console_messages` · `read_network_requests` | debug trang |
| `file_upload` | gắn file local. Click nút Upload không bao giờ hiện hộp thoại chọn file của hệ điều hành: kit chặn nó và `file_upload` điền vào (không cần ref); nếu không thì truyền ref của `<input type=file>` hoặc nút upload |
| `wait_for` | chờ text, CSS selector, ref hoặc network im lặng (`gone=true` để chờ spinner biến mất) thay vì ngủ cố định |
| `list_downloads` | file đã tải về trong phiên kèm đường dẫn; `wait=true` chờ tải xong |
| `gif_recorder` | `start` / `stop` / `status`: ghi tab thành ảnh GIF động (có con trỏ và thanh trạng thái) và trả đường dẫn file |
| `resize_window` | đổi kích thước cửa sổ |
| `browser_batch` | chạy nhiều bước, trả một screenshot cuối |

---

## ⚙️ Cài đặt của extension

Bấm icon → **Settings**.

| Mục | Mặc định | Ý nghĩa |
|---|---|---|
| Port | 7851 | phải trùng `BROWSER_KIT_PORT` của server |
| Shared token | rỗng | bật để chỉ process biết token mới dùng được hub |
| Allowed sites / Allow all | rỗng / tắt | site agent được phép thao tác |
| JavaScript dialogs | auto-accept | `alert/confirm/prompt` luôn được tự đóng để không treo |
| Input mode | Real | xem bảng trên |
| Release debugger after idle | 60s | 0 = giữ luôn (cần nếu muốn bắt console liên tục) |
| Overlay + tên hiển thị | bật, "AI agent" | viền tím, thanh trạng thái và con trỏ trượt tới mỗi điểm click hoặc cuộn (ẩn khỏi ảnh chụp) |
| Tab group + tên + màu | bật, "Agent", tím | gom tab agent mở |

Biến môi trường của server (đặt trong config MCP):

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `BROWSER_KIT_PORT` | 7851 | port hub |
| `BROWSER_KIT_TOKEN` | rỗng | token chia sẻ, trùng với extension |
| `BROWSER_KIT_MAX_WIDTH` | 1024 | bề ngang tối đa của screenshot |
| `BROWSER_KIT_AUTO_SCREENSHOT` | 1 | `0` để không tự chụp sau mỗi hành động (tiết kiệm token cho model yếu) |
| `BROWSER_KIT_IMAGE_FORMAT` / `_QUALITY` | jpeg / 85 | `png` nếu cần nét hơn |
| `BROWSER_KIT_EXTENSION_ID` | rỗng | ghim ID extension được phép nối hub |
| `BROWSER_KIT_UPLOAD_ROOTS` | `$HOME:$TMPDIR:/tmp` | thư mục được phép cho `file_upload` |
| `BROWSER_KIT_WAKE` | 1 | `0` để server không mở `http://127.0.0.1:<port>/wake` trong Chrome đánh thức extension đang nghỉ (khi đó tự bấm Reconnect trong popup) |
| `BROWSER_KIT_BROWSER` | rỗng | trình duyệt dùng để mở tab đánh thức: tên app trên macOS (`Google Chrome Beta`) hoặc lệnh/đường dẫn trên hệ khác. Mặc định: Google Chrome, rồi trình duyệt mặc định của máy |
| `BROWSER_KIT_GIF_DIR` | `~/Downloads/browser-agent-kit` | nơi `gif_recorder` ghi file |
| `BROWSER_KIT_DEBUG` | 0 | `1` để log ra stderr |

CLI: `browser-agent-kit` (chạy server) · `setup [agent…]` · `remove [agent…]` (gỡ cấu hình) · `native [--extension-id ID | --remove]` (đăng ký native messaging host, xem dưới) · `extension` (in đường dẫn) · `pack [outDir]` (nén extension để đưa lên Web Store, xem [docs/publishing.md](docs/publishing.md)) · `doctor` (kiểm tra kết nối).

**Native messaging host.** Wizard setup cũng đăng ký một host nhỏ (`server/src/native-host.js`) cho Chrome, Chromium, Brave và Edge. Chrome tự khởi động nó khi extension nạp; nó thăm dò port hub bằng TCP im lặng và báo cho extension ngay khi server xuất hiện, nên extension không còn phải tự thử WebSocket (chính những lần thử đó là thứ Chrome ghi vào trang Errors). Nó cũng giữ service worker của extension luôn thức. Host chỉ nói chuyện với đúng ID extension suy ra từ thư mục extension; nếu `chrome://extensions` hiện ID khác, chạy `browser-agent-kit native --extension-id <id>` rồi reload extension.

---

## 🔒 Bảo mật

Extension giữ quyền `debugger` + `scripting` + `<all_urls>`, nên **ai nói chuyện được với hub là điều khiển được Chrome**. Kit chặn các cửa đó:

- **Trang web không thể nối vào hub.** Trình duyệt luôn gửi header `Origin` khi mở WebSocket; hub từ chối mọi Origin `http/https/file/null`, chỉ nhận `chrome-extension://…` trên `/extension` và không-Origin (process local) trên `/client`.
- **Token chia sẻ** (`setup <agent> --token`): khi bật, cả extension lẫn agent thứ hai phải xưng token trước khi gửi lệnh. Nên bật trên máy dùng chung.
- **`file_upload`** chỉ nhận file thường trong `$HOME` / thư mục tạm, **không bao giờ** nhận file hoặc thư mục ẩn (`.ssh`, `.aws`, `.gemini`, `.config`…).
- **Allowlist**: `file:`, `chrome:`, `javascript:`, `data:` không bao giờ được điều khiển, kể cả Allow all. So khớp theo host và subdomain, không bị lừa bởi `example.com.evil.com`.
- **Nội dung trang là dữ liệu**: mọi text lấy từ trang được bọc `<untrusted_page_content>`; ref sống trong isolated world nên script của trang không đọc hay sửa được.
- **Overlay** trong shadow DOM, chỉ chèn text bằng `textContent`.
- **Native messaging host** chỉ nhận kết nối từ đúng ID extension trong manifest, không mở socket nào, chỉ báo port hub có trả lời hay không.
- **Downloads** chỉ đọc: kit liệt kê những gì Chrome đã tải, không bao giờ tự tải hay xóa.

Phần còn lại là của bạn: agent được chạy JS và đọc trang trên site đã cho phép, nên chỉ Allow site cần thiết và yêu cầu agent xác nhận trước thao tác không đảo ngược được (mua hàng, gửi tin, xóa).

---

## 🩺 Sự cố thường gặp

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| Icon đỏ, "Not connected" | Chưa có agent nào khởi động server, hoặc port lệch. Mở Settings kiểm tra port, bấm Reconnect. `browser-agent-kit doctor` để thử. Mở popup cũng tự kích hoạt kết nối lại. |
| Nút "Errors" trên thẻ extension, các dòng `WebSocket connection to 'ws://127.0.0.1:7851/extension' failed` | Vô hại: mỗi dòng là một lần thăm dò lúc không có agent chạy server. Có native host (`browser-agent-kit native`, wizard tự làm) thì extension chỉ tự thăm dò một giờ một lần; không có thì thử dồn dập 2 phút sau khi mở Chrome hoặc agent tắt, rồi 5 phút một lần. Agent khởi động sẽ đánh thức nó ngay qua host hoặc tab wake. Bấm Clear all. Lỗi khác thì đáng báo cáo. |
| Một tab `http://127.0.0.1:7851/wake` lóe lên rồi tự đóng | Đó là server đánh thức extension đang nghỉ; extension đóng tab ngay khi kết nối xong. Nếu tab không đóng thì extension không chạy trong profile Chrome đó (xem chữ trên trang). `BROWSER_KIT_WAKE=0` để tắt. |
| Agent nói "Site not allowed" | Bấm icon extension trên site đó → Allow this site. |
| Thanh "Browser Agent Kit is debugging this browser" | Bình thường ở chế độ Real. Đừng bấm Cancel. Muốn không bao giờ thấy: chọn Fast, hoặc chạy Chrome với `--silent-debugger-extension-api`. |
| "Cannot attach debugger" | Tab đang mở DevTools. Đóng DevTools của tab đó. |
| "Cannot run on this page" | Trang `chrome://`, Chrome Web Store, PDF viewer. Chrome không cho extension can thiệp. |
| Click giả lập không mở được dropdown | Menu `<select>` gốc cần `form_input`, hoặc chuyển sang Real. |
| Nội dung trong iframe không thấy ở `read_page` | Chỉ frame chính được liệt kê. Dùng screenshot và click theo tọa độ cho iframe. |
| Agent bị từ chối với "user pressed Stop" | Bạn đã bấm Dừng trên overlay. Bấm icon extension → Resume. |
| Antigravity không thấy tool | Manage MCP Servers → Refresh, hoặc khởi động lại IDE. |

---

## 🗺 Chưa có

- `find` bằng model nhỏ thay vì so khớp text.
- `file_upload` theo ref bên trong iframe cross-origin (dùng đường chặn hộp thoại thay thế: click nút upload trong iframe rồi gọi `file_upload` không ref).
- Bản đăng trên Chrome Web Store (file zip đã sẵn: `browser-agent-kit pack`).

**Giới hạn thật:** lớp tool giống Claude in Chrome, nhưng kết quả cuối phụ thuộc model. Model yếu về vision nên dùng `read_page` + click theo ref thay vì tọa độ, và có thể tắt auto screenshot để giảm token.

## 🧪 Phát triển

```bash
npm test          # jsdom tests cho DOM/phím/allowlist + smoke test MCP ↔ server ↔ extension giả lập (gồm test bảo mật)
```

Cấu trúc: `extension/` (MV3) · `server/src/` (MCP server, bridge hub/leaf) · `bin/cli.js` · `skill/SKILL.md` · `configs/`.

MIT
