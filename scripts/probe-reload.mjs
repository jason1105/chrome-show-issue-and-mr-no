// Probe: does chrome.runtime.reload() kill the whole Chrome (for Testing) browser?
'use strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = process.argv[2];
const chrome = path.join(os.homedir(), 'Library/Caches/chrome-for-testing/150.0.7871.124/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-reload-'));
const port = 9777;
const headless = process.env.HEADFUL ? [] : ['--headless=new'];
const chromeProc = spawn(chrome, [
  ...headless, '--remote-debugging-port=' + port,
  '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
  '--disable-sync', '--no-default-browser-check', '--no-first-run', '--window-size=1280,800',
  `--user-data-dir=${profile}`, `--load-extension=${projectRoot}`, 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
const errs = [];
chromeProc.stderr.setEncoding('utf8'); chromeProc.stderr.on('data', (c) => errs.push(c));
chromeProc.stdout.setEncoding('utf8'); chromeProc.stdout.on('data', () => {});

const health = async (label) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`);
    const t = await r.json();
    console.log(`[${label}] OK, targets=${t.length}, chrome alive=${chromeProc.exitCode === null}`);
    return t;
  } catch (e) {
    console.log(`[${label}] FETCH FAILED: ${e.cause?.code || e.message}, chrome exitCode=${chromeProc.exitCode}`);
    if (chromeProc.exitCode !== null) console.log('chrome stderr tail:', errs.join('').slice(-2000));
    return null;
  }
};

try {
  await delay(3000);
  let targets = await health('before');
  const sw = targets?.find((t) => t.type === 'service_worker' && t.url.includes('background.js'));
  console.log('sw target:', sw?.url || 'none (may need wake)');
  const evalUrl = sw?.webSocketDebuggerUrl;
  // call chrome.runtime.reload() over raw WebSocket
  if (evalUrl) {
    const ws = new WebSocket(evalUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'chrome.runtime.reload(); "reload-called"', returnByValue: true } }));
    await new Promise((res) => setTimeout(res, 1000));
    ws.close();
  } else {
    console.log('no SW target; skip reload');
  }
  await delay(2500);
  await health('after-reload t+2.5s');
  await delay(3000);
  const t2 = await health('after-reload t+5.5s');
  const sw2 = t2?.find((x) => x.type === 'service_worker' && x.url.includes('background.js'));
  console.log('sw target after reload:', sw2?.url || 'none');
} finally {
  chromeProc.kill('SIGKILL');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
