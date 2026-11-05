# Forever 桌面应用

Forever 的 Windows 与 macOS 应用使用 Electron 封装现有网页和 Node.js 服务。网页版本
仍可通过 `npm start` 独立运行，桌面版不会复制或重写页面。

## 1.3.1：macOS 签名修复

1.3.0 在重新命名和打包后保留了 Electron 的链接器签名，缺少应用资源封印。
`codesign --verify --deep --strict` 会报
`code has no resources but signature indicates they must be present`。
本地直接执行成功不能代表下载后通过 macOS 校验。

现在使用完整的 ad-hoc 本地签名，签署主应用、Electron 框架、辅助进程和 sqlite3；
为 Electron JIT 和无 Team ID 的本地模块配置运行所需权限。
`afterSign` 及 DMG 生成前都会校验资源封印和嵌套签名，失败立即停止打包。
修复仅涉及安装包，不迁移或清理用户配置。

本地签名不等于 Apple Developer ID 签名或 Apple 公证。当前未配置开发者证书，
从网络下载后仍可能需要首次明确允许打开。尝试打开后，可前往「系统设置 →
隐私与安全性 → 仍要打开」。若没有该入口，只对本次已核对来源的应用执行：

```bash
codesign --verify --deep --strict "/Applications/Forever.app"
# 仅在上一条验证成功、且确认来自本次交付包后执行：
xattr -dr com.apple.quarantine "/Applications/Forever.app"
```

若签名验证失败，请重新下载修复包，不使用上述允许打开操作处理失效签名。
不需要关闭 Gatekeeper，不需要管理员权限。

## 1.3.0：Forever 品牌与本地头像

软件名称、主页面、Lab、安装器、应用文件名与系统图标统一更新为 Forever。
使用用户提供的人像生成本地默认头像和各尺寸图标；macOS 保留透明边距及圆角，
Windows ICO 含 16–256 像素图层。上传头像不存在或文件签名异常时回退到内置图片。
按钮图标库以及 Doto、Inter 字体一并本地打包，基础界面无需访问 CDN；各资源附带原许可证。

为兼容原版升级，安装器内部 ID 与浏览器存储键保持稳定。首次启动时若检测到
旧 `Swagger AI Radio` 目录中的 `state.db`，继续使用该目录；全新安装使用 `Forever`。
已有自定义头像和名称保留，旧默认 Swagger/Claudio 名称自动显示为 Forever。
macOS 上先退出旧应用，再安装 Forever.app；不要同时运行两个名称的版本。

## 1.2.2：Windows Lab 导航修复

修复 Windows 安装版在主页面尚未完全结束初始导航时点击 Lab，会将 Electron 正常产生的
`ERR_ABORTED (-3)` 误判为应用启动失败并退出的问题。现在仅当中止发生在可信本地页面切换时
忽略该错误，端口占用、服务启动失败和外部地址加载失败仍会正常报告。

内部窗口导航补充了 Promise 错误处理，连续点击或快速切换页面不会产生未处理异常。
覆盖安装 1.2.2 会继续使用原有 `%APPDATA%\\Swagger AI Radio` 数据，不清除 Key、Cookie、
播放历史、头像或偏好。

## 1.2.1：桌面模式修复、QQ 扫码与布局优化

首次进入电台会显示光标与聚光高亮引导，介绍播放、进度、队列、收藏、文字和语音。
随后可继续进入 Lab，了解模型、语音、网易云/QQ 音源、记忆、推荐和外观的设置方式。
每一步都可返回或跳过；完成/跳过记录保存在当前应用浏览器数据中，刷新可继续未完成步骤。
电台和 Lab 顶部的「使用指南」（窄屏为问号图标）可以重新查看。

Lab 的 37 个填写项均有问号提示：鼠标悬停、键盘聚焦或触屏点击可查看用途、示例和获取方式。
点击问号可固定提示，点击外部或 Esc 关闭；官方文档会在系统浏览器打开。
模型/语音字段说明随服务商切换，引导不会自动修改、保存设置或播放音频。

本版新增网易云优先、QQMusicApi 兜底的自动音源模式，以及“直接播放”“歌单卡片”
“互动选择”三种 AI DJ 回复风格。QQMusicApi 需由用户在本机或可信服务器独立运行。
桌面端可打开隔离的 QQ 音乐官方窗口扫码登录；应用启动时会清理旧 Service Worker
和页面缓存，避免升级后继续执行旧版回复渲染代码，但不会清除设置、历史或凭证。
三种播放外观针对 1280×800 以上桌面窗口重新平衡了舞台、封面、队列与对话尺寸。

覆盖安装 1.2.1 后继续使用已有系统应用数据目录，之前保存的 Key、头像与偏好仍保留。
桌面安装包不携带开发机器的凭证或个人数据。

## 本地运行

需要 Node.js 18 或更高版本。

```bash
npm ci
npm run desktop
```

桌面应用会自动：

1. 在本机 18473 端口启动 Forever 服务，端口占用时自动选择空闲端口。
2. 打开原有主电台页面。
3. 将 SQLite、上传头像、用户语料和 TTS 缓存保存到系统应用数据目录。
4. 退出应用时关闭内置服务。

## 数据目录

- macOS 全新安装：`~/Library/Application Support/Forever`
- Windows 全新安装：`%APPDATA%\\Forever`
- 旧版升级：自动沿用上述父目录下的 `Swagger AI Radio` 文件夹，不手动删除此目录。

目录中包含：

- `state.db`
- `user/`
- `public/uploads/`
- `cache/tts/`
- 可选的 `.env`

Lab 中保存的模型、语音、网易云和 QQ 音乐配置会写入桌面应用自己的 `state.db`，不会覆盖网页
开发目录里的配置。

## 构建 macOS

当前 Apple Silicon Mac：

```bash
npm run desktop:build:mac
```

生成 DMG：

```bash
npm run desktop:build:mac:dmg
```

Intel Mac：

```bash
npm run desktop:build:mac:x64
npm run desktop:build:mac:x64:dmg
```

产物位于 `dist-desktop/`。默认命令生成包含 `.app` 的 ZIP，DMG 命令生成磁盘映像。
双击 DMG 后，将 `Forever.app` 拖到同一窗口内的 `Applications` 即可安装。
当前 Electron 运行时要求 macOS 13 或更高版本；Apple Silicon 和 Intel 请选对应架构。
当前默认使用 ad-hoc 本地签名，尚未经过 Apple 公证。首次打开说明见上方 1.3.1 章节。
正式公证分发需要设置 Developer ID 签名身份，并配置 Apple 公证服务。

## 构建 Windows

```bash
npm run desktop:build:win
```

生成 NSIS 安装器和 Portable 版本。跨平台构建依赖当前机器能下载 Electron Windows
运行时；若 macOS 缺少相应打包组件，可在 Windows 或 CI 中执行同一命令。

构建过程会为目标系统单独安装并校验 `sqlite3` 原生模块。Windows x64 包必须包含
`PE32+ x86-64` 模块，macOS 包必须包含与目标架构一致的 Mach-O 模块；架构不匹配时
构建会直接失败，避免跨平台连续构建时复用错误的原生文件。

未配置代码签名证书时，Windows SmartScreen 可能显示未知发布者提示。

## 更新图标

替换 `build/icon-source.png` 后，在 macOS 执行：

```bash
npm run desktop:icons
```

该命令生成 `build/icon.png`、`build/icon.icns`、`build/icon.ico` 和 `public/assets/` 中的头像及 PWA 图标。

## Codex CLI

桌面应用会检测常见的全局 npm、Homebrew 和用户级可执行目录。安装并执行
`codex login` 后，可在 Forever Lab 中选择 `Codex CLI (ChatGPT)`。

Windows 推荐在同一 Windows 用户环境安装 Codex CLI。若未检测到，可在桌面应用数据
目录的 `.env` 中设置 `CODEX_COMMAND` 为可执行文件的绝对路径。
