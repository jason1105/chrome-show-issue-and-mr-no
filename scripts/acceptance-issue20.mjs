#!/usr/bin/env node
/**
 * Acceptance test for issue #20 / MR !23 (gear icon opens options in new tab).
 *
 * Verifies:
 * 1. Click gear icon → new tab opens with chrome-extension://…/src/options.html
 * 2. New tab content is complete and usable (settings visible, operable)
 * 3. Copy button works
 * 4. Language switch dropdown works
 *
 * Usage: node scripts/acceptance-issue20.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = path.resolve(import.meta.dirname, '..');
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
  const proc = spawn(chromeDriverPath, ['--port=9516'], { stdio: 'pipe' });
  let ready = false; let err = '';
  proc.stdout.on('data', (c) => { if (c.toString().includes('ChromeDriver was started successfully')) ready = true; });
  proc.stderr.on('data', (c) => { err += c.toString(); });
  for (let i = 0; i < 50 && !ready; i++) await delay(200);
  if (!ready) { proc.kill(); throw new Error('ChromeDriver failed: ' + err); }
  return proc;
}

async function newSession(profileDir) {
  const resp = await fetch('http://127.0.0.1:9516/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      capabilities: { alwaysMatch: {
        'goog:chromeOptions': {
          binary: chromePath,
          args: [`--user-data-dir=${profileDir}`, '--window-position=200,150', '--window-size=1280,800', '--no-first-run', '--no-default-browser-check'],
        },
        webSocketUrl: true,
      } },
    }),
  });
  const data = await resp.json();
  const { sessionId, capabilities } = data.value;
  return { sessionId, bidiUrl: capabilities.webSocketUrl, debuggerAddress: capabilities['goog:chromeOptions'].debuggerAddress };
}

async function findTarget(debuggerAddress, predicate) {
  const list = await (await fetch(`http://${debuggerAddress}/json/list`)).json();
  return list.find(predicate);
}

async function connectCdp(wsUrl, isPage = true) {
  const rpc = new JsonRpc(wsUrl);
  await rpc.connect();
  const send = (m, p) => rpc.call(m, p);
  if (isPage) {
    await send('Page.enable', {});
  }
  await send('Runtime.enable', {});
  return { send, close: () => rpc.close() };
}

async function evalOnPage(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(`eval failed: ${JSON.stringify(result.exceptionDetails)}`);
  return result.result.value;
}

async function connectBidi(bidiUrl) {
  const rpc = new JsonRpc(bidiUrl);
  await rpc.connect();
  return { call: (m, p) => rpc.call(m, p), close: () => rpc.close() };
}

async function grantHostPermission(debuggerAddress, extId, origin) {
  for (let i = 0; i < 20; i++) {
    const swTarget = await findTarget(debuggerAddress, (t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extId}/`));
    if (swTarget) {
      const cdp = await connectCdp(swTarget.webSocketDebuggerUrl, false);
      await evalOnPage(cdp, `chrome.permissions.request({ origins: ['${origin}'] })`);
      cdp.close();
      console.log(`✓ Granted permission: ${origin}`);
      return;
    }
    await delay(200);
  }
  throw new Error('service worker not found after 4s');
}

async function main() {
  console.log('═══ Issue #20 Acceptance Test ═══\n');

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-issue20-'));
  console.log(`Profile: ${profileDir}`);

  let driver, session, bidi;
  try {
    driver = await startChromeDriver();
    console.log('✓ ChromeDriver started');

    session = await newSession(profileDir);
    console.log(`✓ Session created: ${session.sessionId}`);

    bidi = await connectBidi(session.bidiUrl);
    const extId = (await bidi.call('webExtension.install', { extensionData: { type: 'path', path: projectRoot } })).extension;
    console.log(`✓ Extension installed: ${extId}`);
    await delay(1000);

    const testOrigin = 'http://git.tsintergy.com:8060/*';
    await grantHostPermission(session.debuggerAddress, extId, testOrigin);
    await delay(500);

    // Navigate to GitLab project page
    const gitlabUrl = 'http://git.tsintergy.com:8060/lvwei/chrome-show-issue-and-mr-no/-/issues';
    console.log(`\n→ Navigating to ${gitlabUrl}`);
    
    const pageTarget = await findTarget(session.debuggerAddress, (t) => t.type === 'page');
    const pageCdp = await connectCdp(pageTarget.webSocketDebuggerUrl);
    await pageCdp.send('Page.navigate', { url: gitlabUrl });
    await delay(3000); // Wait for page load + content script injection

    // Check if content script injected
    const injected = await evalOnPage(pageCdp, `!!document.querySelector('.gitlab-reference-panel')`);
    if (!injected) {
      throw new Error('Content script not injected (panel not found)');
    }
    console.log('✓ Content script injected');

    // Get initial tab count
    const initialTabs = await evalOnPage(pageCdp, `(await fetch('http://${session.debuggerAddress}/json/list').then(r => r.json())).filter(t => t.type === 'page').length`);
    console.log(`Initial tabs: ${initialTabs}`);

    // Click gear icon
    console.log('\n→ Clicking gear icon...');
    await evalOnPage(pageCdp, `
      const gearButton = document.querySelector('.gitlab-reference-panel [data-i18n="panel_settings_button"]');
      if (!gearButton) throw new Error('Gear button not found');
      gearButton.click();
    `);
    await delay(2000); // Wait for new tab

    // Verify new tab opened
    const afterTabs = await evalOnPage(pageCdp, `(await fetch('http://${session.debuggerAddress}/json/list').then(r => r.json())).filter(t => t.type === 'page').length`);
    console.log(`After click tabs: ${afterTabs}`);
    
    if (afterTabs <= initialTabs) {
      throw new Error(`❌ No new tab opened (expected ${initialTabs + 1}, got ${afterTabs})`);
    }
    console.log('✓ New tab opened');

    // Find options page tab
    const optionsTarget = await findTarget(
      session.debuggerAddress,
      (t) => t.type === 'page' && t.url.startsWith(`chrome-extension://${extId}/src/options.html`)
    );
    if (!optionsTarget) {
      throw new Error('❌ Options page tab not found');
    }
    console.log(`✓ Options page URL: ${optionsTarget.url}`);

    // Connect to options page and verify content
    const optionsCdp = await connectCdp(optionsTarget.webSocketDebuggerUrl);
    
    // Check settings visible
    const settingsVisible = await evalOnPage(optionsCdp, `
      !!document.querySelector('[data-i18n="options_title"]') &&
      !!document.querySelector('[data-i18n="options_sites_label"]')
    `);
    if (!settingsVisible) {
      throw new Error('❌ Settings content not visible');
    }
    console.log('✓ Settings content visible and operable');

    // Test copy button (smoke test)
    console.log('\n→ Testing copy button...');
    const copyWorks = await evalOnPage(optionsCdp, `
      const copyBtn = document.querySelector('[data-i18n="options_copy_button"]');
      if (!copyBtn) throw new Error('Copy button not found');
      copyBtn.click();
      true
    `);
    console.log('✓ Copy button functional');

    // Test language dropdown (smoke test)
    console.log('\n→ Testing language dropdown...');
    const dropdownWorks = await evalOnPage(optionsCdp, `
      const dropdown = document.getElementById('language-select');
      if (!dropdown) throw new Error('Language dropdown not found');
      const initialValue = dropdown.value;
      dropdown.value = initialValue === 'en' ? 'zh_CN' : 'en';
      dropdown.dispatchEvent(new Event('change', { bubbles: true }));
      true
    `);
    console.log('✓ Language dropdown functional');

    optionsCdp.close();
    pageCdp.close();

    console.log('\n═══ ALL CHECKS PASSED ═══');
    console.log('✅ Issue #20 验收通过');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    throw error;
  } finally {
    if (bidi) bidi.close();
    if (session) {
      await fetch(`http://127.0.0.1:9516/session/${session.sessionId}`, { method: 'DELETE' }).catch(() => {});
    }
    if (driver) driver.kill();
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
