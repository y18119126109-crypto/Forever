#!/usr/bin/env python3
"""Bundle verified desktop artifacts with platform-specific Chinese instructions."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / "package.json").read_text())["version"]
OUTPUT = ROOT / ".release"
CHECKS = ROOT / ".checks"
VERIFIED = json.loads((CHECKS / "forever-package-verification.json").read_text())
assert VERIFIED["version"] == VERSION and len(VERIFIED["packages"]) == 4
for label in ("mac-arm64", "mac-x64"):
    assert f"PASS {label}:" in (CHECKS / f"forever-acceptance-{label}.log").read_text()


def digest(data):
    return hashlib.sha256(data).hexdigest()


COMMON = f"""
首次使用
打开 Forever 后可跟随「使用指南」。点击 Lab 配置 AI、语音、音乐账号；每个分页修改后点击「保存并同步」。
安装包已内置运行环境，不需要安装 Node.js 或 npm。
默认头像、应用图标、按钮图标和界面字体都已内置；头像图片不依赖外部网络。
已有自定义头像会保留；要切换为本次默认人像，请在 Lab → 身份 → 恢复默认头像，再保存。
在线音乐、AI 推荐和云端语音需要网络及相应服务配置。QQ 音乐还需要独立运行 QQMusicApi。
便携版和安装版均不会携带开发者的 Key、Cookie、账号或历史数据。

从旧版 Swagger 升级
先完全退出旧程序，再安装或打开 Forever。不要同时运行旧版与新版。
检测到旧 Swagger AI Radio 数据目录中的 state.db 时会继续沿用；原 Key、Cookie、头像、偏好和历史保留。
旧默认助手名会显示为 Forever；自行设置的名称保留，可在 Lab 中修改。
不要删除旧数据目录。升级前可在程序退出后备份整个数据目录。
如果系统仍显示旧快捷方式，可从新安装的 Forever 建立快捷方式；不要通过删除数据来刷新图标。

版本与校验
版本：Forever {VERSION}
同目录 SHA256SUMS.txt 记录本包内文件的 SHA-256。
本 ZIP 外另有同名 .sha256 文件，供下载或复制后核对整个 ZIP。
本轮检查范围和平台实测边界见《验收说明.txt》。
"""

REPORT = f"""Forever {VERSION} 验收说明

检查日期：2026-10-02

已完成
1. 默认头像与图标均使用用户指定人像；源文件逐字节校对。macOS ICNS 保留透明边距与圆角，Windows ICO 含 16/24/32/48/64/128/256 像素图层。
2. 所有版本的第一方源码与发布源码一致；ASAR 内已打包文件逐项校验 SHA-256。
3. 核对 Windows 应用、安装器、便携启动器和卸载器的名称、版本、公司字段与图标资源。
4. 核对 macOS ARM64 / x64 运行时、Windows x64 sqlite3 原生模块；DMG 校验通过，并以只读方式挂载核对应用和 Applications 链接。
5. 提取 Windows 安装器与便携版压缩内容，CRC 检查通过，应用负载一致，并与构建目录逐项比对。
6. Mac ARM64 本机启动与交互回归通过；Mac x64 包在 Apple Silicon 上通过 Rosetta 启动与相同交互回归。
7. 在阻止页面外部网络请求的条件下，检查本地头像、按钮图标和字体；验证头像上传、保存、重启、缺失文件回退和恢复默认。
8. 验证 Lab 三种回复模式保存、三种外观切换、基础播放控制 API、关闭窗口后重开，以及桌面旧缓存清理。
9. 通用自动化测试通过；使用模拟接口检查歌单卡片与互动选择，验证 6 种桌面/窄屏场景下的新手引导与 37 个字段帮助。
10. 安装包未包含个人数据库、.env、上传头像、服务凭据或运行缓存。

本轮未验证
本机为 Apple Silicon Mac，没有 Windows 实机或 Windows 虚拟机。因此 Windows 仅完成构建与包级完整性检查，未实际运行 Windows 安装向导和播放器。
Intel 包通过 Rosetta 运行检查，未在 Intel 硬件上实测。
真实音乐账号扫码、在线歌曲版权/会员音质、云端 AI 与 TTS 服务仍取决于用户账号、网络和配置，本轮未重新逐一联通。
发行包未配置面向公开分发的 Apple Developer 签名、公证或 Windows Authenticode 证书。
"""

PLATFORMS = {
    "mac-arm64": (
        "Mac Apple Silicon 版（M1 / M2 / M3 / M4 等 M 系列）",
        """适用：macOS 13 或更高版本的 Apple Silicon Mac。
在苹果菜单 → 关于本机中查看「芯片」；M 系列选择此包。
Intel Mac 请使用 mac-x64 包。
""",
    ),
    "mac-x64": (
        "Mac Intel 版",
        """适用：macOS 13 或更高版本的 Intel Mac。
在苹果菜单 → 关于本机中查看「处理器」；Intel 选择此包。
M 系列 Mac 优先使用 mac-arm64 包，无需 Rosetta。
""",
    ),
    "win-x64-setup": (
        "Windows 64 位安装版",
        """适用：Windows 10 / Windows 11 的 x64 电脑，不适用于 32 位 Windows。
在设置 → 系统 → 关于 → 系统类型中确认 64 位操作系统与 x64 处理器。
""",
    ),
    "win-x64-portable": (
        "Windows 64 位便携版",
        """适用：Windows 10 / Windows 11 的 x64 电脑，不适用于 32 位 Windows。
无需安装向导，适合临时使用；偏好常规安装和系统快捷方式可选择 win-x64-setup 包。
""",
    ),
}

OUTPUT.mkdir(exist_ok=True)
archives = []
for package in VERIFIED["packages"]:
    platform = package["platform"]
    artifact = ROOT / "dist-desktop" / package["file"]
    artifact_bytes = artifact.read_bytes()
    assert digest(artifact_bytes) == package["sha256"], f"Artifact changed: {artifact}"
    title, system = PLATFORMS[platform]
    if platform.startswith("mac"):
        install = f"""安装步骤
1. 双击 ZIP 解压，打开 {artifact.name}。
2. 将窗口中的 Forever.app 拖入 Applications（应用程序）。
3. 如果已有 Forever，先退出运行中的应用，再确认替换。
4. 从「应用程序」打开 Forever，然后推出磁盘映像。
5. 旧 Swagger AI Radio.app 不会自动删除；确认新版本配置正常后，可仅移除旧应用文件，保留数据目录。

首次打开提示
此版本未进行 Apple Developer 签名或公证。如果系统提示无法验证开发者，确认来源为本次交付包后，在 Finder 中右键 Forever → 打开；
较新的 macOS 可在尝试打开后，进入系统设置 → 隐私与安全性 → 仍要打开。
不要关闭系统整体安全保护。如果被公司设备策略限制，需要由设备管理员允许。

数据目录
全新安装：~/Library/Application Support/Forever
旧版升级：~/Library/Application Support/Swagger AI Radio

校验 DMG（终端在解压目录执行）
shasum -a 256 "{artifact.name}"
"""
    else:
        if platform.endswith("setup"):
            steps = f"""1. 右键 ZIP → 全部解压。
2. 双击 {artifact.name}，选择安装目录并完成安装。
3. 从桌面或开始菜单的 Forever 快捷方式启动。
4. 升级前退出旧程序，可直接运行新版安装器。不要卸载并清除用户数据。
卸载：设置 → 应用 → 已安装的应用 → Forever → 卸载。
"""
        else:
            steps = f"""1. 右键 ZIP → 全部解压到固定文件夹。
2. 双击 {artifact.name} 启动，首次自解压可能稍慢。
3. 需要桌面入口时，为此 EXE 创建快捷方式。
4. 升级前完全退出旧程序，再替换便携 EXE。
此「便携版」指无需安装；设置仍保存在当前 Windows 用户的 AppData 中，不会随 EXE 自动搬到 U 盘或另一台电脑。
"""
        install = f"""使用步骤
{steps}
首次打开提示
此版本未配置 Windows Authenticode 签名，SmartScreen 可能显示未知发布者。
核对本次交付包来源和 SHA-256 后，可使用提示中的「更多信息 → 仍要运行」；不要关闭系统整体保护。
如果设备被公司策略限制，需要由设备管理员允许。

数据目录
全新安装：%APPDATA%\\Forever
旧版升级：%APPDATA%\\Swagger AI Radio
安装版与便携版共享当前用户的数据目录，不建议同时启动。

校验 EXE（PowerShell 在解压目录执行）
Get-FileHash ".\\{artifact.name}" -Algorithm SHA256
"""
    instructions = f"Forever {VERSION} · {title}\n\n{system}\n{install}\n{COMMON}"
    folder = f"Forever-{VERSION}-{platform}"
    archive = OUTPUT / (folder + ".zip")
    documents = {
        "安装说明.txt": instructions.replace("\n", "\r\n").encode("utf-8-sig"),
        "验收说明.txt": REPORT.replace("\n", "\r\n").encode("utf-8-sig"),
    }
    sums = [f"{package['sha256']}  {artifact.name}"]
    sums.extend(f"{digest(data)}  {name}" for name, data in documents.items())
    documents["SHA256SUMS.txt"] = ("\n".join(sums) + "\n").encode("utf-8")
    with zipfile.ZipFile(archive, "w", allowZip64=True) as bundle:
        bundle.writestr(f"{folder}/{artifact.name}", artifact_bytes, compress_type=zipfile.ZIP_STORED)
        for name, data in documents.items():
            bundle.writestr(f"{folder}/{name}", data, compress_type=zipfile.ZIP_DEFLATED)
    with zipfile.ZipFile(archive) as bundle:
        assert bundle.testzip() is None
        for line in sums:
            checksum, name = line.split("  ", 1)
            assert digest(bundle.read(f"{folder}/{name}")) == checksum
        assert len(bundle.infolist()) == 4
    checksum = digest(archive.read_bytes())
    archive.with_suffix(".zip.sha256").write_text(f"{checksum}  {archive.name}\n")
    archives.append({"file": archive.name, "sha256": checksum, "bytes": archive.stat().st_size, "platform": platform})
    print(f"PASS {archive.name}: ZIP CRC and 3 internal hashes; {archive.stat().st_size / 1024**2:.1f} MiB", flush=True)
(OUTPUT / f"Forever-{VERSION}-release-manifest.json").write_text(json.dumps(archives, ensure_ascii=False, indent=2) + "\n")
