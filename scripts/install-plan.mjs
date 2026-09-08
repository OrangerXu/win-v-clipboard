import { isAbsolute, join } from 'node:path';

export function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export function desktopQuote(value) {
  // Escape the command-line quoting layer, then the desktop-entry string layer.
  const quoted = '"' + value.replace(/[\\`"$]/g, '\\$&') + '"';
  return quoted.replaceAll('\\', '\\\\').replaceAll('%', '%%');
}

export function createInstallPlan({ prefix, configDir, version, autostart = false }) {
  for (const path of [prefix, configDir]) {
    if (!isAbsolute(path) || /[\r\n\0]/.test(path)) throw new Error('Installation paths must be absolute and single-line');
    // These characters are AppArmor pattern operators, even inside quotes.
    if (/[\[\]{}*?^\\]/.test(path)) throw new Error('Installation paths cannot contain AppArmor pattern characters');
  }
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Invalid version');
  const directory = join(prefix, 'lib', 'winv-clipboard', version);
  const executable = join(directory, 'win-v-clipboard');
  const launcher = join(prefix, 'bin', 'winv-clipboard');
  const bridge = join(prefix, 'bin', 'winv-clipboard-bridge');
  return {
    directory, executable, launcher, bridge,
    shortcutCommand: `${shellQuote(bridge)} --launch ${shellQuote(launcher)}`,
    icon: join(prefix, 'share', 'icons', 'hicolor', '512x512', 'apps', 'cn.local.winvclipboard.png'),
    files: [
      { template: 'winv-clipboard.in', path: launcher, mode: 0o755 },
      { template: 'cn.local.winvclipboard.desktop.in', path: join(prefix, 'share', 'applications', 'cn.local.winvclipboard.desktop'), mode: 0o644 },
      { template: 'winv-clipboard.apparmor.in', path: join(prefix, 'share', 'winv-clipboard', 'winv-clipboard.apparmor'), mode: 0o644 },
      ...(autostart ? [{ template: 'cn.local.winvclipboard-autostart.desktop.in', path: join(configDir, 'autostart', 'cn.local.winvclipboard.desktop'), mode: 0o644 }] : []),
    ],
    replacements: {
      APP_EXEC_SH: shellQuote(executable),
      APP_EXEC_AA: executable.replaceAll('"', '\\"'),
      BRIDGE_DESKTOP: desktopQuote(bridge),
      LAUNCHER_DESKTOP: desktopQuote(launcher),
    },
  };
}

export function renderTemplate(template, replacements) {
  return template.replace(/@([A-Z_]+)@/g, (_, name) => {
    if (!(name in replacements)) throw new Error('Unknown template field: ' + name);
    return replacements[name];
  });
}
