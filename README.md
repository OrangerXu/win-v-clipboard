# WinV Clipboard

在 Linux 上用 Win+V 查看剪贴板历史。找到之前复制的内容，点一下，就能粘贴回原来的输入位置，用法接近 Windows 的 Win+V。

这是一个独立的 Linux 应用，不是 Windows 系统组件。目前主要适配 Ubuntu 的 GNOME/X11 桌面，还没有覆盖所有桌面环境。

## 能做什么

- 在后台记录复制过的文本、链接、颜色和图片，最多保留 25 条。
- 搜索历史，固定常用内容，筛选已固定项目，删除不需要的记录。
- 暂停监听，或一次清除所有未固定的内容。
- 按 Win+V 打开面板，面板显示在鼠标所在屏幕的工作区中央。

## 从源码运行

需要 Linux X11 桌面、Node.js 22.12.0+、npm、GCC 和 X11/XTest 开发库。

在 Ubuntu 上安装构建依赖，然后启动应用：

```bash
sudo apt-get install build-essential libx11-dev libxtst-dev
npm ci
npm run build:native
npm start
```

如果 Super+V 被 GNOME 占用了，按 [本地安装说明](docs/installation.md) 调整系统快捷键。遇到 Chromium 沙箱权限错误时，该文档也有处理步骤，不要直接禁用沙箱。

## 检查与构建

```bash
npm run check          # JavaScript 语法检查
npm test               # 安装规划和模板的无界面测试
npm run pack:dir       # 构建固定目录版本：release/linux-unpacked/
npm run pack:linux     # 另生成 AppImage，产物不会提交到 Git
npm run install:local  # 只预览安装计划，不修改本机
```

安装到本机、设置登录自启动和系统快捷键，见 [安装说明](docs/installation.md)。要在真实编辑器和终端中测试粘贴，见 [测试说明](docs/testing.md)。

## 怎么粘贴

1. 在其他应用里复制内容。
2. 把输入光标放到要粘贴的位置，按 Win+V。
3. 点击一条记录。面板会隐藏，应用把焦点交回原窗口，再执行粘贴。

普通窗口使用 Ctrl+V，GNOME Terminal 等已识别的终端使用 Ctrl+Shift+V。应用不会占用这两个快捷键，也不会在粘贴后额外发送 Enter。原窗口失效、粘贴助手不可用，或焦点没能恢复时，面板会提示自动粘贴未完成。

面板里可以用方向键选择记录，Enter 粘贴，Delete 删除，Ctrl+F 搜索，Esc 隐藏。右上角的 × 也只是隐藏面板；要退出应用，用托盘菜单。

手动粘贴仍按终端自己的快捷键设置来。GNOME Terminal 默认是 Ctrl+Shift+V，普通 Ctrl+V 在命令行里可能有别的用途。

## 历史存在哪里

应用没有云同步或遥测服务。历史保存在本机的 Electron 用户数据目录中，Linux 默认路径是 `~/.config/win-v-clipboard/clipboard-history.json`。

历史文件未加密。复制的密码、令牌等敏感内容也可能留下记录，所以复制前请暂停监听，用完后清除相关历史。

Git 里只提交源码、图标和合成测试数据，不提交真实剪贴板历史、账号凭据、本机日志、依赖目录或安装包。详细说明见 [SECURITY.md](SECURITY.md)。

## 测试过哪些环境

自动粘贴已在 GTK 编辑器和 GNOME Terminal 中验证。Wayland、Windows/macOS、应用内嵌终端和自定义终端快捷键还没有完成验证。图片能否粘贴取决于目标应用，对图片的支持不保证其他文件也能粘贴。

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

版本记录见 [CHANGELOG.md](CHANGELOG.md)。项目暂未选择开源许可证，`package.json` 中标记为 `UNLICENSED`，依赖按各自的许可证使用。
