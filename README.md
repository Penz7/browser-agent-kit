# Browser Agent Kit

Bộ kit cho phép **mọi AI agent** (Codex, Claude Code, Antigravity, Cursor, Cline/Roo chạy DeepSeek, Gemini CLI, OpenCode...) điều khiển Chrome thật của bạn theo đúng mô hình của Claude in Chrome: một extension làm "tay chân" qua Chrome DevTools Protocol, một MCP server làm "giao diện tool" dùng chung, và một file skill dạy agent cách thao tác.

```
Agent (bất kỳ, nói MCP)
   │ stdio
   ▼
server/  MCP server (Node)  ──ws://127.0.0.1:7851──▶  extension/  Chrome extension (MV3)
                                                           │ chrome.debugger (CDP) + content script
                                                           ▼
                                                      Tab trong Chrome của bạn
```

Tên tool giống hệt Claude in Chrome (`tabs_context`, `computer`, `read_page`, `find`, `form_input`, `javascript_tool`, `read_console_messages`, `read_network_requests`, ...), nên prompt và skill viết cho Claude dùng lại được.

## Cài nhanh (2 phút)

**Bước 1. Cài kit** (clone về `~/.browser-agent-kit`, cài dependency, ghi config cho agent bạn chọn):

```bash
curl -fsSL https://raw.githubusercontent.com/Penz7/browser-agent-kit/main/install.sh | sh -s -- codex
```

Thay `codex` bằng agent bạn dùng, có thể ghi nhiều cái một lúc:

| Agent | Lệnh | Ghi vào |
|---|---|---|
| Codex CLI | `... \| sh -s -- codex` | `~/.codex/config.toml` |
| Claude Code | `... \| sh -s -- claude` | `claude mcp add` (user scope) |
| Antigravity (agy) | `... \| sh -s -- antigravity` | `~/.gemini/config/mcp_config.json` (và file cũ `~/.gemini/antigravity/mcp_config.json` nếu có) |
| Cursor | `... \| sh -s -- cursor` | `~/.cursor/mcp.json` |
| Gemini CLI | `... \| sh -s -- gemini` | `~/.gemini/settings.json` |
| Windsurf | `... \| sh -s -- windsurf` | `~/.codeium/windsurf/mcp_config.json` |
| Cline, Roo Code, OpenCode, Kiro... | `... \| sh -s -- json` | in ra khối JSON, bạn dán vào phần MCP của client |
| DeepSeek | dùng Cline / Roo / OpenCode với model DeepSeek, rồi làm như dòng trên | |

Đã clone sẵn rồi thì dùng trực tiếp:

```bash
git clone https://github.com/Penz7/browser-agent-kit.git && cd browser-agent-kit
npm install
node bin/cli.js setup codex claude     # hoặc: cursor | gemini | windsurf | json
```

Không muốn cài gì cả: trong config MCP dùng `npx` (lần đầu hơi chậm vì tải từ GitHub):

```json
{ "mcpServers": { "browser": { "command": "npx", "args": ["-y", "github:Penz7/browser-agent-kit"] } } }
```

<details>
<summary><b>Antigravity chi tiết</b></summary>

```bash
curl -fsSL https://raw.githubusercontent.com/Penz7/browser-agent-kit/main/install.sh | sh -s -- antigravity
```

Lệnh trên ghi server `browser` vào `~/.gemini/config/mcp_config.json`. Sau đó trong Antigravity: mở panel agent, bấm `…` → **MCP Servers** → **Manage MCP Servers** → **Refresh** (hoặc khởi động lại IDE). Tool `tabs_context`, `computer`, `read_page`... sẽ hiện trong danh sách.

Chỉ muốn bật cho một dự án: chạy trong thư mục dự án `node ~/.browser-agent-kit/bin/cli.js setup antigravity --workspace`, file ghi ra là `.agents/mcp_config.json`.

Để agent biết cách dùng, tạo `.agents/rules/browser.md` trong dự án với nội dung của `configs/AGENTS.md.snippet`.

Nếu `~/.gemini/config/mcp_config.json` không tồn tại sau khi chạy lệnh, mở **View raw config** trong màn hình Manage MCP Servers để biết đường dẫn thật của bản Antigravity bạn đang dùng, rồi dán khối JSON từ `node ~/.browser-agent-kit/bin/cli.js setup json` vào đó.
</details>

**Bước 2. Nạp extension vào Chrome** (một lần):

1. Mở `chrome://extensions`, bật **Developer mode** ở góc phải trên.
2. Bấm **Load unpacked**, chọn thư mục `~/.browser-agent-kit/extension` (hoặc `browser-agent-kit/extension` nếu bạn clone chỗ khác; `node bin/cli.js extension` in ra đường dẫn).
3. Ghim icon extension lên thanh công cụ.

**Bước 3. Cho phép site**: mở trang muốn điều khiển, bấm icon extension, chọn **Allow this site**, hoặc tích **Allow all sites**.

**Bước 4. Kiểm tra**:

```bash
node ~/.browser-agent-kit/bin/cli.js doctor     # báo "OK: the Chrome extension connected."
```

Rồi mở agent và yêu cầu: *"Mở tab mới, vào example.com, đọc tiêu đề trang."* Agent sẽ gọi `tabs_create` rồi `read_page`.

**Dạy agent cách dùng**: dán `configs/AGENTS.md.snippet` vào `AGENTS.md` / `CLAUDE.md` của dự án, hoặc copy `skill/SKILL.md` vào thư mục skill của client (Claude Code: `~/.claude/skills/browser-agent-kit/SKILL.md`).

**Cập nhật**: chạy lại lệnh curl ở bước 1 (script tự `git pull`), rồi bấm nút reload extension trong `chrome://extensions`.

## CLI

```
browser-agent-kit            chạy MCP server (stdio), agent gọi cái này
browser-agent-kit setup X    ghi config MCP cho agent X
browser-agent-kit extension  in đường dẫn thư mục extension
browser-agent-kit doctor     kiểm tra extension có nối được không
```

## Các tool

| Tool | Việc làm |
|---|---|
| `tabs_context` / `tabs_create` / `tabs_close` | liệt kê, mở, đóng tab |
| `navigate` | tới URL, `back`, `forward`, chờ load xong |
| `computer` | `screenshot`, `left/right/middle/double/triple_click`, `left_click_drag`, `mouse_move`, `type`, `key`, `scroll`, `wait`, `zoom`. Click theo `ref` hoặc `coordinate` |
| `read_page` | cây trang rút gọn, mỗi phần tử tương tác có `ref_N` |
| `find` | tìm phần tử theo mô tả, trả về ref |
| `get_page_text` | text toàn trang, có phân trang |
| `form_input` | điền nhiều ô một lượt, bắn đúng event cho React/Vue |
| `javascript_tool` | chạy JS trong trang qua CDP (không bị CSP chặn) |
| `read_console_messages` / `read_network_requests` | debug |
| `file_upload` | gắn file local vào input file |
| `resize_window` | đổi kích thước cửa sổ |
| `browser_batch` | chạy nhiều bước, trả một screenshot cuối |

## Chế độ nhanh, tab group và overlay

Mặc định kit chạy ở **chế độ nhanh** (Settings → Input mode → Fast):

- Click, gõ chữ, cuộn, chụp màn hình đi qua content script và `chrome.tabs.captureVisibleTab`, **không gắn debugger**, nên không hiện thanh "is debugging this browser" và nhanh hơn rõ rệt.
- Chỉ các việc cần sự kiện thật mới gắn debugger: phím tắt (`key`), kéo thả, `javascript_tool`, console, network, upload file. Debugger tự gỡ sau 20 giây rảnh (Settings → Release debugger after idle; đặt 0 để giữ, cần khi muốn bắt console/network liên tục).
- Gõ chữ dùng `execCommand('insertText')` trên ô đang focus nên React, Vue, các editor như Draft.js, ProseMirror đều nhận. Nếu không có ô nào đang focus, kit tự chuyển sang gõ phím thật qua debugger.
- Click giả lập không mở được menu `<select>` gốc của trình duyệt, kit sẽ nhắc agent dùng `form_input`. Site nào kiểm tra `isTrusted` thì đổi sang **Real** trong Settings, mọi thao tác sẽ đi qua CDP như trước.

**Tab group**: tab do agent mở (`tabs_create`) được gom vào group tên "Agent", màu tím, mỗi cửa sổ một group. Đổi tên và màu trong Settings, hoặc tắt.

**Overlay**: tab đang bị điều khiển có viền tím nhấp nháy, thanh trạng thái ở trên ghi việc đang làm ("Click: Sign in", "Đọc trang"...), vòng vàng tại điểm vừa click. Overlay tự ẩn sau 8 giây rảnh và được ẩn tạm khi chụp màn hình nên không lọt vào ảnh gửi cho model. Nút **Dừng** trên thanh làm mọi lệnh tiếp theo bị từ chối với thông báo "user pressed Stop"; bấm **Resume** trong popup để tiếp tục.

## Cơ chế quan trọng

- **Ảnh và tọa độ**: screenshot được thu nhỏ về tối đa 1024px ngang (`BROWSER_KIT_MAX_WIDTH`). Server và extension cùng tính một hệ số scale từ kích thước viewport, nên tọa độ model đưa luôn khớp dù màn hình Retina. Ảnh được resize bằng OffscreenCanvas ngay trong extension, không cần thư viện ảnh ở server.
- **Ref ổn định trong một trang**: ref gắn với phần tử DOM thật, sống tới khi trang điều hướng. Click theo ref tự cuộn phần tử vào giữa màn hình, báo nếu bị phần tử khác che.
- **Sự kiện thật**: chuột, phím đi qua `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` của CDP nên trang web nhận như người thao tác. `cmd+a/c/v/x/z` trên macOS được gắn thêm editing command để hoạt động đúng.
- **Nhiều agent cùng lúc**: process server đầu tiên giữ port và làm hub. Process sau (agent thứ hai) tự chuyển sang chế độ leaf và relay qua hub. Không cần cấu hình.
- **Dialog**: `alert/confirm/prompt` được tự đóng (chọn trong Settings) và ghi vào console log, tránh treo extension.
- **Chống prompt injection**: mọi nội dung lấy từ trang được bọc trong `<untrusted_page_content>` kèm ghi chú là dữ liệu, không phải lệnh.
- **Service worker MV3**: giữ kết nối bằng ping 20s từ server và `chrome.alarms` 30s; tự reconnect khi server khởi động lại.

## Biến môi trường của server

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `BROWSER_KIT_PORT` | 7851 | phải trùng với Settings của extension |
| `BROWSER_KIT_TOKEN` | rỗng | nếu đặt, extension phải khai cùng token |
| `BROWSER_KIT_MAX_WIDTH` | 1024 | bề ngang tối đa của screenshot |
| `BROWSER_KIT_AUTO_SCREENSHOT` | 1 | `0` để không tự chụp sau mỗi hành động (tiết kiệm token cho model yếu) |
| `BROWSER_KIT_IMAGE_FORMAT` | jpeg | `png` nếu cần ảnh nét hơn |
| `BROWSER_KIT_IMAGE_QUALITY` | 85 | chất lượng jpeg |
| `BROWSER_KIT_DEBUG` | 0 | `1` để log ra stderr |

## Sự cố thường gặp

- **Icon đỏ**: chưa có agent nào khởi động server, hoặc port lệch. Mở Settings của extension kiểm tra port, bấm Reconnect.
- **Thanh "Browser Agent Kit is debugging this browser"**: chỉ hiện khi dùng phím tắt, JS, console, network, kéo thả, và tự biến mất sau 20 giây rảnh. Đừng bấm Cancel, nếu bấm thì lần gọi sau sẽ tự attach lại. Muốn không bao giờ thấy: chạy Chrome với cờ `--silent-debugger-extension-api`.
- **"Cannot attach debugger"**: tab đang mở DevTools. Đóng DevTools của tab đó.
- **"Cannot run on this page"**: trang `chrome://`, Chrome Web Store, hoặc PDF viewer. Chrome không cho extension can thiệp.
- **iframe cross-origin**: `read_page`/`find` chỉ thấy frame chính. Dùng screenshot và click theo tọa độ cho nội dung trong iframe.

## Chưa có (có thể thêm sau)

- `gif_creator` (ghi thao tác thành ảnh động).
- Đọc cây DOM bên trong iframe cross-origin.
- `find` bằng model nhỏ thay vì so khớp text.

## Giới hạn thật

Lớp tool giống Claude in Chrome, nhưng chất lượng cuối phụ thuộc model. Model yếu về vision nên dùng `read_page` + click theo ref thay vì tọa độ, và có thể tắt auto screenshot để giảm token.
