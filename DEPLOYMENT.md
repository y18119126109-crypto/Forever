# Forever 源码本地部署指南

本文说明如何把源码压缩包部署到另一台 macOS、Windows 或 Linux 电脑。
桌面安装包已内置运行环境，无需 Node.js，安装步骤见各平台 ZIP 中的《安装说明.txt》。

## 1. 发布包说明

发布包只包含运行所需源码和配置模板，不包含以下本机私有数据：

- `.env` 中的服务密钥
- `state.db` 中的设置、历史记录和 Lab 凭证
- 网易云与 QQ 音乐登录 Cookie
- `user/` 中的个人品味与作息
- 用户上传的头像
- TTS 缓存、调试截图和开发文档草稿

在新电脑首次启动时，程序会自动创建空的 `state.db`。用户数据不会从原电脑自动迁移。

## 2. 环境要求

- Node.js 18 或更高版本，推荐 Node.js 20/22 LTS
- npm 9 或更高版本
- Chrome、Edge 或 Safari 等现代浏览器
- 使用 AI、在线音乐和云端 TTS 时需要网络连接

检查版本：

```bash
node -v
npm -v
```

Node.js 可从 <https://nodejs.org/> 下载。Windows 安装时保留 “Add to PATH” 选项。

## 3. 解压项目

### macOS / Linux

```bash
unzip forever-ai-radio-local-v1.3.0.zip
cd forever-ai-radio
```

### Windows PowerShell

```powershell
Expand-Archive .\forever-ai-radio-local-v1.3.0.zip
cd .\forever-ai-radio-local-v1.3.0\forever-ai-radio
```

也可以直接使用系统的“解压缩”功能，然后在终端进入 `forever-ai-radio` 文件夹。

## 4. 安装依赖

发布包包含锁定版本的 `package-lock.json`，推荐执行：

```bash
npm ci --omit=dev
```

该命令只安装 Web 服务运行依赖，不下载 Electron 桌面构建工具。需要开发或构建
Windows/macOS 应用时，执行完整的 `npm ci`，具体见 `DESKTOP.md`。

如果安装 `sqlite3` 时提示缺少本地编译环境：

- macOS：执行 `xcode-select --install`
- Windows：安装 Visual Studio Build Tools，并选择 “Desktop development with C++”
- Ubuntu / Debian：执行 `sudo apt install build-essential python3`

多数常见系统会直接下载预编译版本，不需要上述工具。

## 5. 创建本地配置

### macOS / Linux

```bash
cp .env.example .env
```

### Windows PowerShell

```powershell
Copy-Item .env.example .env
```

不填写任何密钥也可以启动界面；此时系统会使用本地规则、浏览器语音和内置候选曲目。完整 AI 推荐与云端声音需要进一步配置。

## 6. 启动服务

```bash
npm start
```

终端出现以下提示即表示启动成功：

```text
Forever is running on http://localhost:8080
```

访问地址：

- 主电台：<http://localhost:8080>
- Forever Lab：<http://localhost:8080/debug.html>
- 健康检查：<http://localhost:8080/api/health>

停止服务：回到启动服务的终端，按 `Ctrl + C`。

## 7. 配置 AI、语音与音乐

推荐启动后在 Forever Lab 中配置，所有修改均需点击“保存并同步”。
首次进入会提供分步引导；之后可点顶部「使用指南」重看。每个填写项旁的问号包含
填写方法、示例及官方获取入口，支持悬停、键盘聚焦和点击查看。

### AI 模型

进入 Lab 的“服务”分页：

使用 Codex CLI：

1. 执行 `npm i -g @openai/codex` 安装 Codex CLI。
2. 执行 `codex login`，或在 Lab 选择 Codex CLI 后点击“登录 Codex”。
3. 在 Lab 选择 `Codex CLI (ChatGPT)`；模型 ID 可留空以沿用 Codex 默认配置。
4. 点击“保存并同步”，再打开 `/api/health` 确认 AI 状态为 `configured`。

Codex 登录信息保存在当前系统用户的 `~/.codex` 中，不写入 Forever 的 SQLite，
也不会随项目压缩包迁移。桌面版需要在同一系统用户环境安装 Codex CLI。

使用 API 服务：

1. 选择 Ark、OpenAI、Anthropic 或 OpenAI Compatible。
2. 填写 API Base URL、模型 ID 和 API Key。
3. 点击“保存并同步”。
4. 打开 `/api/health` 确认 AI 状态为 `configured`。

仅拥有 API Key 不代表目标模型已经开通。若健康检查返回 `ModelNotOpen`，需要在服务商控制台开通模型或更换模型 ID。

### 语音服务

在 Lab 的“服务”和“声音”分页中：

1. 选择 Volcengine TTS、Fish Audio 或 Browser Speech。
2. 配置对应 API Key、Voice ID / Speaker ID。
3. 使用声音试听确认参数。
4. 保存并同步。

Ark 文本模型的 Key 不能替代火山语音控制台的 TTS Key。

### 网易云音乐

可直接使用公开搜索；登录后可获得更完整的账号偏好与音质能力。

1. 在 Lab 中打开网易云账号区域。
2. 生成二维码并使用网易云 App 扫码。
3. 等待页面显示登录成功。
4. 在音乐设置中选择音质。

音乐可用性受账号权限、地区、版权和网易云风控影响。

### QQ 音乐

QQ 音乐通过独立运行的 [QQMusicApi](https://gitee.com/gnnu/QQMusicApi) 接入：

1. 按项目文档在本机或可信服务器启动 QQMusicApi。
2. 在 Lab“服务”页将音源模式设为“自动选择”或“仅 QQ 音乐”。
3. 填写 QQMusicApi 根地址，例如 `http://127.0.0.1:3300`。
4. 桌面应用点击“扫码登录”，在打开的 QQ 音乐官方窗口完成扫码；网页端可手动填写当前账号 Cookie。
5. 选择 QQ 音质；会员音质和版权范围取决于登录账号。
6. 点击“保存并同步”。

扫码窗口使用独立 Electron 会话，只提取 QQ 音乐所需的白名单 Cookie。Cookie 只保存在本机 SQLite，不应写入源码、安装包或分享给其他人。自动模式会先尝试网易云，无法播放时再使用 QQ 音乐。

### AI DJ 回复风格

在 Lab“推荐”页可选择：

- 直接播放：原有问答与自动播放。
- 歌单卡片：对话中展示本次已解析成功的临时歌单。
- 互动选择：需求宽泛时先显示 2–4 个可点击方向。

## 8. 使用 `.env` 配置

也可以关闭服务后编辑 `.env`。常用字段：

```dotenv
PORT=8080

ARK_API_KEY=
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=doubao-seed-2-1-pro-260915

CODEX_COMMAND=codex
CODEX_MODEL=
CODEX_TIMEOUT_MS=90000

VOLC_TTS_API_KEY=
VOLC_TTS_SPEAKER=

NETEASE_COOKIE=
NCM_QUALITY=exhigh

MUSIC_SOURCE=auto
QQ_MUSIC_API_BASE=http://127.0.0.1:3300
QQ_MUSIC_COOKIE=
QQ_MUSIC_QUALITY=320
```

修改后重新执行 `npm start`。通过 Lab 保存的配置会存入本机 `state.db`，不同服务商的密钥相互独立。

## 9. 修改端口

默认端口为 `8080`。如果提示 `EADDRINUSE`，在 `.env` 中修改：

```dotenv
PORT=8081
```

重新启动后访问 `http://localhost:8081`。

## 10. 局域网访问

同一 Wi-Fi 下的其他设备可以通过运行电脑的局域网 IP 访问：

```text
http://运行电脑的局域网IP:8080
```

例如：`http://192.168.1.20:8080`。

需要在系统防火墙中允许 Node.js 接收局域网连接。Lab 当前没有独立账号鉴权，只应在可信局域网使用，不要直接将端口映射到公网。

部分移动浏览器只允许在 HTTPS 或 `localhost` 环境使用麦克风。通过局域网 IP 访问时，文字控制和播放仍可使用，但语音输入可能需要 HTTPS 反向代理。

## 11. 本地数据与备份

运行后会产生以下本地数据：

| 路径 | 内容 | 是否必须备份 |
| --- | --- | --- |
| `.env` | 环境变量与密钥 | 按需，必须安全保存 |
| `state.db` | Lab 设置、服务密钥、对话和播放历史 | 是 |
| `user/` | 品味、作息和播放列表 | 是 |
| `public/uploads/` | 自定义头像 | 使用自定义头像时 |
| `cache/tts/` | 已生成的语音缓存 | 否，可重新生成 |

备份前先停止服务，再复制上述文件和目录。不要把包含密钥的备份上传到公开仓库或网盘共享链接。

## 12. 升级项目

1. 停止旧服务。
2. 备份 `.env`、`state.db`、`user/` 和 `public/uploads/`。
3. 解压新版本源码。
4. 把备份的数据复制到新目录。
5. 执行 `npm ci`。
6. 执行 `npm run check`。
7. 执行 `npm start`。

不要使用新包中的空文件覆盖旧的 `state.db`。

## 13. 常见问题

### 页面可以打开，但 AI 只返回本地结果

检查 <http://localhost:8080/api/health>。使用 Codex CLI 时确认 `installed` 和
`loggedIn` 均为 `true`；使用 API 服务时确认模型 ID 和 API Key。

### 网易云返回 `-460` 或网络风险提示

这是网易云侧的风控结果。稍后重试、重新扫码登录，或更换网络环境。它不代表 Forever 源码损坏。

### 歌曲存在但无法播放

常见原因包括版权、地区限制、账号音质权限或临时音源过期。播放器会自动重新获取音源并重试一次。

使用 QQ 音乐时还需确认 QQMusicApi 正在运行、Base URL 可访问；高音质不可用时可先切换到 128K 验证。

### 麦克风不可用

检查浏览器麦克风权限。桌面端优先使用 `localhost`，移动端局域网访问可能需要 HTTPS。

### 清空所有本地数据

停止服务后删除 `state.db`，再重新启动。此操作会清除 Lab 设置、密钥、历史记录和推荐偏好，执行前请备份。

## 14. 发布包校验

发布目录会同时生成 `.sha256` 文件。下载或复制完成后可校验：

### macOS

```bash
shasum -a 256 forever-ai-radio-local-v1.3.0.zip
```

### Linux

```bash
sha256sum forever-ai-radio-local-v1.3.0.zip
```

### Windows PowerShell

```powershell
Get-FileHash .\forever-ai-radio-local-v1.3.0.zip -Algorithm SHA256
```

输出应与 `forever-ai-radio-local-v1.3.0.zip.sha256` 中的值一致。
