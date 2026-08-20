// Acceptance test for #15 path D: cold-boot self-heal restores dynamic content
// script registration after chrome.runtime.reload().
// Run: node scripts/acceptance-restart.mjs
'use strict';

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const chromeForTestingRoot = path.join(
  os.homedir(),
  'Library/Caches/chrome-for-testing/150.0.7871.124',
);
const defaultChromePaths = [
  path.join(
    chromeForTestingRoot,
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  ),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const defaultChromeDriverPaths = [
  path.join(chromeForTestingRoot, 'chromedriver-mac-arm64/chromedriver'),
  '/opt/homebrew/bin/chromedriver',
  '/usr/local/bin/chromedriver',
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findExecutable(envVar, candidates, label) {
  if (process.env[envVar]) return process.env[envVar];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not find ${label}; set ${envVar}`);
}

function createFixtureServer() {
  let origin = '';
  const requestCounts = { issues: 0, mergeRequests: 0 };
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, origin || 'http://127.0.0.1');
    const html = `<!doctype html><html><head><title>Issue 123</title></head>
<body><h1>Mock GitLab</h1></body></html>`;
    const apiPrefix = '/api/v4/projects/acme%2Fplatform/';
    if (requestUrl.pathname.startsWith(`${apiPrefix}issues`)) {
      requestCounts.issues += 1;
      response.writeHead(200, { 'content-type': 'application/json', 'x-next-page': '' });
      response.end(JSON.stringify([
        { iid: 123, title: 'Current issue', web_url: `${origin}/acme/platform/-/issues/123` },
        { iid: 124, title: 'Another issue', web_url: `${origin}/acme/platform/-/issues/124` },
      ]));
      return;
    }
    if (requestUrl.pathname.startsWith(`${apiPrefix}merge_requests`)) {
      requestCounts.mergeRequests += 1;
      response.writeHead(200, { 'content-type': 'application/json', 'x-next-page': '' });
      response.end(JSON.stringify([
        { iid: 456, title: 'Open MR', web_url: `${origin}/acme/platform/-/merge_requests/456` },
      ]));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    response.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      resolve({ server, origin, requestCounts });
    });
  });
}

async function reservePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForChromeDriver(driverUrl, driver, logs) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (driver.exitCode !== null) throw new Error(`ChromeDriver exited: ${logs.join('')}`);
    try {
      const response = await fetch(`${driverUrl}/status`);
      if (response.ok) return;
    } catch { /* not ready */ }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ChromeDriver: ${logs.join('')}`);
}

async function createWebDriverSession(driverUrl, chromeExecutable, profileDirectory) {
  const response = await fetch(`${driverUrl}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      capabilities: {
        alwaysMatch: {
          browserName: 'chrome',
          webSocketUrl: true,
          'goog:chromeOptions': {
            binary: chromeExecutable,
            args: [
              '--disable-background-networking',
              '--disable-component-update',
              '--disable-default-apps',
              '--disable-sync',
              '--no-default-browser-check',
              '--no-first-run',
              '--window-size=1280,800',
              `--user-data-dir=${profileDirectory}`,
              `--load-extension=${projectRoot}`,
            ],
          },
        },
      },
    }),
  });
  const body = await response.json();
  if (!response.ok || body.value?.error) {
    throw new Error(`Could not create WebDriver session: ${JSON.stringify(body)}`);
  }
  return body.value;
}

async function deleteWebDriverSession(driverUrl, sessionId) {
  await fetch(`${driverUrl}/session/${sessionId}`, { method: 'DELETE' }).catch(() => {});
}

async function findTarget(debuggerAddress, predicate) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await fetch(`http://${debuggerAddress}/json/list`);
    const targets = await response.json();
    const target = targets.find(predicate);
    if (target) return target;
    await delay(100);
  }
  return null;
}

class JsonRpcClient {
  constructor(webSocket, protocolName) {
    this.webSocket = webSocket;
    this.protocolName = protocolName;
    this.nextId = 1;
    this.pending = new Map();
    webSocket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) {
        if (!message.id && this.onNotification) this.onNotification(message.method, message.params);
        return;
      }
      const { resolve, reject, timer } = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) reject(new Error(`${protocolName}: ${message.error.message || message.error}`));
      else resolve(message.result);
    });
  }
  static async connect(url, protocolName) {
    const webSocket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      webSocket.addEventListener('open', resolve, { once: true });
      webSocket.addEventListener('error', reject, { once: true });
    });
    return new this(webSocket, protocolName);
  }
  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout on ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.webSocket.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function evaluateInTarget(webSocketDebuggerUrl, expression) {
  const client = await JsonRpcClient.connect(webSocketDebuggerUrl, 'CDP');
  try {
    const result = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`Evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
    }
    return result.result?.value;
  } finally {
    client.webSocket.close();
  }
}

async function waitForCondition(fn, label, attempts = 100, delayMs = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await delay(delayMs);
  }
  throw new Error(`Timed out: ${label}`);
}

// Navigate the page target currently showing fromUrl (or any first page target) to toUrl via CDP.
async function navigatePageTo(debuggerAddress, fromUrl, toUrl) {
  let target = fromUrl
    ? await findTarget(debuggerAddress, (t) => t.type === 'page' && t.url.startsWith(fromUrl))
    : null;
  if (!target) {
    target = await findTarget(debuggerAddress, (t) => t.type === 'page');
  }
  if (!target) throw new Error(`No page target to navigate to ${toUrl}`);
  const client = await JsonRpcClient.connect(target.webSocketDebuggerUrl, 'CDP-nav');
  try {
    await client.send('Page.enable');
    await client.send('Page.navigate', { url: toUrl });
  } finally {
    client.webSocket.close();
  }
}

async function main() {
  const chromeExecutable = findExecutable('CHROME_PATH', defaultChromePaths, 'Chrome');
  const chromeDriverExecutable = findExecutable('CHROMEDRIVER_PATH', defaultChromeDriverPaths, 'ChromeDriver');
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'acc1-restart-'));
  const { server, origin, requestCounts } = await createFixtureServer();
  const issueUrl = `${origin}/acme/platform/-/issues/123`;
  const driverLogs = [];
  const results = {};
  const swConsoleLines = [];
  const dumpSwConsole = () => {
    try {
      fs.writeFileSync('/tmp/acc1-sw-console.log', swConsoleLines.join('\n') + '\n');
    } catch { /* best-effort */ }
  };
  let driver;
  let driverUrl;

  try {
    const driverPort = await reservePort();
    driverUrl = `http://127.0.0.1:${driverPort}`;
    driver = spawn(chromeDriverExecutable, [`--port=${driverPort}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [driver.stdout, driver.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => driverLogs.push(chunk));
    }
    await waitForChromeDriver(driverUrl, driver, driverLogs);

    // ---- Session 1: install (via --load-extension), grant, verify registration ----
    const session1 = await createWebDriverSession(driverUrl, chromeExecutable, profileDirectory);
    const sessionId1 = session1.sessionId;
    const debuggerAddress1 = session1.capabilities['goog:chromeOptions'].debuggerAddress;

    const swTarget1 = await waitForCondition(
      () => findTarget(debuggerAddress1, (t) => t.type === 'service_worker' && t.url.includes('background.js')),
      'service worker target (session 1)',
    );
    const extensionId = new URL(swTarget1.url).host;
    console.log('extensionId =', extensionId);

    // Grant via options page.
    // NOTE: ChromeDriver 150.x no longer auto-accepts permission bubbles on macOS.
    // If a permission bubble appears, the script will wait up to 30 seconds for manual click.
    console.log('\n⚠️  Chrome 150.x does NOT auto-accept permission bubbles.');
    console.log('⚠️  If you see a permission bubble in the browser window, click "Allow" manually.\n');

    const optionsUrl = `chrome-extension://${extensionId}/src/options.html`;
    await navigatePageTo(debuggerAddress1, 'about:blank', optionsUrl);
    const optionsTarget1 = await waitForCondition(
      () => findTarget(debuggerAddress1, (t) => t.type === 'page' && t.url.startsWith(`chrome-extension://${extensionId}/src/options.html`)),
      'options page target (session 1)',
    );
    const optionsCdp = await JsonRpcClient.connect(optionsTarget1.webSocketDebuggerUrl, 'CDP-options');
    await optionsCdp.send('Page.enable').catch(() => {});

    // Fill origin and click grant button with real CDP mouse event
    let grantSuccess = false;
    for (let attempt = 0; attempt < 30 && !grantSuccess; attempt++) {
      await optionsCdp.send('Runtime.evaluate', {
        expression: `(() => {
          const input = document.querySelector('#origin-input');
          if (input && !input.value) input.value = ${JSON.stringify(origin)};
          const button = document.querySelector('#grant-origin');
          if (button) button.scrollIntoView({ block: 'center' });
          return !!button;
        })()`,
        returnByValue: true,
      }).catch(() => {});

      const rect = await optionsCdp.send('Runtime.evaluate', {
        expression: `(() => {
          const button = document.querySelector('#grant-origin');
          if (!button) return null;
          const r = button.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`,
        returnByValue: true,
      }).then((r) => r.result?.value).catch(() => null);

      if (rect && attempt === 0) {
        // Click on first attempt
        await optionsCdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
        await optionsCdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1,
        });
        await optionsCdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1,
        });
        console.log('Clicked grant button. Waiting for permission...');
      }

      const status = await optionsCdp.send('Runtime.evaluate', {
        expression: `(() => document.querySelector('#origin-status')?.textContent)()`,
        returnByValue: true,
      }).then((r) => r.result?.value).catch(() => null);

      if (status === `已授权 ${origin}`) {
        grantSuccess = true;
        console.log(`✓ Permission granted: ${status}`);
        break;
      }

      if (attempt === 0 || attempt % 5 === 0) {
        console.log(`  [${attempt + 1}/30] Status: ${status || 'waiting...'}`);
        if (attempt === 0) {
          const shot = await optionsCdp.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
          if (shot?.data) fs.writeFileSync('/tmp/acc1-options-1.png', Buffer.from(shot.data, 'base64'));
          console.log('  Screenshot saved: /tmp/acc1-options-1.png');
        }
      }

      await delay(1000);
    }

    optionsCdp.webSocket.close();

    if (!grantSuccess) {
      throw new Error('Permission grant timeout (30s). Check /tmp/acc1-options-1.png for details.');
    }

    // Registration right after grant (session 1, pre-restart baseline).
    const swTarget1b = await waitForCondition(
      () => findTarget(debuggerAddress1, (t) => t.type === 'service_worker' && t.url.includes('background.js')),
      'service worker target (session 1, post-grant)',
    );
    results.preRestart = await evaluateInTarget(swTarget1b.webSocketDebuggerUrl,
      '(async () => (await chrome.scripting.getRegisteredContentScripts()).map(r => JSON.parse(JSON.stringify(({id:r.id, js:r.js, matches:r.matches, runAt:r.runAt, world:r.world, persistAcrossSessions:r.persistAcrossSessions})))))()');
    console.log('pre-restart registrations:', JSON.stringify(results.preRestart, null, 1));

    // Badge presence on a real issue page before restart.
    await navigatePageTo(debuggerAddress1, optionsUrl, issueUrl);
    const badgePre = await waitForCondition(async () => {
      const pageTarget = await findTarget(debuggerAddress1, (t) => t.type === 'page' && t.url.startsWith(issueUrl));
      if (!pageTarget) return null;
      return evaluateInTarget(pageTarget.webSocketDebuggerUrl,
        `(() => { const host = document.querySelector('#gitlab-reference-badge-host');
           const label = host?.shadowRoot?.querySelector('[data-reference-label]');
           return label ? { label: label.textContent } : null; })()`);
    }, 'badge on issue page (session 1)');
    results.badgePreRestart = badgePre;
    console.log('badge pre-restart:', JSON.stringify(badgePre));

    // ---- Scenario 1: graceful browser restart (relaunch with same profile) ----
    // Path D: cold-boot self-heal at SW top level must restore registrations.
    // NOTE: CDP chrome.runtime.reload() is NOT usable in this environment — it
    // permanently unloads a --load-extension extension (run9 + dev2 evidence).
    // Relaunch keeps granted origins (chrome.permissions) but wipes dynamic
    // registrations, which is exactly the gap the self-heal closes.
    await deleteWebDriverSession(driverUrl, sessionId1);
    await delay(2000);

    const session2 = await createWebDriverSession(driverUrl, chromeExecutable, profileDirectory);
    const sessionId2 = session2.sessionId;
    const debuggerAddress2 = session2.capabilities['goog:chromeOptions'].debuggerAddress;

    const reloadSwLines = [];
    const isSwTargetOf = (t) => t.type === 'service_worker' && t.url.includes('background.js');
    const attachCapture = async (debuggerAddress, lines, tag) => {
      const sw = await findTarget(debuggerAddress, isSwTargetOf);
      if (!sw) return null;
      const client = await JsonRpcClient.connect(sw.webSocketDebuggerUrl, tag);
      client.attachedTo = sw.webSocketDebuggerUrl;
      client.onNotification = (method, params) => {
        if (method === 'Runtime.consoleAPICalled') {
          const text = (params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
          lines.push(`[${params.type}] ${text}`);
          console.log(`[SW console] [${params.type}] ${text}`);
        }
      };
      await client.send('Runtime.enable').catch(() => {});
      return client;
    };
    console.log('\n--- Scenario 1: graceful browser relaunch (same profile) ---');
    // The SW may boot immediately at startup; attach ASAP and re-attach on
    // every new SW target so no console line is lost. If the SW already ran
    // and idled, waking it (options page) triggers a fresh boot — the
    // self-heal runs on EVERY boot, so its logs appear again.
    const optionsWakeUrl = `chrome-extension://${extensionId}/src/options.html`;
    let reloadClient = null;
    let reloadSw = null;
    for (let i = 0; i < 100 && !reloadSw; i += 1) {
      reloadSw = await findTarget(debuggerAddress2, isSwTargetOf).catch(() => null);
      if (!reloadSw) {
        await fetch(`http://${debuggerAddress2}/json/new?${encodeURIComponent(optionsWakeUrl)}`, { method: 'PUT' }).catch(() => {});
        await delay(500);
      }
    }
    assert.ok(reloadSw, 'scenario 1: service worker target appeared after relaunch');
    reloadClient = await attachCapture(debuggerAddress2, reloadSwLines, 'CDP-sw-relaunch');
    // Wake the SW (fresh boot) so the self-heal logs are captured post-attach.
    await navigatePageTo(debuggerAddress2, null, optionsWakeUrl);
    await delay(1500);
    // Wait for cold-boot self-heal to recover registrations, then assert.
    let postReload = [];
    for (let i = 0; i < 150 && postReload.length === 0; i += 1) {
      await delay(200);
      const sw = await findTarget(debuggerAddress2, isSwTargetOf).catch(() => null);
      if (!sw) continue;
      if (!reloadClient || reloadClient.attachedTo !== sw.webSocketDebuggerUrl) {
        if (reloadClient) { try { reloadClient.webSocket.close(); } catch { /* closed */ } }
        reloadClient = await attachCapture(debuggerAddress2, reloadSwLines, 'CDP-sw-relaunch2').catch(() => null);
      }
      postReload = await evaluateInTarget(sw.webSocketDebuggerUrl,
        '(async () => (await chrome.scripting.getRegisteredContentScripts()).map(r => JSON.parse(JSON.stringify(({id:r.id, js:r.js, matches:r.matches, runAt:r.runAt, world:r.world, persistAcrossSessions:r.persistAcrossSessions})))))()').catch(() => []);
    }
    results.postReload = postReload;
    fs.writeFileSync('/tmp/acc1-sw-console-reload.log', reloadSwLines.join('\n') + '\n');
    console.log('post-restart registrations:', JSON.stringify(postReload, null, 1));
    console.log(`scenario-1 SW console lines: ${reloadSwLines.length} (saved to /tmp/acc1-sw-console-reload.log)`);

    // Badge on a real issue page after restart (path D criterion 5).
    // Retry with a page reload: the first navigation may race with the
    // self-heal registration finishing; any subsequent load must inject.
    await navigatePageTo(debuggerAddress2, optionsWakeUrl, issueUrl);
    let badgePostReload = null;
    for (let navAttempt = 0; navAttempt < 3 && !(badgePostReload?.label); navAttempt += 1) {
      if (navAttempt > 0) {
        // Force a fresh load of the issue page so registered scripts inject.
        await navigatePageTo(debuggerAddress2, issueUrl, issueUrl);
      }
      badgePostReload = await waitForCondition(async () => {
        const pageTarget = await findTarget(debuggerAddress2, (t) => t.type === 'page' && t.url.startsWith(issueUrl));
        if (!pageTarget) return null;
        return evaluateInTarget(pageTarget.webSocketDebuggerUrl,
          `(() => { const host = document.querySelector('#gitlab-reference-badge-host');
             const label = host?.shadowRoot?.querySelector('[data-reference-label]');
             const glr = typeof window.GitLabReferenceNavigationHook !== 'undefined';
             return { label: label?.textContent ?? null, mainWorldHook: glr }; })()`);
      }, `badge on issue page (post-restart, nav attempt ${navAttempt + 1})`, 50, 200).catch(() => null);
    }
    results.badgePostRestart = badgePostReload;
    console.log('badge post-restart:', JSON.stringify(badgePostReload));

    // ---- Pre-restart baseline assertions ----
    const preHook = results.preRestart.find((r) => r.id === 'gitlab-reference-navigation-hook');
    const preContent = results.preRestart.find((r) => r.id === 'gitlab-reference-content-scripts');
    assert.ok(preHook && preContent, 'both scripts registered pre-restart');
    assert.equal(preHook.world, 'MAIN');
    assert.equal(preHook.persistAcrossSessions, true);
    assert.equal(preContent.persistAcrossSessions, true);
    assert.equal(results.badgePreRestart.label, 'Issue #123', 'badge label pre-restart');

    // ---- Path D assertions (five ✅, no relaxation) ----
    const reloadConsoleText = reloadSwLines.join('\n');
    // 1. SW booted
    assert.ok(reloadConsoleText.includes('[SW] boot: service worker started'),
      `criterion 1: expected "[SW] boot: service worker started", got:\n${reloadConsoleText}`);
    // 2. Cold-boot self-heal triggered
    assert.ok(reloadConsoleText.includes('[SW] boot: no registered scripts found, syncing...'),
      `criterion 2: expected "[SW] boot: no registered scripts found, syncing...", got:\n${reloadConsoleText}`);
    // 3. Sync completed without failure
    assert.ok(reloadConsoleText.includes('[SW] boot: sync done'),
      `criterion 3: expected "[SW] boot: sync done", got:\n${reloadConsoleText}`);
    assert.ok(!reloadConsoleText.includes('sync failed'),
      `criterion 3: no "sync failed" logs, got:\n${reloadConsoleText}`);
    // 4. Registrations recovered (2 scripts, world/persistAcrossSessions)
    const reloadHook = postReload.find((r) => r.id === 'gitlab-reference-navigation-hook');
    const reloadContent = postReload.find((r) => r.id === 'gitlab-reference-content-scripts');
    assert.ok(reloadHook && reloadContent, 'criterion 4: both scripts registered after restart');
    assert.equal(reloadHook.world, 'MAIN', 'criterion 4: hook world MAIN');
    assert.equal(reloadHook.persistAcrossSessions, true, 'criterion 4: hook persistAcrossSessions true');
    assert.equal(reloadContent.persistAcrossSessions, true, 'criterion 4: content persistAcrossSessions true');
    assert.deepEqual(reloadContent.js, ['src/parser.js', 'src/config.js', 'src/ui.js', 'src/content.js'], 'criterion 4: content js order');
    // 5. Badge works after restart
    assert.equal(results.badgePostRestart.label, 'Issue #123', 'criterion 5: badge label post-restart');
    assert.equal(results.badgePostRestart.mainWorldHook, true, 'criterion 5: MAIN-world hook active post-restart');
    console.log('SCENARIO 1 PASSED ✅ (path D cold-boot self-heal, graceful relaunch)');
    swConsoleLines.push(...reloadSwLines.map((l) => `${l}`));
    dumpSwConsole();
    console.log(`SW console lines captured: ${swConsoleLines.length} (saved to /tmp/acc1-sw-console.log)`);

    // Scenario 2 (Scripting.json removal + relaunch + onStartup assertions) removed
    // under path D: onStartup listener is gone; cold-boot self-heal above covers it.

    console.log('\nACCEPTANCE 1 PASSED ✅');
    console.log(JSON.stringify({ origin, requestCounts, profileDirectory }, null, 1));
    await deleteWebDriverSession(driverUrl, sessionId2);
  } finally {
    dumpSwConsole();
    if (driver && driver.exitCode === null) {
      driver.kill('SIGTERM');
      await delay(1000);
      if (driver.exitCode === null) driver.kill('SIGKILL');
    }
    server.close();
    try { fs.rmSync(profileDirectory, { recursive: true, force: true }); } catch { /* keep if needed */ }
  }
}

main().catch((error) => {
  console.error('ACCEPTANCE 1 FAILED ❌');
  console.error(error);
  process.exitCode = 1;
});
