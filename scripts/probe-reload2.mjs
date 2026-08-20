// Probe v2: replicate acceptance-restart scenario-1 conditions
// - headful Chrome via direct spawn, fixture page open, console capture attached to SW
// - then chrome.runtime.reload() — does the browser survive?
'use strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const projectRoot = process.argv[2];
const chrome = path.join(os.homedir(), 'Library/Caches/chrome-for-testing/150.0.7871.124/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// fixture server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  res.end('<!doctype html><html><body><h1>Issue 123</h1></body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'probe2-'));
const port = 9788;
const chromeProc = spawn(chrome, [
  '--remote-debugging-port=' + port,
  '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
  '--disable-sync', '--no-default-browser-check', '--no-first-run', '--window-size=1280,800',
  `--user-data-dir=${profile}`, `--load-extension=${projectRoot}`, 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
const errs = [], outs = [];
chromeProc.stderr.setEncoding('utf8'); chromeProc.stderr.on('data', (c) => errs.push(c));
chromeProc.stdout.setEncoding('utf8'); chromeProc.stdout.on('data', (c) => outs.push(c));

const health = async (label) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`);
    const t = await r.json();
    console.log(`[${label}] OK targets=${t.length} chromeAlive=${chromeProc.exitCode === null}`);
    return t;
  } catch (e) {
    console.log(`[${label}] FETCH FAILED (${e.cause?.code || e.message}) chromeExit=${chromeProc.exitCode} signal=${chromeProc.signalCode}`);
    console.log('chrome stderr tail:', errs.join('').slice(-3000) || '(empty)');
    return null;
  }
};

async function evalIn(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  const p = new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('eval timeout')), 15000);
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id === 1) { clearTimeout(timer); m.error ? rej(new Error(m.error.message)) : res(m.result?.result?.value); }
    }, { once: false });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  try { return await p; } finally { try { ws.close(); } catch {} }
}

try {
  await delay(3000);
  let targets = await health('before');
  // navigate the about:blank tab to fixture origin (like badge check)
  const page = targets.find((t) => t.type === 'page');
  await evalIn(page.webSocketDebuggerUrl, `location.href = ${JSON.stringify(origin + '/acme/platform/-/issues/123')}; 'nav'`).catch((e) => console.log('nav err', e.message));
  await delay(1500);
  targets = await health('after-nav');
  const sw = targets.find((t) => t.type === 'service_worker' && t.url.includes('src/background.js'));
  console.log('sw target:', sw?.url || 'NONE');
  if (!sw) throw new Error('no SW target');

  // attach console capture (Runtime.enable) — replicate acceptance script
  const capWs = new WebSocket(sw.webSocketDebuggerUrl);
  await new Promise((res, rej) => { capWs.addEventListener('open', res, { once: true }); capWs.addEventListener('error', rej, { once: true }); });
  capWs.addEventListener('message', (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      console.log(`[SW console] [${m.params.type}] ${text}`);
    }
  });
  capWs.send(JSON.stringify({ id: 10, method: 'Runtime.enable' }));
  await delay(300);

  console.log('--- calling chrome.runtime.reload() ---');
  // keep capture open across reload, like acceptance script does
  await evalIn(sw.webSocketDebuggerUrl, 'chrome.runtime.reload(); "called"').catch((e) => console.log('reload eval err:', e.message));
  await delay(2000);
  await health('t+2s');
  await delay(3000);
  const t2 = await health('t+5s');
  if (t2) {
    const sw2 = t2.find((x) => x.type === 'service_worker' && x.url.includes('src/background.js'));
    console.log('sw after reload (passive):', sw2?.url || 'none yet');
    // Wake the SW by opening an extension page — does onInstalled(update) fire?
    const extId = new URL(sw.url).host;
    await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(`chrome-extension://${extId}/src/options.html`)}`, { method: 'PUT' }).catch((e) => console.log('json/new err:', e.message));
    await delay(1500);
    const t3 = await health('t+6.5s (post-wake)');
    if (t3) {
      const optPage = t3.find((x) => x.type === 'page' && x.url.includes('options.html'));
      console.log('options page target:', optPage?.url || 'none');
      if (optPage) {
        // messaging the runtime wakes the SW and delivers pending onInstalled
        const pong = await evalIn(optPage.webSocketDebuggerUrl, `(async () => {
          if (!chrome?.runtime) { location.reload(); await new Promise(r => setTimeout(r, 1500)); }
          return await new Promise(r => chrome.runtime.sendMessage({type:"gitlab-reference-permissions-ping"}, resp => r(resp)));
        })()`).catch((e) => 'eval err: ' + e.message);
        console.log('ping response:', JSON.stringify(pong));
      }
      await delay(1500);
      const t4 = await health('t+8s');
      const sw3 = t4?.find((x) => x.type === 'service_worker' && x.url.includes('src/background.js'));
      console.log('sw after wake:', sw3?.url || 'none');
      if (sw3) {
        const regs = await evalIn(sw3.webSocketDebuggerUrl, '(async () => (await chrome.scripting.getRegisteredContentScripts()).map(r => r.id))()').catch((e) => 'eval err: ' + e.message);
        console.log('registrations after reload:', JSON.stringify(regs));
        const wakeCap = new WebSocket(sw3.webSocketDebuggerUrl);
        await new Promise((res) => wakeCap.addEventListener('open', res, { once: true }));
        wakeCap.addEventListener('message', (ev) => {
          const m = JSON.parse(String(ev.data));
          if (m.method === 'Runtime.consoleAPICalled') {
            const text = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
            console.log(`[SW console] [${m.params.type}] ${text}`);
          }
        });
        wakeCap.send(JSON.stringify({ id: 11, method: 'Runtime.enable' }));
        await delay(500);
        const regs2 = await evalIn(sw3.webSocketDebuggerUrl, '(async () => (await chrome.scripting.getRegisteredContentScripts()).map(r => r.id))()').catch(() => null);
        console.log('registrations recheck:', JSON.stringify(regs2));
        try { wakeCap.close(); } catch {}
      }
    }
  }
  try { capWs.close(); } catch {}
} finally {
  chromeProc.kill('SIGKILL');
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
