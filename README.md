# Forever

Forever（原 Swagger AI Radio）提供 macOS 与 Windows 桌面版及 Web/PWA。
默认头像、网页图标、Dock/任务栏与安装器图标统一使用内置人像，头像显示不再依赖外部图片接口。
macOS 1.3.1 修复安装后“已损坏”的失效签名问题，增加完整本地签名与打包验证；
首次打开与未公证说明见 [桌面安装说明](./DESKTOP.md)。

播放样式可在 [Lab 外观](http://localhost:8080/debug.html#appearance) 中切换为“唱片沉浸”或“玻璃桌面”。音乐来源支持网易云、用户自托管的 [QQMusicApi](https://gitee.com/gnnu/QQMusicApi)，或网易云优先的自动回退；桌面应用可通过 QQ 音乐官方窗口扫码登录。

本地优先的私人 AI 电台。PWA 负责播放和交互，Node.js 服务负责上下文组装、模型调用、音乐解析、TTS、状态持久化与定时调度。

完整产品说明见 [`PRODUCT.md`](./PRODUCT.md)。

跨电脑安装、配置、局域网访问、升级和备份说明见 [`DEPLOYMENT.md`](./DEPLOYMENT.md)。

Windows 与 macOS 桌面应用的运行、构建和数据目录说明见
[`DESKTOP.md`](./DESKTOP.md)。

## 启动

```bash
npm ci --omit=dev
cp .env.example .env
npm start
```

打开 `http://localhost:8080`。

桌面应用开发模式：

```bash
npm ci
npm run desktop
```

没有配置外部服务时，应用使用本地规则、内置曲目目录、浏览器语音和本地生成音床，界面与完整交互仍可运行。密钥可通过 `.env` 或 LAB 配置；LAB 密钥只保存在本地 SQLite，读取接口仅返回掩码与来源，不返回明文。

Ark Key 可以读取模型目录不代表对应模型已经开通。`GET /api/health` 会暴露脱敏后的 `ModelNotOpen` 等状态；当前默认使用 `doubao-seed-2-1-pro-260915`。

调试页位于 `http://localhost:8080/debug.html`，用于配置模型、语音、网易云与 QQ 音乐、DJ 回复风格、推荐策略、身份和外观。DJ 回复可选“直接播放”“歌单卡片”“互动选择”；Codex CLI 可复用 `codex login` 的 ChatGPT 登录态，无需在 Forever 中保存 API Key。

主页面顶部头像是 Forever 档案入口；点击后展示 DJ 人设、在线统计、音乐风格标签和本地品味记忆，不再使用登录入口。

桌面端可在非输入控件上长按空格说话，触屏端可长按消息输入框；松开后会结束识别并自动发送。播放器支持吸顶与波形折叠态，聊天区支持专注全屏。

队列进入倒数第二首时会静默生成续播歌曲，并结合模型选择、账号偏好和当前音源追加新队列；最后一首结束后不会回到第一首或停止。

## 运行链路

1. `public/`：单 `<audio>` PWA 播放器、主题切换、队列、聊天和 WebSocket 状态。
2. `src/router.js`：指令与自然语言意图分流。
3. `src/context.js`：按系统提示词、用户语料、环境、记忆、输入/工具结果、执行轨迹六个片段组装上下文。
4. `src/llm.js`：统一调用 Codex CLI、Ark/OpenAI Responses、Anthropic Messages 或 OpenAI-compatible Chat Completions。
5. `src/claude.js`：优先使用 LAB/环境变量选定的大模型；随后尝试 `claude -p --output-format json`；最后回退本地规则。
6. `src/music.js` / `src/qq-music.js`：统一调度网易云与 QQMusicApi 的搜索、完整音源、歌词和封面，并通过本地 Range 代理播放。
7. `src/tts.js`：按 LAB 配置调用 Volcengine TTS 或 Fish Audio，并按文本哈希缓存 MP3。
8. `src/state.js`：SQLite 持久化消息、播放、计划和偏好。
9. `src/scheduler.js`：按作息触发节目规划。

## 声音

TTS 使用 LAB 中选定的服务：

1. Volcengine TTS：使用豆包语音合成 2.0，并支持声音复刻 `speaker_id`。
2. Fish Audio：使用 API Key 和可选 Reference ID。
3. Browser Speech：无需 Key 的本地回退。

`ARK_API_KEY` 只用于大模型文本推理，不能替代语音控制台的 TTS API Key。声音复刻需使用本人或已获授权的录音，并先通过 V3 声音复刻接口取得 `speaker_id`。

## HTTP / WebSocket

- `POST /api/chat`
- `GET /api/now`
- `GET /api/next`
- `GET /api/taste`
- `GET /api/plan/today`
- `GET /api/health`
- `POST /api/voice/preview`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/integrations`
- `PUT /api/integrations`
- `DELETE /api/integrations/:target/key`
- `GET /api/integrations/codex/status`
- `POST /api/integrations/codex/login`
- `GET /api/music/account`
- `POST /api/music/login/qr`
- `GET /api/music/login/qr/:key`
- `DELETE /api/music/login`
- `POST /api/settings/avatar`
- `POST /api/settings/avatar/reset`
- `WS /stream`
