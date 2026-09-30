import { execFileSync, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  ClipboardItem,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  Tray,
} from 'electron';

const MAX_ITEMS = 25;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const POLL_INTERVAL = 650;
// With the selection watcher active, polling is only a safety net: X11
// clipboard reads negotiate with the selection owner on the main thread, so
// polling often is what made panel invocation feel randomly slow.
const SAFETY_POLL_INTERVAL = 5000;
const CLIPBOARD_READ_TIMEOUT_MS = 4000;
const STUCK_RESTART_AFTER = 3;
const runFile = promisify(execFile);
const log = (...args) => console.log(new Date().toISOString(), ...args);
const PRIMARY_SHORTCUT = 'Super+V';
const START_HIDDEN = process.argv.includes('--hidden');
const USE_SYSTEM_HOTKEY = process.argv.includes('--system-hotkey');
const SELF_TEST = process.argv.includes('--self-test');

function parsePasteTarget(args) {
  const index = args.indexOf('--paste-target');
  const candidate = index >= 0 ? args[index + 1] : null;
  return /^0x[0-9a-f]+$/i.test(candidate ?? '') && candidate !== '0x0' ? candidate : null;
}

if (!app.isReady()) app.disableHardwareAcceleration();

let win;
let tray;
let clips = [];
let historyPath = '';
let invokeSocketPath = '';
let invokeServer;
let clipboardWatcher = null;
let watcherReady = false;
let watcherStopping = false;
let monitorTimer;
let monitoring = true;
let polling = false;
let shortcutState = { primary: false, fallback: false };
let pasteTargetWindow = parsePasteTarget(process.argv);
let pasting = false;
let stuckReads = 0;

const iconSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#8ca9ff"/><stop offset="1" stop-color="#4777ff"/></linearGradient></defs>
    <rect x="9" y="12" width="46" height="46" rx="13" fill="url(#g)"/>
    <rect x="22" y="6" width="20" height="13" rx="6" fill="#dbe4ff"/>
    <path d="M21 30h22M21 39h16M21 48h11" stroke="white" stroke-width="4" stroke-linecap="round"/>
  </svg>`;

function createAppIcon(size = 32) {
  const iconPath = join(import.meta.dirname, 'assets', 'icon.png');
  if (existsSync(iconPath)) return nativeImage.createFromPath(iconPath).resize({ width: size, height: size });
  const url = `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}`;
  return nativeImage.createFromDataURL(url).resize({ width: size, height: size });
}

function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((clip) => clip && typeof clip.id === 'string' && ['text', 'link', 'color', 'image'].includes(clip.type))
    .slice(0, MAX_ITEMS);
}

async function loadHistory() {
  try {
    clips = normalizeHistory(JSON.parse(await readFile(historyPath, 'utf8')));
  } catch {
    clips = [];
  }
}

async function saveHistory() {
  await writeFile(historyPath, JSON.stringify(clips, null, 2), 'utf8');
}

function fingerprint(type, value) {
  return createHash('sha256').update(`${type}:`).update(value).digest('hex');
}

function classifyText(text) {
  const trimmed = text.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return 'link';
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return 'color';
  return 'text';
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function readClipboardSnapshot() {
  const items = await withTimeout(clipboard.read(), CLIPBOARD_READ_TIMEOUT_MS, 'clipboard.read');
  for (const item of items) {
    const imageType = item.types.find((type) => type === 'image/png' || type === 'image/jpeg');
    if (imageType) {
      const blob = await withTimeout(item.getType(imageType), CLIPBOARD_READ_TIMEOUT_MS, 'clipboard item read');
      if (blob.size > 0 && blob.size <= MAX_IMAGE_BYTES) {
        const buffer = Buffer.from(await blob.arrayBuffer());
        const dataUrl = `data:${imageType};base64,${buffer.toString('base64')}`;
        return { type: 'image', value: dataUrl, preview: dataUrl, label: `图片 · ${Math.max(1, Math.round(blob.size / 1024))} KB` };
      }
    }
  }

  const text = await withTimeout(clipboard.readText(), CLIPBOARD_READ_TIMEOUT_MS, 'clipboard.readText');
  if (!text || Buffer.byteLength(text, 'utf8') > MAX_IMAGE_BYTES) return null;
  const type = classifyText(text);
  return { type, value: text, preview: text, label: type === 'link' ? '链接' : type === 'color' ? '颜色' : `${text.length} 个字符` };
}

function trimHistory(items) {
  const pinned = items.filter((item) => item.pinned);
  const unpinned = items.filter((item) => !item.pinned);
  return [...pinned, ...unpinned].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ITEMS);
}

async function captureClipboard() {
  if (!monitoring || polling || pasting) return;
  polling = true;
  try {
    const snapshot = await readClipboardSnapshot();
    stuckReads = 0;
    if (!snapshot || pasting) return;
    const hash = fingerprint(snapshot.type, snapshot.value);
    if (clips[0]?.hash === hash) return;
    const existing = clips.find((clip) => clip.hash === hash);
    const clip = {
      id: existing?.id ?? crypto.randomUUID(),
      hash,
      type: snapshot.type,
      value: snapshot.value,
      preview: snapshot.preview,
      label: snapshot.label,
      createdAt: Date.now(),
      pinned: existing?.pinned ?? false,
    };
    clips = trimHistory([clip, ...clips.filter((item) => item.hash !== hash)]);
    await saveHistory();
    publishHistory();
  } catch (error) {
    // Clipboard providers can be temporarily busy; the next poll retries.
    const message = error?.message ?? String(error);
    stuckReads = /timed out/i.test(message) ? stuckReads + 1 : 0;
    console.error(new Date().toISOString(), `[monitor] capture failed: ${message}`);
    if (stuckReads >= STUCK_RESTART_AFTER) {
      console.error(new Date().toISOString(), '[monitor] clipboard reads stuck repeatedly; restarting to recover');
      app.relaunch();
      app.exit(0);
    }
  } finally {
    polling = false;
  }
}

function publishHistory() {
  if (win && !win.isDestroyed()) win.webContents.send('clips:updated', clips);
}

function getStatus() {
  const nativePaste = app.isPackaged
    ? join(process.resourcesPath, 'bin', 'linux-paste')
    : join(import.meta.dirname, 'native', 'linux-paste');
  return {
    monitoring,
    primaryShortcut: shortcutState.primary,
    fallbackShortcut: shortcutState.fallback,
    autoPaste: process.platform === 'win32' || (process.platform === 'linux' && existsSync(nativePaste)),
    platform: process.platform,
  };
}

function publishStatus() {
  if (win && !win.isDestroyed()) win.webContents.send('status:updated', getStatus());
}

function getNativePastePath() {
  return app.isPackaged
    ? join(process.resourcesPath, 'bin', 'linux-paste')
    : join(import.meta.dirname, 'native', 'linux-paste');
}

function rememberPasteTarget() {
  pasteTargetWindow = null;
  if (process.platform !== 'linux') return;
  const nativePaste = getNativePastePath();
  if (!existsSync(nativePaste)) return;
  try {
    const focusedWindow = execFileSync(nativePaste, ['--focus-id'], {
      encoding: 'utf8',
      timeout: 500,
      windowsHide: true,
    }).trim();
    if (validExternalTarget(focusedWindow)) {
      pasteTargetWindow = focusedWindow;
    }
  } catch {
    pasteTargetWindow = null;
  }
}

function validExternalTarget(target) {
  if (!/^0x[0-9a-f]+$/i.test(target ?? '') || BigInt(target) <= 1n) return false;
  if (!win || win.isDestroyed()) return true;
  const handle = win.getNativeWindowHandle();
  const ownId = handle.length >= 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
  return BigInt(target) !== ownId;
}

function positionWindow() {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = display.workArea;
  const [windowWidth, windowHeight] = win.getSize();
  win.setPosition(
    Math.round(x + (width - windowWidth) / 2),
    Math.round(y + (height - windowHeight) / 2),
    false,
  );
}

function showWindow({ preservePasteTarget = false } = {}) {
  if (win.isVisible()) { win.focus(); return; }
  if (!preservePasteTarget) rememberPasteTarget();
  log(`[window] show target=${pasteTargetWindow ?? 'none'} preserve=${preservePasteTarget}`);
  positionWindow();
  win.show();
  win.focus();
  win.webContents.send('window:shown');
}

function toggleWindow(options) {
  log(`[window] toggle visible=${win.isVisible()}`);
  if (win.isVisible()) win.hide();
  else showWindow(options);
}

// Shared entry for every external invocation path (socket, second instance).
function invokeToggle(target) {
  if (!win || win.isDestroyed()) return false;
  if (!win.isVisible()) pasteTargetWindow = validExternalTarget(target) ? target : null;
  toggleWindow({ preservePasteTarget: validExternalTarget(pasteTargetWindow) });
  return true;
}

// The bridge connects here first so pressing Win+V never cold-starts a second
// Electron process just to deliver a toggle message. If the connect fails
// (app not running, stale socket), the bridge falls back to launching us.
function startInvokeServer() {
  if (process.platform !== 'linux') return;
  try { unlinkSync(invokeSocketPath); } catch { /* first run */ }
  invokeServer = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let handled = false;
    // The bridge may close its end right after sending; writing the reply
    // then raises EPIPE, which must never take down the main process.
    socket.on('error', (error) => log(`[invoke] client socket error: ${error.message}`));
    socket.on('data', (chunk) => {
      if (handled) return;
      handled = true;
      const line = chunk.split('\n')[0] ?? '';
      const [command, target] = line.trim().split(/\s+/);
      if (command !== 'toggle') { socket.end('error unknown-command\n'); return; }
      log(`[invoke] socket target=${target ?? 'none'}`);
      socket.end(invokeToggle(target) ? 'ok\n' : 'error no-window\n');
    });
  });
  invokeServer.on('error', (error) => log(`[invoke] socket server failed: ${error.message}`));
  invokeServer.listen(invokeSocketPath, () => log(`[invoke] listening on ${invokeSocketPath}`));
}

function setPollInterval(ms) {
  clearInterval(monitorTimer);
  monitorTimer = setInterval(captureClipboard, ms);
}

// XFixes reports every CLIPBOARD ownership change, so the history updates on
// real copies instead of a busy poll that can stall the main thread behind a
// slow selection owner.
function startClipboardWatcher() {
  if (process.platform !== 'linux') return;
  const nativePaste = getNativePastePath();
  if (!existsSync(nativePaste)) return;
  watcherStopping = false;
  clipboardWatcher = spawn(nativePaste, ['--watch'], { stdio: ['ignore', 'pipe', 'inherit'] });
  clipboardWatcher.on('error', (error) => log(`[watcher] failed to start: ${error.message}`));
  let buffer = '';
  clipboardWatcher.stdout.setEncoding('utf8');
  clipboardWatcher.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line === 'ready' && !watcherReady) {
        watcherReady = true;
        log('[watcher] selection events active; relaxing poll interval');
        setPollInterval(SAFETY_POLL_INTERVAL);
      } else if (line === 'changed') {
        captureClipboard();
      }
    }
  });
  clipboardWatcher.on('exit', () => {
    if (watcherReady) {
      watcherReady = false;
      setPollInterval(POLL_INTERVAL);
    }
    if (watcherStopping || app.isQuitting) return;
    log('[watcher] exited; restarting in 1s');
    setTimeout(startClipboardWatcher, 1000).unref();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 410,
    height: 680,
    minWidth: 370,
    minHeight: 520,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: createAppIcon(64),
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.loadFile(join(import.meta.dirname, 'renderer', 'index.html'));
  win.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('show', () => log('[window] event show'));
  win.on('hide', () => log('[window] event hide'));
  win.on('focus', () => log('[window] event focus'));
  win.on('blur', () => log('[window] event blur'));
  if (!START_HIDDEN) {
    win.once('ready-to-show', () => showWindow({ preservePasteTarget: Boolean(pasteTargetWindow) }));
  }
}

function createTray() {
  tray = new Tray(createAppIcon(22));
  tray.setToolTip('剪贴板 · Win+V');
  tray.on('click', toggleWindow);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: '打开剪贴板', click: showWindow },
    { label: monitoring ? '暂停监听' : '继续监听', click: async () => {
      monitoring = !monitoring;
      refreshTrayMenu();
      publishStatus();
      if (monitoring) await captureClipboard();
    } },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

function registerShortcuts() {
  shortcutState.primary = USE_SYSTEM_HOTKEY && process.platform === 'linux';
  if (!shortcutState.primary) {
    shortcutState.primary = globalShortcut.register(PRIMARY_SHORTCUT, () => {
      log(`[shortcut] invoked ${PRIMARY_SHORTCUT}`);
      toggleWindow();
    });
  }
  // Ctrl+V and Ctrl+Shift+V belong to the focused application, never this manager.
  shortcutState.fallback = false;
  log(`[shortcut] ${PRIMARY_SHORTCUT}=${shortcutState.primary}; paste shortcuts untouched`);
}

async function runSelfTest() {
  const bridgeAvailable = await win.webContents.executeJavaScript('Boolean(window.winV)');
  const renderedCount = await win.webContents.executeJavaScript('window.winV.getClips().then((clips) => clips.length)');
  positionWindow();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = win.getBounds();
  const expectedX = Math.round(display.workArea.x + (display.workArea.width - bounds.width) / 2);
  const expectedY = Math.round(display.workArea.y + (display.workArea.height - bounds.height) / 2);
  const centered = Math.abs(bounds.x - expectedX) <= 2 && Math.abs(bounds.y - expectedY) <= 2;
  win.show();
  await win.webContents.executeJavaScript("document.querySelector('#close-button').click()");
  await new Promise((resolve) => setTimeout(resolve, 150));
  console.log(`[self-test] bridge=${bridgeAvailable} clips=${renderedCount} centered=${centered} closeHides=${!win.isVisible()}`);
  app.isQuitting = true;
  app.quit();
}

async function writeClipToClipboard(clip) {
  if (clip.type === 'image') {
    const [header, encoded] = clip.value.split(',');
    const mime = header.match(/^data:([^;]+)/)?.[1] ?? 'image/png';
    await clipboard.write([new ClipboardItem({ [mime]: new Blob([Buffer.from(encoded, 'base64')], { type: mime }) })]);
  } else {
    await clipboard.writeText(clip.value);
  }
}

async function injectPaste(target) {
  if (process.platform === 'win32') {
    const script = "$s=New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 80; $s.SendKeys('^v')";
    await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 5000 });
    return true;
  }
  const nativePaste = getNativePastePath();
  if (process.platform === 'linux' && existsSync(nativePaste)) {
    if (!validExternalTarget(target)) throw new Error('没有有效的原输入窗口');
    const { stdout } = await runFile(nativePaste, ['--target', target], { timeout: 4000, maxBuffer: 4096 });
    log(`[paste] ${stdout.trim()}`);
    return true;
  }
  throw new Error('本机粘贴助手不可用');
}

ipcMain.handle('clips:get', () => clips);
ipcMain.handle('app:status', () => getStatus());
ipcMain.handle('window:hide', () => win.hide());
ipcMain.handle('monitoring:set', async (_event, enabled) => {
  monitoring = Boolean(enabled);
  refreshTrayMenu();
  publishStatus();
  if (monitoring) await captureClipboard();
  return getStatus();
});
ipcMain.handle('clips:toggle-pin', async (_event, id) => {
  clips = clips.map((clip) => clip.id === id ? { ...clip, pinned: !clip.pinned } : clip);
  await saveHistory();
  publishHistory();
  return clips;
});
ipcMain.handle('clips:remove', async (_event, id) => {
  clips = clips.filter((clip) => clip.id !== id);
  await saveHistory();
  publishHistory();
  return clips;
});
ipcMain.handle('clips:clear', async () => {
  clips = clips.filter((clip) => clip.pinned);
  await saveHistory();
  publishHistory();
  return clips;
});
ipcMain.handle('clips:paste', async (_event, id) => {
  if (pasting) return { ok: false, message: '正在粘贴，请稍候' };
  const clip = clips.find((item) => item.id === id);
  if (!clip) return { ok: false, autoPasted: false };
  log(`[paste] selected id=${id}`);
  pasting = true;
  const target = pasteTargetWindow;
  let copied = false;
  try {
    await writeClipToClipboard(clip);
    copied = true;
    win.hide();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const autoPasted = await injectPaste(target);
    pasteTargetWindow = null;
    return { ok: true, autoPasted };
  } catch (error) {
    console.error(new Date().toISOString(), `[paste] failed code=${error.code ?? 'unavailable'}`);
    const message = copied
      ? '已复制，但未能自动粘贴。请回到输入框手动粘贴；终端使用 Ctrl+Shift+V。'
      : '复制失败，请重试。';
    showWindow({ preservePasteTarget: true });
    if (Notification.isSupported()) new Notification({ title: '粘贴未完成', body: message, silent: true }).show();
    return { ok: copied, autoPasted: false, message };
  } finally {
    pasting = false;
  }
});

const hasLock = app.requestSingleInstanceLock({ pasteTarget: pasteTargetWindow });
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine, _workingDirectory, additionalData) => {
    const sharedTarget = additionalData?.pasteTarget;
    const explicitTarget = /^0x[0-9a-f]+$/i.test(sharedTarget ?? '') && sharedTarget !== '0x0'
      ? sharedTarget
      : parsePasteTarget(commandLine);
    log(`[instance] second target=${explicitTarget ?? 'none'} visible=${win?.isVisible()}`);
    invokeToggle(explicitTarget);
  });
  app.whenReady().then(async () => {
    app.setName('剪贴板 Win+V');
    historyPath = join(app.getPath('userData'), 'clipboard-history.json');
    invokeSocketPath = join(app.getPath('userData'), 'invoke.sock');
    await loadHistory();
    createWindow();
    createTray();
    registerShortcuts();
    startInvokeServer();
    startClipboardWatcher();
    monitorTimer = setInterval(captureClipboard, POLL_INTERVAL);
    await captureClipboard();
    if (SELF_TEST) await runSelfTest();
  });
}

app.on('activate', () => win ? showWindow() : createWindow());
app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => {
  clearInterval(monitorTimer);
  if (clipboardWatcher && !clipboardWatcher.killed) {
    watcherStopping = true;
    clipboardWatcher.kill();
  }
  invokeServer?.close();
  if (invokeSocketPath) {
    try { unlinkSync(invokeSocketPath); } catch { /* already gone */ }
  }
  globalShortcut.unregisterAll();
});
