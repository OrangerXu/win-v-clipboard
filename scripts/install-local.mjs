import { constants } from 'node:fs';
import { access, chmod, copyFile, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createInstallPlan, renderTemplate } from './install-plan.mjs';

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({ options: {
  apply: { type: 'boolean', default: false },
  autostart: { type: 'boolean', default: false },
  prefix: { type: 'string', default: join(homedir(), '.local') },
  'config-dir': { type: 'string', default: process.env.XDG_CONFIG_HOME || join(homedir(), '.config') },
} });
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const plan = createInstallPlan({ prefix: values.prefix, configDir: values['config-dir'], version, autostart: values.autostart });
console.log(JSON.stringify({ mode: values.apply ? 'install' : 'preview (add --apply to install)', ...plan, replacements: undefined }, null, 2));

if (values.apply) {
  const source = join(root, 'release', 'linux-unpacked');
  await access(join(source, 'win-v-clipboard'), constants.X_OK);
  await access(join(source, 'resources', 'bin', 'linux-paste'), constants.X_OK);
  await access(join(source, 'resources', 'app.asar'));
  const rendered = await Promise.all(plan.files.map(async file => ({ ...file,
    content: renderTemplate(await readFile(join(root, 'assets', 'templates', file.template), 'utf8'), plan.replacements),
  })));
  // Refuse an in-place overwrite: a running Electron process may still use it.
  await mkdir(dirname(plan.directory), { recursive: true });
  await mkdir(plan.directory);
  for (const entry of await readdir(source)) {
    await cp(join(source, entry), join(plan.directory, entry), { recursive: true, force: false, errorOnExist: true });
  }
  const backupSuffix = '.bak-' + new Date().toISOString().replaceAll(':', '-');
  async function backup(path) {
    try { await copyFile(path, path + backupSuffix, constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const file of rendered) {
    await mkdir(dirname(file.path), { recursive: true });
    await backup(file.path);
    await writeFile(file.path, file.content, { mode: file.mode });
    await chmod(file.path, file.mode);
  }
  await backup(plan.bridge);
  await copyFile(join(plan.directory, 'resources', 'bin', 'linux-paste'), plan.bridge);
  await chmod(plan.bridge, 0o755);
  await mkdir(dirname(plan.icon), { recursive: true });
  await backup(plan.icon);
  await copyFile(join(root, 'assets', 'icon.png'), plan.icon);
  console.log('Installed. Existing clipboard history was not changed. See docs/installation.md for the desktop shortcut and sandbox permission.');
}
