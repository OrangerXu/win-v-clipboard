import { app, BrowserWindow, clipboard, ClipboardItem, globalShortcut } from 'electron';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp('/tmp/winv-regression-');
app.setPath('userData', temp);
app.disableHardwareAcceleration();
process.argv.push('--hidden', '--system-hotkey');
const wait = ms => new Promise(r => setTimeout(r, ms));
async function bounded(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' timeout')), 2500); })]); }
  finally { clearTimeout(timer); }
}
async function until(fn, label, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await wait(50);
  }
  throw new Error('Timed out: ' + label);
}
let editor, saved = [];
const summary = [];
async function runTests() {
try {
  console.log('[test] waiting for Electron ready');
  await app.whenReady();
  console.log('[test] starting clipboard application');
  await import(pathToFileURL(join(root, 'main.mjs')));
  const panel = await until(() => BrowserWindow.getAllWindows()[0], 'panel');
  await until(() => panel.webContents.executeJavaScript('Boolean(window.winV && document.querySelector("#clip-list"))').catch(() => false), 'renderer');
  console.log('[test] snapshot clipboard formats');
  for (const item of await bounded(clipboard.read(), 'clipboard.read')) {
    const formats = {};
    for (const type of item.types) {
      try { formats[type] = await bounded(item.getType(type), 'getType'); } catch { console.log('[test] unavailable clipboard format skipped'); }
    }
    if (Object.keys(formats).length) saved.push(new ClipboardItem(formats));
  }
  assert.equal(globalShortcut.isRegistered('Control+Shift+V'), false);
  assert.equal(globalShortcut.isRegistered('Control+V'), false);
  summary.push('Ctrl+V / Ctrl+Shift+V are not globally grabbed');

  editor = spawn('/usr/bin/python3', [join(root, 'tests/editor_fixture.py')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const messages = [], listeners = [];
  createInterface({ input: editor.stdout }).on('line', line => {
    const value = JSON.parse(line);
    if (listeners.length) listeners.shift()(value); else messages.push(value);
  });
  function next() { return messages.length ? Promise.resolve(messages.shift()) : new Promise(r => listeners.push(r)); }
  async function editorCommand(request) {
    editor.stdin.write(JSON.stringify(request) + '\n');
    return next();
  }
  await next();
  async function prepare(text) {
    await clipboard.writeText(text);
    const clip = await until(() => panel.webContents.executeJavaScript(
      'window.winV.getClips().then(clips => clips.find(c => c.value === ' + JSON.stringify(text) + '))'), 'clipboard fixture');
    // Main-process state can be visible before the async save and renderer update.
    await until(() => panel.webContents.executeJavaScript(
      'Boolean(document.querySelector(' + JSON.stringify('[data-id="' + clip.id + '"]') + '))'), 'rendered clipboard fixture');
    return clip;
  }
  async function openAndClick(xid, id) {
    const second = await run(process.execPath, [join(root, 'tests/secondary.mjs'), temp, xid], { timeout: 5000 });
    assert.match(second.stdout, /secondary-delivered/);
    await until(() => panel.isVisible(), 'second instance shows panel');
    await panel.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const selector = JSON.stringify('[data-id="' + id + '"]');
    const point = await panel.webContents.executeJavaScript(
      '(() => { const card = document.querySelector(' + selector + '); card.scrollIntoView({block:"center"}); ' +
      'const r = card.getBoundingClientRect(); return {x:Math.round(r.x+75),y:Math.round(r.y+r.height/2)}; })()');
    panel.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    panel.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await until(() => !panel.isVisible(), 'click hides panel');
  }
  for (const text of ['WINV-alpha-123', '  中文光标测试  ', 'first line\n第二行']) {
    const clip = await prepare(text);
    await prepare('NEWER-CLIPBOARD-ITEM');
    const {xid} = await editorCommand({op:'reset'});
    await openAndClick(xid, clip.id);
    let actual;
    try {
      await until(async () => { actual = (await editorCommand({op:'get'})).text; return actual === '左' + text + '右'; }, 'GTK actual text at caret');
    } catch (error) {
      console.log('[test] disposable editor actual:', JSON.stringify(actual));
      console.log('[test] selected fixture id:', clip.id);
      throw error;
    }
    summary.push('GTK actual caret insertion: ' + JSON.stringify(text));
  }

  for (const [index, mode] of ['manual', 'click'].entries()) {
    const text = 'WINV-terminal-' + mode + '-中文';
    const clip = await prepare(text);
    if (mode === 'click') await prepare('NEWER-TERMINAL-ITEM');
    const resultFile = join(temp, 'terminal-' + index + '.json');
    const title = 'WINV Regression Terminal ' + process.pid + '-' + index;
    await run('/usr/bin/gnome-terminal', ['--window', '--title', title, '--hide-menubar', '--',
      '/usr/bin/python3', join(root, 'tests/terminal_fixture.py'), resultFile, String(Buffer.byteLength(text))]);
    await until(() => access(resultFile.replace('.json', '.ready')).then(() => true).catch(() => false), 'real terminal ready');
    const {stdout} = await run('/usr/bin/xwininfo', ['-name', title]);
    const xid = stdout.match(/Window id: (0x[0-9a-f]+)/i)?.[1];
    assert.ok(xid);
    if (mode === 'click') await openAndClick(xid, clip.id);
    else {
      const injected = await run(join(root, 'native/linux-paste'), ['--target', xid], {timeout:4000});
      assert.match(injected.stdout, /Ctrl\+Shift\+V/);
    }
    const result = await until(async () => {
      try { return JSON.parse(await readFile(resultFile, 'utf8')); } catch { return false; }
    }, 'terminal actual bytes', 7000);
    const bytes = Buffer.from(result.hex, 'hex').toString().replaceAll('\x1b[200~','').replaceAll('\x1b[201~','');
    assert.equal(bytes, text);
    summary.push('GNOME Terminal actual PTY bytes: ' + mode + ' paste (no Enter)');
  }

  const failed = await run(join(root, 'native/linux-paste'), ['--target', '0xdeadbeef']).then(() => null, e => e.code);
  assert.equal(failed, 4);
  summary.push('Destroyed target refuses injection with nonzero exit');
  console.log('REGRESSION_PASS\n' + summary.join('\n'));
} catch (error) {
  console.error('REGRESSION_FAIL', error);
  process.exitCode = 1;
} finally {
  if (editor) { editor.stdin.write('{"op":"quit"}\n'); editor.kill(); }
  if (saved.length) await clipboard.write(saved);
  app.isQuitting = true;
  app.exit(process.exitCode || 0);
}
}
runTests().catch(error => { console.error(error); app.exit(1); });
