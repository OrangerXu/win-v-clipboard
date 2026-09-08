# 本地安装

## 1. 构建固定目录版本

```bash
npm ci
npm run check
npm test
npm run pack:dir
```

日常安装使用 `release/linux-unpacked/`，不要用反复 `--appimage-extract-and-run` 的方式承载常驻进程：二次启动曾导致常驻实例依赖的解包文件被清理。

## 2. 预览，再安装

```bash
npm run install:local
npm run install:local -- --apply --autostart
```

默认安装到当前用户的 `~/.local`；配置目录使用 `XDG_CONFIG_HOME`，未设置时使用 `~/.config`。不需要以 root 身份运行安装脚本。

安装脚本会：

- 把构建产物复制到 `~/.local/lib/winv-clipboard/<version>/`。
- 生成 `~/.local/bin/winv-clipboard` 与 `winv-clipboard-bridge`。
- 安装桌面启动项和图标；只有传入 `--autostart` 时才写入登录自启动项。
- 生成一份待管理员批准的 AppArmor 配置，**不会自动修改系统安全设置**。
- 对已存在的启动器等文件保存带时间戳的备份；不读取、清空或迁移剪贴板历史。

若同版本目录已经存在，脚本会停止，避免覆盖运行中程序。升级应使用新的版本目录，并在退出旧实例后切换启动器。失败的安装可能留下部分文件，请检查后再重试；脚本不会自动删除目录。

可在隔离目录演练，两个路径都要设置以免改动实际登录配置：

```bash
stage_dir=$(mktemp -d)
npm run install:local -- --apply --autostart \
  --prefix "$stage_dir/local" --config-dir "$stage_dir/config"
```

## 3. Ubuntu 的 Chromium 沙箱权限

若独立启动时报 `SUID sandbox helper binary ... not configured correctly`，且系统启用了 AppArmor 的非特权 user namespace 限制，可检查安装时生成的配置：

```bash
less "$HOME/.local/share/winv-clipboard/winv-clipboard.apparmor"
```

确认它只匹配刚安装的完整可执行文件路径后，再由管理员安装并加载：

```bash
sudo install -o root -g root -m 644 \
  "$HOME/.local/share/winv-clipboard/winv-clipboard.apparmor" \
  /etc/apparmor.d/winv-clipboard
sudo apparmor_parser -r /etc/apparmor.d/winv-clipboard
```

该配置只允许此程序使用 Chromium 自身所需的 user namespace 沙箱，不修改全系统 sysctl。不要用 `--no-sandbox` 作为常规启动方式。版本目录变化后，需检查并重新加载对应的新配置。已存在其他同名配置时，应先备份并核对，不要盲目覆盖。

## 4. 配置 GNOME 的 Win+V

在“设置 → 键盘 → 自定义快捷键”中添加 **Win+V / Super+V**。命令使用安装脚本输出的 `shortcutCommand`，其形式为：

```text
'/你的用户目录/.local/bin/winv-clipboard-bridge' --launch '/你的用户目录/.local/bin/winv-clipboard'
```

桥接程序会在面板获得焦点前记录原窗口，再启动或通知常驻实例。不要把快捷键直接指向 AppImage。

若 Super+V 已被通知中心占用，需要先在系统设置中解除该冲突。不要使用 Ctrl+Shift+V 作为备用全局快捷键，它是许多终端的粘贴键。脚本不会擅自修改其他快捷键。

完成配置后启动后台进程：

```bash
"$HOME/.local/bin/winv-clipboard" --hidden --system-hotkey
```

`--system-hotkey` 仅用于已配置系统快捷键的情况；它告诉应用不再自行抢占 Super+V。

## 5. 验收与卸载

在一个空白编辑器里复制两段文本，然后将光标放在两个已有字符之间。按 Win+V，选择较旧的一条，确认内容出现在原光标处。再测试终端输入行，但不要使用可能执行危险命令的测试内容。

卸载时先从托盘退出应用，移除本应用的自定义快捷键、桌面启动项、自启动项、启动器与安装版本目录。历史数据应单独处理，不要默认删除。若安装过 AppArmor 配置，请由管理员卸载对应配置，而不是关闭全系统 AppArmor。
