# WinV Clipboard

一个本地优先的 Linux 剪贴板历史应用，提供类似 Windows **Win+V** 的交互：快捷键唤起、搜索历史、点击记录后回到原窗口粘贴。

当前重点支持 **Ubuntu / GNOME / X11**。本项目不是 Windows 系统组件，也不宣称已支持所有桌面环境。

## 功能

- 后台监听文本、链接、颜色和图片，最多保存 25 条历史。
- Win+V 唤起；面板在鼠标所在屏幕的工作区居中。
- 搜索、固定筛选、删除、暂停监听、清除未固定内容。
- 点击历史记录后恢复原窗口焦点，再触发粘贴。
- 普通窗口使用 Ctrl+V；GNOME Terminal 等已识别终端使用 Ctrl+Shift+V。
- 不占用应用原本的 Ctrl+V / Ctrl+Shift+V；不额外发送 Enter。
- 原窗口失效、助手不可用或焦点恢复失败时，明确提示自动粘贴未完成。

## 快速开始

需要 Linux X11 桌面、Node.js **22.12.0+**、npm、GCC，以及 X11/XTest 开发库。

Ubuntu 构建依赖：

```bash
sudo apt-get install build-essential libx11-dev libxtst-dev
npm ci
npm run build:native
npm start
```

如果 GNOME 已占用 Super+V，请按 [本地安装说明](docs/installation.md) 设置系统快捷键。若遇到 Chromium 沙箱权限错误，也请先看该说明，不要直接禁用沙箱。

## 检查与构建

```bash
npm run check          # JavaScript 语法检查
npm test               # 安装规划和模板的无界面测试
npm run pack:dir       # 构建固定目录版本：release/linux-unpacked/
npm run pack:linux     # 另生成 AppImage，产物不会提交到 Git
npm run install:local  # 只预览安装计划，不修改本机
```

实际安装、登录自启动和系统快捷键见 [docs/installation.md](docs/installation.md)。真实编辑器 / 终端回归见 [docs/testing.md](docs/testing.md)。

## 使用

1. 在其他应用复制需要保存的内容。
2. 把输入光标放在目标位置，按 Win+V。
3. 点击历史记录；面板隐藏，内容粘贴到原窗口。

面板内可用方向键选择、Enter 粘贴、Delete 删除、Ctrl+F 搜索、Esc 隐藏。右上角 × 只隐藏面板，退出应用请使用托盘菜单。

终端手动粘贴仍遵循终端自身设置。GNOME Terminal 默认使用 Ctrl+Shift+V；普通 Ctrl+V 在命令行中可能有其他含义。

## 隐私与边界

应用代码不包含云同步或遥测服务。历史保存在 Electron 的用户数据目录中，默认 Linux 路径为 `~/.config/win-v-clipboard/clipboard-history.json`，**未加密**。密码、令牌等敏感内容也可能被记录；复制敏感信息前请暂停监听，使用后清除相关历史。

仓库只包含源码、图标和合成测试数据，不包含真实剪贴板历史、账号凭据、本机日志、依赖目录或安装包。更多说明见 [SECURITY.md](SECURITY.md)。

已实际验证的自动粘贴目标为 GTK 编辑器和 GNOME Terminal。Wayland、Windows/macOS、应用内嵌终端及自定义终端快捷键未完成验证。图片能否粘贴取决于目标应用；图片支持不等于任意文件粘贴。

## 项目结构

```text
main.mjs              Electron 主进程、剪贴板监听与 IPC
preload.cjs           沙箱内的窄接口桥接
renderer/             面板 HTML / CSS / JavaScript
native/linux-paste.c  X11 原窗口记录、焦点恢复与 XTest 粘贴
assets/               应用图标、可移植安装模板
scripts/              检查、安装规划、安装和图标生成
tests/                无界面单元测试与真实桌面回归
docs/                 安装、测试与架构说明
```

版本记录见 [CHANGELOG.md](CHANGELOG.md)。当前未指定开源许可证，`package.json` 标记为 `UNLICENSED`；依赖遵循各自许可证。
