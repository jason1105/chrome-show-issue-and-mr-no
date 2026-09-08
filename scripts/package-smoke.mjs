#!/usr/bin/env node
/**
 * Smoke test for #18 packaging: load the PACKAGED directory (dist/chrome-show-issue-and-mr-no)
 * as an unpacked extension and verify the options page loads correctly.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = path.resolve(import.meta.dirname, '..');
const extDir = process.argv[2] || path.join(projectRoot, 'dist', 'chrome-show-issue-and-mr-no');
const chromeForTestingRoot = path.join(os.homedir(), 'Library/Caches/chrome-for-testing/150.0.7871.124');
const chromePath = path.join(chromeForTestingRoot, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const chromeDriverPath = path.join(chromeForTestingRoot, 'chromedriver-mac-arm64/chromedriver');

class JsonRpc {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); this.ws = null; }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(e));
      this.ws.addEventListener('message', (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id !== undefined && this.pending.has(m.id)) {
          const { resolve: res, reject: rej } = this.pending.get(m.id);
          this.pending.delete(m.id);
          m.error ? rej(new Error(m.error.message || JSON.stringify(m.error))) : res(m.result);
        }
      });
    });
  }
  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { if (this.ws) this.ws.close(); }
}

async function startChromeDriver() {
  const proc = spawn(chromeDriverPath, ['--port=9519'], { stdio: 'pipe' });
  let ready = false;
  proc.stdout.on('data', (c) => { if (c.toString().includes('ChromeDriver was started successfully')) ready = true; });
  for (let i = 0; i < 50 && !ready; i++) await delay(200);
  if (!ready) { proc.kill(); throw new Error('ChromeDriver failed to start'); }
  return proc;
}

async function evalOnPage(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(`eval failed: ${JSON.stringify(result.exceptionDetails)}`);
  return result.result.value;
}

async function connectCdp(wsUrl) {
  const rpc = new JsonRpc(wsUrl);
  await rpc.connect();
  const send = (m, p) => rpc.call(m, p);
  await send('Page.enable');
  await send('Runtime.enable');
  return { send, close: () => rpc.close() };
}

async function main() {
  console.log(`═══ #18 Packaging Smoke Test ═══`);
  console.log(`Extension dir: ${extDir}\n`);
  if (!fs.existsSync(path.join(extDir, 'manifest.json'))) throw new Error('manifest.json missing');

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-pkgsmoke-'));
  let driver, session, bidi, pageCdp;
  try {
    driver = await startChromeDriver();
    console.log('✓ ChromeDriver started');
    const resp = await fetch('http://127.0.0.1:9519/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilities: { alwaysMatch: {
        'goog:chromeOptions': { binary: chromePath, args: [`--user-data-dir=${profileDir}`, '--window-size=1280,800', '--no-first-run', '--no-default-browser-check'] },
        webSocketUrl: true,
      } } }),
    });
    const data = await resp.json();
    session = { id: data.value.sessionId, bidiUrl: data.value.capabilities.webSocketUrl, debuggerAddress: data.value.capabilities['goog:chromeOptions'].debuggerAddress };
    console.log('✓ Session created');

    bidi = new JsonRpc(session.bidiUrl);
    await bidi.connect();
    const extId = (await bidi.call('webExtension.install', { extensionData: { type: 'path', path: extDir } })).extension;
    console.log(`✓ Packaged extension installed: ${extId}`);

    const optionsUrl = `chrome-extension://${extId}/src/options.html`;
    const list = await (await fetch(`http://${session.debuggerAddress}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    pageCdp = await connectCdp(page.webSocketDebuggerUrl);
    await pageCdp.send('Page.navigate', { url: optionsUrl });
    await delay(3000);

    const readyState = await evalOnPage(pageCdp, 'document.readyState');
    const langSelect = await evalOnPage(pageCdp, `!!document.getElementById('language-select')`);
    const hasSettings = await evalOnPage(pageCdp, `document.body.textContent.includes('Settings')`);
    const manifest = await evalOnPage(pageCdp, `fetch(chrome.runtime.getURL('manifest.json')).then(r => r.json()).then(m => m.version + '|' + m.name)`);
    const nameResolved = await evalOnPage(pageCdp, `chrome.i18n.getMessage('extName')`);

    console.log(`  readyState=${readyState} langSelect=${langSelect} hasSettings=${hasSettings}`);
    console.log(`  manifest version|name = ${manifest}`);
    console.log(`  i18n extName = ${nameResolved}`);

    if (readyState !== 'complete' || !langSelect || !hasSettings) throw new Error('options page failed smoke check');
    if (!nameResolved) throw new Error('i18n extName not resolved');

    console.log('\n═══ SMOKE TEST PASSED ═══');
  } finally {
    if (pageCdp) pageCdp.close();
    if (bidi) bidi.close();
    if (session?.id) await fetch(`http://127.0.0.1:9519/session/${session.id}`, { method: 'DELETE' }).catch(() => {});
    if (driver) driver.kill();
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
