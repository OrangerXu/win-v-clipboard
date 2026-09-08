import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#9ab0ff"/><stop offset="1" stop-color="#436fff"/></linearGradient></defs>
    <rect x="58" y="86" width="396" height="384" rx="108" fill="url(#g)"/>
    <rect x="170" y="42" width="172" height="108" rx="50" fill="#e9edff"/>
    <path d="M164 232h184M164 302h140M164 372h90" stroke="white" stroke-width="34" stroke-linecap="round"/>
  </svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true });
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  const icon = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  writeFileSync(join(import.meta.dirname, '..', 'assets', 'icon.png'), icon.toPNG());
  win.destroy();
  app.quit();
});
