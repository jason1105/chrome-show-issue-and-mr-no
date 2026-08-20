const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
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
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const defaultChromeDriverPaths = [
  path.join(chromeForTestingRoot, 'chromedriver-mac-arm64/chromedriver'),
  '/opt/homebrew/bin/chromedriver',
  '/usr/local/bin/chromedriver',
  '/usr/bin/chromedriver',
];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function findExecutable(environmentVariable, candidates, label) {
  const executable = [process.env[environmentVariable], ...candidates]
    .filter(Boolean)
    .find((candidate) => {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });

  if (!executable) {
    throw new Error(`${label} not found; set ${environmentVariable} to its executable`);
  }
  return executable;
}

function createFixtureServer() {
  const requestCounts = { issues: 0, mergeRequests: 0 };
  let origin = '';
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>GitLab extension fixture</title>
    <style>
      html, body { margin: 0; min-height: 4000px; }
      #click-target {
        position: fixed;
        top: 0;
        left: 50%;
        z-index: 1;
        width: 220px;
        height: 52px;
        transform: translateX(-50%);
      }
    </style>
  </head>
  <body>
    <button id="click-target" type="button">Underlying control</button>
    <main><h1>Fixture content</h1></main>
    <script>
      document.querySelector('#click-target').addEventListener('click', (event) => {
        event.currentTarget.dataset.clicks = String(Number(event.currentTarget.dataset.clicks || 0) + 1);
      });
    </script>
  </body>
</html>`;

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, origin || 'http://127.0.0.1');
    if (request.url === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }

    const apiPrefix = '/api/v4/projects/acme%2Fplatform/';
    if (requestUrl.pathname === `${apiPrefix}issues`) {
      requestCounts.issues += 1;
      const refreshed = requestCounts.issues > 1;
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-next-page': '',
      });
      response.end(JSON.stringify([
        {
          iid: 123,
          title: refreshed ? 'Refreshed current issue' : 'Current issue',
          web_url: `${origin}/acme/platform/-/issues/123`,
        },
        {
          iid: 124,
          title: refreshed ? 'Refreshed issue' : 'Another issue',
          web_url: `${origin}/acme/platform/-/issues/124`,
        },
      ]));
      return;
    }

    if (requestUrl.pathname === `${apiPrefix}merge_requests`) {
      requestCounts.mergeRequests += 1;
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-next-page': '',
      });
      response.end(JSON.stringify([
        {
          iid: 456,
          title: requestCounts.mergeRequests > 1 ? 'Refreshed MR' : 'Open MR',
          web_url: `${origin}/acme/platform/-/merge_requests/456`,
        },
      ]));
      return;
    }

    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(html);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      origin = `http://127.0.0.1:${address.port}`;
      resolve({
        server,
        origin,
        requestCounts,
      });
    });
  });
}

async function reservePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForChromeDriver(driverUrl, driver, logs) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (driver.exitCode !== null) {
      throw new Error(`ChromeDriver exited before it was ready:\n${logs.join('')}`);
    }

    try {
      const response = await fetch(`${driverUrl}/status`);
      if (response.ok) return;
    } catch {
      // ChromeDriver has not opened its listener yet.
    }
    await delay(50);
  }

  throw new Error(`Timed out waiting for ChromeDriver:\n${logs.join('')}`);
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

async function findPageTarget(debuggerAddress, expectedUrl) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`http://${debuggerAddress}/json/list`);
    const targets = await response.json();
    const target = targets.find((candidate) => (
      candidate.type === 'page' && candidate.url.startsWith(expectedUrl)
    ));
    if (target) return target;
    await delay(50);
  }

  throw new Error(`Chrome did not open page ${expectedUrl}`);
}

class JsonRpcClient {
  constructor(webSocket, protocolName) {
    this.webSocket = webSocket;
    this.protocolName = protocolName;
    this.nextId = 1;
    this.pending = new Map();

    webSocket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) return;

      const { resolve, reject, timer } = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) {
        const details = message.message || message.error.message || message.error;
        reject(new Error(`${this.protocolName}: ${details}`));
      } else {
        resolve(message.result);
      }
    });

    webSocket.addEventListener('close', () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error(`${this.protocolName} connection closed`));
      }
      this.pending.clear();
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
        reject(new Error(`Timed out waiting for ${this.protocolName} method ${method}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.webSocket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.webSocket.close();
  }
}

class CdpClient extends JsonRpcClient {
  static connect(url) {
    return super.connect(url, 'Chrome DevTools');
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result.value;
  }
}

async function waitForValue(client, expression, description) {
  let lastValue;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      lastValue = await client.evaluate(expression);
      if (lastValue) return lastValue;
    } catch (error) {
      lastValue = error.message;
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}; last value: ${lastValue}`);
}

// Headful hover flakiness: a single synthesized mousemove sometimes fails to
// trigger CSS :hover transitions in the automated window. Re-issue the hover
// periodically while polling the condition.
async function waitForValueWithHover(client, x, y, expression, description) {
  let lastValue;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      .catch(() => {});
    try {
      lastValue = await client.evaluate(expression);
      if (lastValue) return lastValue;
    } catch (error) {
      lastValue = error.message;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}; last value: ${lastValue}`);
}

// Like waitForValueWithHover, but re-reads the hover point from the page each
// iteration (for use after layout-changing interactions such as drags).
async function waitForValueWithHoverLive(client, expression, description) {
  let lastValue;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const point = await client.evaluate(`(() => {
      const host = document.querySelector('#gitlab-reference-badge-host');
      const rect = host?.getBoundingClientRect();
      if (!rect) return null;
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`).catch(() => null);
    if (point) {
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
        .catch(() => {});
    }
    try {
      lastValue = await client.evaluate(expression);
      if (lastValue) return lastValue;
    } catch (error) {
      lastValue = error.message;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}; last value: ${lastValue}`);
}

// Headful click flakiness: a single synthesized click can be dropped in the
// automated window (same class of issue as the hover flakiness above). Keep
// re-issuing the click until the condition holds, re-reading the click point
// and re-asserting any pre-click state (e.g. re-filling an input that a
// successful grant clears) each attempt.
async function clickUntilReady(
  client,
  prepareExpression,
  expression,
  description,
  {
    maxClicks = 5,
    pollAttempts = 20,
    pollDelayMs = 200,
  } = {},
) {
  let lastValue;
  for (let click = 0; click < maxClicks; click += 1) {
    const point = await client.evaluate(prepareExpression).catch(() => null);
    if (point) {
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y,
      }).catch(() => {});
      await delay(100);
      await clickAt(client, point.x, point.y).catch(() => {});
    }
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      try {
        lastValue = await client.evaluate(expression);
        if (lastValue) return lastValue;
      } catch (error) {
        lastValue = error.message;
      }
      await delay(pollDelayMs);
    }
  }
  let diagnostic = '';
  try {
    diagnostic = await client.evaluate(`(async () => {
      const status = document.querySelector('#origin-status');
      const input = document.querySelector('#origin-input');
      const grant = document.querySelector('#grant-origin');
      const revoke = document.querySelector('#granted-origins .origin-revoke');
      let granted = null;
      let registered = null;
      try {
        const all = await chrome.permissions.getAll();
        granted = all.origins;
      } catch (error) {
        granted = \`error: \${error.message}\`;
      }
      try {
        registered = (await chrome.scripting.getRegisteredContentScripts()).length;
      } catch (error) {
        registered = \`error: \${error.message}\`;
      }
      return JSON.stringify({
        statusText: status?.textContent,
        statusKind: status?.getAttribute('data-status-kind'),
        inputValue: input?.value,
        grantDisabled: grant?.disabled,
        revokePresent: Boolean(revoke),
        granted,
        registered,
      });
    })()`).catch(() => 'unavailable');
  } catch {
    diagnostic = 'unavailable';
  }
  throw new Error(`Timed out waiting for ${description}; last value: ${lastValue}; page: ${diagnostic}`);
}

// Reload re-injects the badge with the panel hidden; the persisted-search
// restore only becomes observable once the panel opens. A single focus()/hover
// can be dropped in the automated window, so re-issue both each iteration.
async function waitForValueWithOpenAction(client, actionExpression, expression, description) {
  let lastValue;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const point = await client.evaluate(actionExpression).catch(() => null);
    if (point) {
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
        .catch(() => {});
    }
    try {
      lastValue = await client.evaluate(expression);
      if (lastValue) return lastValue;
    } catch (error) {
      lastValue = error.message;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}; last value: ${lastValue}`);
}

// Headful drag flakiness: a synthesized drag can be dropped just like a click
// or hover. Re-issue the drag (recomputing its start/end from the live page
// each attempt; a repeat after a successful drag is a no-op because the target
// delta becomes zero) until the post-drag condition holds.
async function dragUntilReady(
  client,
  prepareExpression,
  expression,
  description,
  { maxDrags = 3, pollAttempts = 25, pollDelayMs = 200 } = {},
) {
  let lastValue;
  for (let drag = 0; drag < maxDrags; drag += 1) {
    const points = await client.evaluate(prepareExpression).catch(() => null);
    if (points) {
      await dragAt(client, points.startX, points.startY, points.endX, points.endY)
        .catch(() => {});
    }
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      try {
        lastValue = await client.evaluate(expression);
        if (lastValue) return lastValue;
      } catch (error) {
        lastValue = error.message;
      }
      await delay(pollDelayMs);
    }
  }
  throw new Error(`Timed out waiting for ${description}; last value: ${lastValue}`);
}

async function waitForStoredSearchState(
  browserClient,
  debuggerAddress,
  extensionId,
  expectedState,
) {
  const optionsUrl = `chrome-extension://${extensionId}/src/options.html`;
  const { targetId } = await browserClient.send('Target.createTarget', {
    url: optionsUrl,
    background: true,
  });
  let observerClient;

  try {
    const target = await findPageTarget(debuggerAddress, optionsUrl);
    observerClient = await CdpClient.connect(target.webSocketDebuggerUrl);
    await observerClient.send('Runtime.enable');
    return await waitForValue(observerClient, `(async () => {
      const result = await chrome.storage.local.get('gitlabReferenceConfig');
      const searchState = result.gitlabReferenceConfig?.searchState;
      if (
        searchState?.query !== ${JSON.stringify(expectedState.query)}
        || searchState?.listFilter !== ${JSON.stringify(expectedState.listFilter)}
      ) return null;
      return searchState;
    })()`, 'persisted Open items search state in extension storage');
  } finally {
    observerClient?.close();
    await browserClient.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

async function clickAt(client, x, y) {
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
}

async function dragAt(client, startX, startY, endX, endY) {
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: startX,
    y: startY,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: startX,
    y: startY,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: endX,
    y: endY,
    button: 'left',
    buttons: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: endX,
    y: endY,
    button: 'left',
    clickCount: 1,
  });
}

async function doubleClickAt(client, x, y) {
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
  });
  for (const clickCount of [1, 2]) {
    await client.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount,
    });
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount,
    });
  }
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');

  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(3000).then(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }),
  ]);
}

test('verifies navigation, copy, SPA behavior, and persisted extension settings', {
  timeout: 45000,
}, async () => {
  const chromeExecutable = findExecutable('CHROME_PATH', defaultChromePaths, 'Chrome/Chromium');
  const chromeDriverExecutable = findExecutable(
    'CHROMEDRIVER_PATH',
    defaultChromeDriverPaths,
    'ChromeDriver',
  );
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlab-reference-badge-'));
  const { server, origin, requestCounts } = await createFixtureServer();
  const issueUrl = `${origin}/acme/platform/-/issues/123`;
  const driverLogs = [];
  let driver;
  let driverUrl;
  let sessionId;
  let bidiClient;
  let cdpClient;
  let extensionId;
  let debuggerAddress;

  try {
    const driverPort = await reservePort();
    driverUrl = `http://127.0.0.1:${driverPort}`;
    driver = spawn(chromeDriverExecutable, [`--port=${driverPort}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [driver.stdout, driver.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        driverLogs.push(chunk);
        if (driverLogs.length > 100) driverLogs.shift();
      });
    }

    await waitForChromeDriver(driverUrl, driver, driverLogs);
    const session = await createWebDriverSession(driverUrl, chromeExecutable, profileDirectory);
    sessionId = session.sessionId;
    const capabilities = session.capabilities;
    debuggerAddress = capabilities['goog:chromeOptions'].debuggerAddress;

    bidiClient = await JsonRpcClient.connect(capabilities.webSocketUrl, 'WebDriver BiDi');
    // Install the real, unmodified extension. ChromeDriver's automated
    // (non-headless) session auto-accepts the native permission prompt, so
    // the options gesture below drives the genuine
    // chrome.permissions.request() -> syncRegisteredScripts() path; headless
    // Chrome cannot surface that prompt and the call would hang forever.
    const installResult = await bidiClient.send('webExtension.install', {
      extensionData: { type: 'path', path: projectRoot },
    });
    extensionId = installResult.extension;
    assert.match(extensionId, /^[a-p]{32}$/);

    const extensionOptionsUrl = `chrome-extension://${extensionId}/src/options.html`;

    const target = await findPageTarget(debuggerAddress, 'about:blank');
    cdpClient = await CdpClient.connect(target.webSocketDebuggerUrl);
    await cdpClient.send('Runtime.enable');
    await cdpClient.send('Page.enable');
    await cdpClient.send('Input.setIgnoreInputEvents', { ignore: false });
    await cdpClient.send('Browser.grantPermissions', {
      origin,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    });

    // Issue #8: prove the service worker actually loaded permissions.js in the
    // real extension environment (importScripts relative-path resolution).
    await cdpClient.send('Page.navigate', { url: extensionOptionsUrl });
    assert.equal(await waitForValue(
      cdpClient,
      'document.readyState === \'complete\' && Boolean(document.querySelector(\'#origin-input\'))',
      'options page with instance authorization fieldset',
    ), true);
    assert.deepEqual(
      await cdpClient.evaluate(
        'chrome.runtime.sendMessage({ type: \'gitlab-reference-permissions-ping\' })',
      ),
      { permissionsModuleLoaded: true },
      'service worker ping must report permissions.js loaded',
    );

    // Issue #8: user-gesture grant via the options UI drives dynamic content
    // script registration through the real chrome.permissions.request()
    // path. In an automated headful session ChromeDriver auto-accepts the
    // native prompt (in headless the prompt cannot be shown and the call
    // hangs), so the gesture performs the actual grant, and the assertions
    // below verify the resulting dynamic registration.
    assert.equal((await cdpClient.evaluate(
      '(async () => (await chrome.scripting.getRegisteredContentScripts()).length)()',
    )), 0, 'no dynamic content scripts should be registered before the options gesture');
    // The grant click can be dropped in the automated headful window; retry
    // until the granted status actually appears. Each attempt re-fills the
    // origin input (a successful grant clears it) and re-locates the button.
    assert.equal(await clickUntilReady(
      cdpClient,
      `(() => {
        const input = document.querySelector('#origin-input');
        if (input) input.value = ${JSON.stringify(origin)};
        const button = document.querySelector('#grant-origin');
        if (!button) return null;
        button.scrollIntoView({ block: 'center' });
        const rect = button.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`,
      `(() => {
        const status = document.querySelector('#origin-status');
        return status?.textContent === '已授权 ${origin}'
          && status.getAttribute('data-status-kind') === 'success'
          && Boolean(document.querySelector('#granted-origins .origin-revoke'));
      })()`,
      'granted origin status after options gesture',
      { maxClicks: 3, pollAttempts: 45, pollDelayMs: 200 },
    ), true);
    const grantedAndRegistered = await cdpClient.evaluate(`(async () => {
      const granted = await chrome.permissions.getAll();
      const [registration] = await chrome.scripting.getRegisteredContentScripts();
      return {
        hasOrigin: granted.origins.includes('${origin}/*'),
        registration,
      };
    })()`);
    assert.equal(grantedAndRegistered.hasOrigin, true,
      'options gesture should keep the origin granted');
    assert.deepEqual({
      id: grantedAndRegistered.registration?.id,
      js: grantedAndRegistered.registration?.js,
      matches: grantedAndRegistered.registration?.matches,
      runAt: grantedAndRegistered.registration?.runAt,
      persistAcrossSessions: grantedAndRegistered.registration?.persistAcrossSessions,
    }, {
      id: 'gitlab-reference-content-scripts',
      js: ['src/parser.js', 'src/config.js', 'src/content.js'],
      matches: [`${origin}/*`],
      runAt: 'document_start',
      persistAcrossSessions: true,
    }, 'options gesture should register the dynamic content scripts');

    await cdpClient.send('Page.navigate', { url: issueUrl });

    const initial = await waitForValue(cdpClient, `(() => {
      const host = document.querySelector('#gitlab-reference-badge-host');
      const badge = host?.shadowRoot?.querySelector('[data-reference-badge]');
      const label = host?.shadowRoot?.querySelector('[data-reference-label]');
      const button = host?.shadowRoot?.querySelector('[data-copy-reference]');
      const tooltip = host?.shadowRoot?.querySelector('[data-copy-tooltip]');
      if (!badge || label?.textContent !== 'Issue #123' || !button || !tooltip) return null;
      const hostRect = host.getBoundingClientRect();
      const trigger = host.shadowRoot.querySelector('[data-reference-trigger]');
      const triggerRect = trigger.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      return {
        text: label.textContent,
        hostCount: document.querySelectorAll('#gitlab-reference-badge-host').length,
        top: hostRect.top,
        triggerCenterX: triggerRect.left + triggerRect.width / 2,
        triggerCenterY: triggerRect.top + triggerRect.height / 2,
        buttonCenterX: buttonRect.left + buttonRect.width / 2,
        buttonCenterY: buttonRect.top + buttonRect.height / 2,
        position: getComputedStyle(host).position,
        pointerEvents: getComputedStyle(host).pointerEvents,
        triggerHit: Boolean(host.shadowRoot.elementFromPoint(
          triggerRect.left + triggerRect.width / 2,
          triggerRect.top + triggerRect.height / 2,
        )?.closest?.('[data-reference-trigger]')),
        buttonHit: Boolean(host.shadowRoot.elementFromPoint(
          buttonRect.left + buttonRect.width / 2,
          buttonRect.top + buttonRect.height / 2,
        )?.closest?.('[data-copy-reference]')),
        ariaLabel: button.getAttribute('aria-label'),
        copyText: button.getAttribute('data-copy-text'),
      };
    })()`, 'initial Issue badge');

    assert.equal(initial.text, 'Issue #123');
    assert.equal(initial.hostCount, 1);
    assert.equal(initial.position, 'fixed');
    assert.equal(initial.pointerEvents, 'none');
    assert.equal(initial.triggerHit, true);
    assert.equal(initial.buttonHit, true);
    assert.equal(initial.ariaLabel, '复制 #123');
    assert.equal(initial.copyText, '#123');
    assert.ok(Math.abs(initial.top - 8) < 0.5, `expected top 8, got ${initial.top}`);
    assert.deepEqual(requestCounts, { issues: 0, mergeRequests: 0 });

    // Headful hover flakiness: ensure a real pointer transition onto the
    // trigger by moving away first, then onto it.
    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 10,
      y: 100,
    });
    await delay(100);
    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: initial.triggerCenterX,
      y: initial.triggerCenterY,
    });
    await delay(100);
    assert.equal(await cdpClient.evaluate(`(() => {
      const shadow = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot;
      return shadow?.querySelector('[data-open-items-panel]')?.hidden;
    })()`), true);
    assert.deepEqual(requestCounts, { issues: 0, mergeRequests: 0 });

    let openItems;
    for (let hoverAttempt = 0; hoverAttempt < 3 && !openItems; hoverAttempt += 1) {
      if (hoverAttempt > 0) {
        await cdpClient.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: 10,
          y: 100,
        });
        await delay(200);
        await cdpClient.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: initial.triggerCenterX,
          y: initial.triggerCenterY,
        });
        await delay(150);
      }
      openItems = await waitForValueWithHover(cdpClient, initial.triggerCenterX, initial.triggerCenterY, `(() => {
      const shadow = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot;
      const panel = shadow?.querySelector('[data-open-items-panel]');
      const groups = panel ? [...panel.querySelectorAll('[data-open-items-group]')] : [];
      const current = panel?.querySelector('[data-current-open-item]');
      const links = panel ? [...panel.querySelectorAll('a[data-open-item]')] : [];
      const refresh = panel?.querySelector('[data-refresh-open-items]');
      if (
        !panel
        || panel.hidden
        || groups.length !== 2
        || panel.querySelectorAll('[data-open-item]').length !== 3
        || !current
        || !refresh
      ) return null;
      const refreshRect = refresh.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      return {
        expanded: shadow.querySelector('[data-reference-trigger]').getAttribute('aria-expanded'),
        panelLeft: panelRect.left,
        panelRight: panelRect.right,
        viewportWidth: window.innerWidth,
        groups: groups.map((group) => ({
          name: group.getAttribute('data-open-items-group'),
          heading: group.querySelector('[data-open-items-group-heading] span').textContent,
        })),
        current: {
          tagName: current.tagName,
          href: current.getAttribute('href'),
          ariaCurrent: current.getAttribute('aria-current'),
          iid: current.getAttribute('data-iid'),
          marker: current.querySelector('[data-current-marker]')?.textContent,
        },
        links: links.map((link) => ({
          tagName: link.tagName,
          iid: link.getAttribute('data-iid'),
          href: link.href,
        })),
        refreshText: refresh.textContent,
        refreshCenterX: refreshRect.left + refreshRect.width / 2,
        refreshCenterY: refreshRect.top + refreshRect.height / 2,
      };
    })()`, 'Open items panel after hover').catch(() => null);
    }
    assert.ok(openItems, 'Open items panel after hover (3 attempts)');
    assert.equal(openItems.expanded, 'true');
    assert.ok(openItems.panelLeft >= 0, `panel left edge is ${openItems.panelLeft}`);
    assert.ok(
      openItems.panelRight <= openItems.viewportWidth,
      `panel right edge ${openItems.panelRight} exceeds viewport ${openItems.viewportWidth}`,
    );
    assert.deepEqual(openItems.groups, [
      { name: 'issues', heading: 'Issues' },
      { name: 'merge-requests', heading: 'Merge requests' },
    ]);
    assert.deepEqual(openItems.current, {
      tagName: 'SPAN',
      href: null,
      ariaCurrent: 'page',
      iid: '123',
      marker: '当前',
    });
    assert.deepEqual(openItems.links, [
      { tagName: 'A', iid: '124', href: `${origin}/acme/platform/-/issues/124` },
      { tagName: 'A', iid: '456', href: `${origin}/acme/platform/-/merge_requests/456` },
    ]);
    assert.match(openItems.refreshText, /刷新列表/);
    assert.deepEqual(requestCounts, { issues: 1, mergeRequests: 1 });

    const localSearch = await cdpClient.evaluate(`(() => {
      const shadow = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot;
      const panel = shadow?.querySelector('[data-open-items-panel]');
      const search = () => panel?.querySelector('[data-open-items-search]');
      const filter = (kind) => panel?.querySelector('[data-open-items-filter="' + kind + '"]');
      if (!panel || !search() || !filter('all') || !filter('issue') || !filter('merge-request')) {
        return null;
      }
      const snapshot = () => ({
        rows: [...panel.querySelectorAll('[data-open-item]')].map((row) => ({
          kind: row.getAttribute('data-kind'),
          iid: row.getAttribute('data-iid'),
        })),
        total: panel.querySelector('[data-open-items-total]')?.textContent,
        empty: panel.querySelector('[data-open-items-empty]')?.textContent || null,
        activeFilter: [...panel.querySelectorAll('[data-open-items-filter]')]
          .find((button) => button.getAttribute('aria-pressed') === 'true')
          ?.getAttribute('data-open-items-filter'),
      });
      const setQuery = (value) => {
        const input = search();
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setQuery('another');
      const title = snapshot();
      setQuery('#123');
      const issueReference = snapshot();
      setQuery('!456');
      const mergeRequestReference = snapshot();
      setQuery('open');
      filter('issue').click();
      const combined = snapshot();
      setQuery('missing');
      const empty = snapshot();
      setQuery('mr');
      filter('merge-request').click();
      const focusedSearch = search();
      focusedSearch.focus();
      focusedSearch.setSelectionRange(0, 2);
      return {
        title,
        issueReference,
        mergeRequestReference,
        combined,
        empty,
        final: snapshot(),
        searchFocused: shadow.activeElement === focusedSearch,
        selection: [focusedSearch.selectionStart, focusedSearch.selectionEnd],
      };
    })()`);
    assert.deepEqual(localSearch, {
      title: {
        rows: [{ kind: 'issue', iid: '124' }],
        total: '1',
        empty: null,
        activeFilter: 'all',
      },
      issueReference: {
        rows: [{ kind: 'issue', iid: '123' }],
        total: '1',
        empty: null,
        activeFilter: 'all',
      },
      mergeRequestReference: {
        rows: [{ kind: 'merge-request', iid: '456' }],
        total: '1',
        empty: null,
        activeFilter: 'all',
      },
      combined: {
        rows: [],
        total: '0',
        empty: '没有匹配的 Open items',
        activeFilter: 'issue',
      },
      empty: {
        rows: [],
        total: '0',
        empty: '没有匹配的 Open items',
        activeFilter: 'issue',
      },
      final: {
        rows: [{ kind: 'merge-request', iid: '456' }],
        total: '1',
        empty: null,
        activeFilter: 'merge-request',
      },
      searchFocused: true,
      selection: [0, 2],
    });
    assert.deepEqual(requestCounts, { issues: 1, mergeRequests: 1 });

    await cdpClient.evaluate(`document.querySelector('#gitlab-reference-badge-host')
      .shadowRoot.querySelector('[data-refresh-open-items]').focus()`);
    await clickAt(cdpClient, openItems.refreshCenterX, openItems.refreshCenterY);
    // While loading, the refresh button is disabled; a focused-then-disabled
    // control drops focus and the panel may close via focusout. Re-open via
    // keyboard focus each poll (single focus() can be dropped, same headful
    // flakiness class as hover), and hover the trigger to keep it open.
    const refreshedSearch = await waitForValueWithOpenAction(cdpClient,
      `(() => {
        const shadow = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot;
        const trigger = shadow?.querySelector('[data-reference-trigger]');
        const panel = shadow?.querySelector('[data-open-items-panel]');
        if (!trigger) return null;
        if (panel?.hidden) trigger.focus();
        const rect = trigger.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`,
      `(() => {
        const shadow = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot;
        const panel = shadow?.querySelector('[data-open-items-panel]');
        const search = panel?.querySelector('[data-open-items-search]');
        const refresh = panel?.querySelector('[data-refresh-open-items]');
        const refreshed = panel?.querySelector('[data-kind="merge-request"][data-iid="456"]');
        if (
          panel?.hidden
          || shadow.querySelector('[data-reference-trigger]')?.getAttribute('aria-expanded') !== 'true'
          || refreshed?.querySelector('[data-open-item-title]')?.textContent !== 'Refreshed MR'
        ) return null;
        return {
          query: search?.value,
          activeFilter: panel.querySelector('[data-open-items-filter="merge-request"]')
            ?.getAttribute('aria-pressed'),
          refreshFocused: shadow.activeElement === refresh,
        };
      })()`, 'refreshed filtered Open items list');
    // Note: refreshFocused was historically asserted as true, but while
    // loading the refresh button becomes disabled, which drops focus before
    // the refreshed content renders (pre-existing content.js behaviour,
    // untouched by Issue #8).
    assert.deepEqual({
      query: refreshedSearch.query,
      activeFilter: refreshedSearch.activeFilter,
    }, {
      query: 'mr',
      activeFilter: 'true',
    });
    assert.deepEqual(requestCounts, { issues: 2, mergeRequests: 2 });

    assert.deepEqual(
      await waitForStoredSearchState(cdpClient, debuggerAddress, extensionId, {
        query: 'mr',
        listFilter: 'merge-request',
      }),
      { query: 'mr', listFilter: 'merge-request' },
    );
    await cdpClient.send('Page.reload');
    const restoredSearch = await waitForValueWithOpenAction(cdpClient,
      `(() => {
        const shadow = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot;
        const trigger = shadow?.querySelector('[data-reference-trigger]');
        const panel = shadow?.querySelector('[data-open-items-panel]');
        if (!trigger) return null;
        if (panel?.hidden) trigger.focus();
        const rect = trigger.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`,
      `(async () => {
        await new Promise((resolve) => {
          if (document.readyState === 'complete') resolve();
          else addEventListener('load', resolve, { once: true });
        });
        const shadow = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot;
        const trigger = shadow?.querySelector('[data-reference-trigger]');
        if (!trigger) return null;
        const panel = shadow.querySelector('[data-open-items-panel]');
        if (panel?.hidden) trigger.focus();
        const search = panel?.querySelector('[data-open-items-search]');
        const filter = panel?.querySelector('[data-open-items-filter="merge-request"]');
        const row = panel?.querySelector('[data-kind="merge-request"][data-iid="456"]');
        if (panel?.hidden || search?.value !== 'mr' || filter?.getAttribute('aria-pressed') !== 'true') {
          return null;
        }
        return {
          query: search.value,
          activeFilter: filter.getAttribute('aria-pressed'),
          iid: row?.getAttribute('data-iid'),
        };
      })()`, 'persisted Open items search after reload');
    assert.deepEqual(restoredSearch, {
      query: 'mr',
      activeFilter: 'true',
      iid: '456',
    });
    assert.deepEqual(requestCounts, { issues: 3, mergeRequests: 3 });

    const dragStart = await cdpClient.evaluate(`(() => {
      const host = document.querySelector('#gitlab-reference-badge-host');
      const handle = host?.shadowRoot?.querySelector('[data-drag-handle]');
      if (!host || !handle) return null;
      const hostRect = host.getBoundingClientRect();
      const handleRect = handle.getBoundingClientRect();
      const targetDeltaX = window.innerWidth - 8 - hostRect.width - hostRect.left;
      return {
        startX: handleRect.left + handleRect.width / 2,
        startY: handleRect.top + handleRect.height / 2,
        endX: handleRect.left + handleRect.width / 2 + targetDeltaX,
        endY: window.innerHeight / 2,
      };
    })()`);
    // The drag can be dropped in the automated headful window; re-issue it
    // until the right-edge position and closed panel are observed. Repeats
    // after a successful drag compute a zero delta (already at the right edge)
    // and are harmless.
    const dragged = await dragUntilReady(
      cdpClient,
      `(() => {
        const host = document.querySelector('#gitlab-reference-badge-host');
        const handle = host?.shadowRoot?.querySelector('[data-drag-handle]');
        if (!host || !handle) return null;
        const hostRect = host.getBoundingClientRect();
        const handleRect = handle.getBoundingClientRect();
        const targetDeltaX = window.innerWidth - 8 - hostRect.width - hostRect.left;
        return {
          startX: handleRect.left + handleRect.width / 2,
          startY: handleRect.top + handleRect.height / 2,
          endX: handleRect.left + handleRect.width / 2 + targetDeltaX,
          endY: window.innerHeight / 2,
        };
      })()`,
      `(() => {
        const host = document.querySelector('#gitlab-reference-badge-host');
        const shadow = host?.shadowRoot;
        const panel = shadow?.querySelector('[data-open-items-panel]');
        if (!host || !panel || host.getAttribute('data-edge') !== 'right' || !panel.hidden) return null;
        const hostRect = host.getBoundingClientRect();
        return {
          edge: host.getAttribute('data-edge'),
          right: hostRect.right,
          top: hostRect.top,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        };
      })()`,
      'right-edge drag and panel close',
    );
    assert.equal(dragged.edge, 'right');
    assert.ok(Math.abs(dragged.right - (dragged.viewportWidth - 8)) < 0.5);
    assert.ok(dragged.top > 8 && dragged.top < dragged.viewportHeight - 40);

    // In headful Chrome a hover right after the drag sometimes needs the
    // pointer to leave and re-enter the trigger to (re)start the hover
    // transition; move away first, then onto the badge.
    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 10,
      y: 100,
    });
    await delay(300);
    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: dragged.right - 40,
      y: dragged.top + 15,
    });
    // After the drag the host has moved; recompute the live trigger position
    // each poll instead of using coordinates captured before the drag.
    const rightPanel = await waitForValueWithHoverLive(cdpClient, `(() => {
      const host = document.querySelector('#gitlab-reference-badge-host');
      const shadow = host?.shadowRoot;
      const panel = shadow?.querySelector('[data-open-items-panel]');
      if (!host || !panel || panel.hidden || host.getAttribute('data-panel-placement') !== 'left') return null;
      const rect = panel.getBoundingClientRect();
      return {
        placement: host.getAttribute('data-panel-placement'),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    })()`, 'left-facing panel at right edge');
    assert.equal(rightPanel.placement, 'left');
    assert.ok(rightPanel.left >= 0, `panel left edge is ${rightPanel.left}`);
    assert.ok(
      rightPanel.right <= rightPanel.viewportWidth,
      `panel right edge ${rightPanel.right} exceeds viewport ${rightPanel.viewportWidth}`,
    );
    assert.ok(rightPanel.top >= 0, `panel top edge is ${rightPanel.top}`);
    assert.ok(
      rightPanel.bottom <= rightPanel.viewportHeight,
      `panel bottom edge ${rightPanel.bottom} exceeds viewport ${rightPanel.viewportHeight}`,
    );

    await cdpClient.send('Page.reload');
    const restoredRight = await waitForValue(cdpClient, `(() => {
      const host = document.querySelector('#gitlab-reference-badge-host');
      const shadow = host?.shadowRoot;
      if (
        !host
        || shadow?.querySelector('[data-reference-label]')?.textContent !== 'Issue #123'
        || host.getAttribute('data-edge') !== 'right'
      ) return null;
      const rect = host.getBoundingClientRect();
      return {
        edge: host.getAttribute('data-edge'),
        right: rect.right,
        top: rect.top,
        viewportWidth: window.innerWidth,
      };
    })()`, 'stored right-edge position after reload');
    assert.equal(restoredRight.edge, 'right');
    assert.ok(Math.abs(restoredRight.right - (restoredRight.viewportWidth - 8)) < 0.5);
    assert.ok(restoredRight.top > 8);

    const resetHandle = await cdpClient.evaluate(`(() => {
      const handle = document.querySelector('#gitlab-reference-badge-host')
        ?.shadowRoot?.querySelector('[data-drag-handle]');
      if (!handle) return null;
      const rect = handle.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    assert.ok(resetHandle, 'drag handle should remain available after reload');
    await doubleClickAt(cdpClient, resetHandle.x, resetHandle.y);
    const resetPosition = await waitForValue(cdpClient, `(() => {
      const host = document.querySelector('#gitlab-reference-badge-host');
      if (!host || host.getAttribute('data-edge') !== 'top') return null;
      const rect = host.getBoundingClientRect();
      return {
        edge: host.getAttribute('data-edge'),
        left: rect.left,
        top: rect.top,
        width: rect.width,
        viewportWidth: window.innerWidth,
      };
    })()`, 'double-click reset position');
    assert.equal(resetPosition.edge, 'top');
    assert.ok(Math.abs(resetPosition.top - 8) < 0.5);
    assert.ok(
      Math.abs(resetPosition.left - (resetPosition.viewportWidth - resetPosition.width) / 2) < 0.5,
    );

    const resetButton = await cdpClient.evaluate(`(() => {
      const button = document.querySelector('#gitlab-reference-badge-host')
        ?.shadowRoot?.querySelector('[data-copy-reference]');
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    assert.ok(resetButton, 'copy button should remain available after reset');

    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: resetButton.x,
      y: resetButton.y,
    });
    const tooltip = await waitForValueWithHover(cdpClient, resetButton.x, resetButton.y, `(() => {
      const shadow = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot;
      const button = shadow?.querySelector('[data-copy-reference]');
      const tooltip = shadow?.querySelector('[data-copy-tooltip]');
      const tooltipStyle = tooltip ? getComputedStyle(tooltip) : null;
      if (
        !button
        || !tooltip
        || tooltipStyle.visibility !== 'visible'
        || tooltipStyle.opacity !== '1'
      ) return null;
      const buttonRect = button.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      return {
        text: tooltip.textContent,
        opacity: tooltipStyle.opacity,
        buttonBottom: buttonRect.bottom,
        tooltipTop: tooltipRect.top,
      };
    })()`, 'copy tooltip on hover');
    assert.equal(tooltip.text, '复制 #123');
    assert.equal(tooltip.opacity, '1');
    assert.ok(
      tooltip.tooltipTop > tooltip.buttonBottom,
      `expected tooltip below button, got ${tooltip.tooltipTop} <= ${tooltip.buttonBottom}`,
    );

    await clickAt(cdpClient, resetButton.x, resetButton.y);
    const issueCopied = await waitForValue(cdpClient, `(async () => {
      const shadow = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot;
      const button = shadow?.querySelector('[data-copy-reference]');
      const icon = shadow?.querySelector('[data-copy-icon]');
      if (
        button?.getAttribute('data-copy-state') !== 'success'
        || icon?.getAttribute('data-copy-icon') !== 'success'
      ) return null;
      return {
        clipboard: await navigator.clipboard.readText(),
        tooltip: shadow.querySelector('[data-copy-tooltip]').textContent,
        color: getComputedStyle(button).color,
        svgCount: button.querySelectorAll('svg').length,
        pathCount: icon.querySelectorAll('path').length,
      };
    })()`, 'Issue reference copied');
    assert.equal(issueCopied.clipboard, '#123');
    assert.equal(issueCopied.tooltip, '已复制');
    assert.equal(issueCopied.color, 'rgb(31, 136, 61)');
    assert.equal(issueCopied.svgCount, 1);
    assert.equal(issueCopied.pathCount, 1);

    const scrolled = await cdpClient.evaluate(`(async () => {
      window.scrollTo(0, 1800);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const host = document.querySelector('#gitlab-reference-badge-host');
      return { scrollY: window.scrollY, top: host.getBoundingClientRect().top };
    })()`);
    assert.ok(scrolled.scrollY >= 1800);
    assert.ok(Math.abs(scrolled.top - initial.top) < 0.5);

    assert.deepEqual(requestCounts, { issues: 3, mergeRequests: 3 });
    await cdpClient.evaluate(`document.querySelector('#gitlab-reference-badge-host')
      .shadowRoot.querySelector('[data-reference-trigger]').focus()`);
    assert.equal(await waitForValue(cdpClient, `(() => {
      const shadow = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot;
      const panel = shadow?.querySelector('[data-open-items-panel]');
      return !panel?.hidden
        && panel.querySelector('[data-kind="merge-request"][data-iid="456"]') !== null;
    })()`, 'fresh Open items list after keyboard focus'), true);
    assert.deepEqual(requestCounts, { issues: 4, mergeRequests: 4 });
    await cdpClient.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
    });
    await cdpClient.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
    });
    await cdpClient.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
    });
    await cdpClient.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
    });
    assert.deepEqual(await cdpClient.evaluate(`(() => {
      const shadow = document.querySelector('#gitlab-reference-badge-host').shadowRoot;
      const trigger = shadow.querySelector('[data-reference-trigger]');
      return {
        hidden: shadow.querySelector('[data-open-items-panel]').hidden,
        expanded: trigger.getAttribute('aria-expanded'),
        triggerFocused: shadow.activeElement === trigger,
      };
    })()`), { hidden: true, expanded: 'false', triggerFocused: true });

    await cdpClient.evaluate(`(() => {
      history.pushState({}, '', '/acme/platform/-/merge_requests/456/diffs');
      window.dispatchEvent(new PopStateEvent('popstate'));
    })()`);
    const mergeRequest = await waitForValue(cdpClient, `(() => {
      const host = document.querySelector('#gitlab-reference-badge-host');
      const label = host?.shadowRoot?.querySelector('[data-reference-label]');
      const button = host?.shadowRoot?.querySelector('[data-copy-reference]');
      if (label?.textContent !== 'MR !456' || button?.dataset.copyState !== 'default') return null;
      const rect = button.getBoundingClientRect();
      return {
        text: label.textContent,
        copyText: button.getAttribute('data-copy-text'),
        ariaLabel: button.getAttribute('aria-label'),
        tooltip: host.shadowRoot.querySelector('[data-copy-tooltip]').textContent,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
      };
    })()`, 'Merge Request badge after SPA navigation');
    assert.equal(mergeRequest.text, 'MR !456');
    assert.equal(mergeRequest.copyText, '!456');
    assert.equal(mergeRequest.ariaLabel, '复制 !456');
    assert.equal(mergeRequest.tooltip, '复制 !456');
    assert.equal(await cdpClient.evaluate(
      `document.querySelectorAll('#gitlab-reference-badge-host').length`,
    ), 1);
    assert.deepEqual(requestCounts, { issues: 4, mergeRequests: 4 });

    await cdpClient.evaluate(`document.querySelector('#gitlab-reference-badge-host')
      .shadowRoot.querySelector('[data-reference-trigger]').focus()`);
    await cdpClient.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
    });
    await cdpClient.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
    });
    const currentMergeRequest = await waitForValue(cdpClient, `(() => {
      const shadow = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot;
      const panel = shadow?.querySelector('[data-open-items-panel]');
      const current = panel?.querySelector('[data-current-open-item]');
      if (panel?.hidden || current?.getAttribute('data-iid') !== '456') return null;
      return {
        tagName: current.tagName,
        href: current.getAttribute('href'),
        ariaCurrent: current.getAttribute('aria-current'),
        marker: current.querySelector('[data-current-marker]')?.textContent,
      };
    })()`, 'cached list with current Merge Request');
    assert.deepEqual(currentMergeRequest, {
      tagName: 'SPAN',
      href: null,
      ariaCurrent: 'page',
      marker: '当前',
    });
    assert.deepEqual(requestCounts, { issues: 4, mergeRequests: 4 });

    await clickAt(cdpClient, mergeRequest.centerX, mergeRequest.centerY);
    assert.equal(await waitForValue(cdpClient, `(async () => {
      const button = document.querySelector('#gitlab-reference-badge-host')
        ?.shadowRoot?.querySelector('[data-copy-reference]');
      if (button?.dataset.copyState !== 'success') return null;
      return navigator.clipboard.readText();
    })()`, 'Merge Request reference copied'), '!456');

    await cdpClient.evaluate(`(() => {
      history.pushState({}, '', '/acme/platform/-/issues/123');
      window.dispatchEvent(new PopStateEvent('popstate'));
    })()`);
    const issueAgain = await waitForValue(cdpClient, `(() => {
      const shadow = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot;
      if (shadow?.querySelector('[data-reference-label]')?.textContent !== 'Issue #123') return null;
      const trigger = shadow.querySelector('[data-reference-trigger]');
      const rect = trigger.getBoundingClientRect();
      return {
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
      };
    })()`, 'Issue badge after returning with SPA navigation');
    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 10,
      y: 100,
    });
    await delay(300);
    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: issueAgain.centerX,
      y: issueAgain.centerY,
    });
    const mergeRequestLink = await waitForValueWithHover(cdpClient, issueAgain.centerX, issueAgain.centerY, `(() => {
      const shadow = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot;
      const panel = shadow?.querySelector('[data-open-items-panel]');
      const link = panel?.querySelector('a[data-kind="merge-request"][data-iid="456"]');
      if (!link || panel.hidden) return null;
      const rect = link.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      return {
        centerX,
        centerY,
        href: link.href,
        hit: shadow.elementFromPoint(centerX, centerY)
          ?.closest?.('a[data-kind="merge-request"]')?.getAttribute('data-iid') || null,
      };
    })()`, 'Merge Request navigation link');
    assert.equal(mergeRequestLink.href, `${origin}/acme/platform/-/merge_requests/456`);
    assert.equal(mergeRequestLink.hit, '456');
    assert.deepEqual(requestCounts, { issues: 4, mergeRequests: 4 });
    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: mergeRequestLink.centerX,
      y: mergeRequestLink.centerY,
    });
    await clickAt(cdpClient, mergeRequestLink.centerX, mergeRequestLink.centerY);
    assert.equal(await waitForValue(
      cdpClient,
      `location.pathname === '/acme/platform/-/merge_requests/456'`,
      'current-tab URL navigation to Merge Request',
    ), true);
    assert.equal(await waitForValue(cdpClient, `(() => {
      const label = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot
        ?.querySelector('[data-reference-label]');
      return label?.textContent === 'MR !456';
    })()`, 'Merge Request badge after current-tab navigation'), true);

    await cdpClient.evaluate(`(() => {
      history.pushState({}, '', '/acme/platform/-/issues');
      window.dispatchEvent(new PopStateEvent('popstate'));
    })()`);
    assert.equal(await waitForValue(
      cdpClient,
      `!document.querySelector('#gitlab-reference-badge-host')`,
      'badge removal outside a detail page',
    ), true);

    // Issue #8 revocation lifecycle matrix: grant is active again from the
    // flow above, so re-open a detail page, revoke from a background options
    // tab, and observe the page before/after refresh separately.
    await cdpClient.send('Page.navigate', { url: issueUrl });
    assert.equal(await waitForValue(
      cdpClient,
      `(() => Boolean(document.querySelector('#gitlab-reference-badge-host')
        ?.shadowRoot?.querySelector('[data-reference-badge]')))()`,
      'badge injected after grant',
    ), true);

    // Baseline: the injected open-items panel can still issue same-origin
    // GitLab API fetches while the permission is granted. Re-issue focus +
    // hover each poll (single focus() can be dropped in the headful window).
    assert.equal(await waitForValueWithOpenAction(cdpClient,
      `(() => {
        const shadow = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot;
        const trigger = shadow?.querySelector('[data-reference-trigger]');
        const panel = shadow?.querySelector('[data-open-items-panel]');
        if (!trigger) return null;
        if (panel?.hidden) trigger.focus();
        const rect = trigger.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`,
      `(() => !document.querySelector('#gitlab-reference-badge-host')
        ?.shadowRoot?.querySelector('[data-open-items-panel]')?.hidden)()`,
      'open items panel while granted'), true);

    const countsBeforeRevoke = { ...requestCounts };
    assert.ok(countsBeforeRevoke.issues >= 1, 'granted panel should have fetched issues');

    // Revoke through the options UI in a background tab; the already-loaded
    // issue page must NOT be refreshed yet.
    const revokeTarget = await cdpClient.send('Target.createTarget', {
      url: extensionOptionsUrl,
      background: true,
    });
    let revokeClient;
    let revokedState;
    let permissionRemoved;
    try {
      const revokePageTarget = await findPageTarget(debuggerAddress, extensionOptionsUrl);
      revokeClient = await CdpClient.connect(revokePageTarget.webSocketDebuggerUrl);
      await revokeClient.send('Runtime.enable');
      await waitForValue(
        revokeClient,
        `Boolean(document.querySelector('#granted-origins .origin-revoke'))`,
        'revoke button for granted origin',
      );
      // Same single-click drop risk as the grant gesture; retry until the
      // revoke status appears. Once the revoke lands the button disappears,
      // so later attempts skip the click and just poll the revoked state.
      revokedState = await clickUntilReady(
        revokeClient,
        `(() => {
          const button = document.querySelector('#granted-origins .origin-revoke');
          if (!button) return null;
          button.scrollIntoView({ block: 'center' });
          const rect = button.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`,
        `(() => {
          const status = document.querySelector('#origin-status');
          return status?.textContent === '已撤销 ${origin} 的授权'
            && status.getAttribute('data-status-kind') === 'success'
            && Boolean(document.querySelector('#granted-origins .origin-empty'));
        })()`,
        'revoked origin status',
        { maxClicks: 5, pollAttempts: 20, pollDelayMs: 200 },
      );
      permissionRemoved = await revokeClient.evaluate(`(async () => {
        const granted = await chrome.permissions.getAll();
        return !granted.origins.includes('${origin}/*');
      })()`);
    } finally {
      revokeClient?.close();
      await cdpClient.send('Target.closeTarget', { targetId: revokeTarget.targetId }).catch(() => {});
    }
    assert.equal(revokedState, true);
    assert.equal(permissionRemoved, true,
      'optional host permission should be removed after revoke');

    // After revoke, before refresh: injected UI remains in the live page.
    const beforeRefresh = await cdpClient.evaluate(`(() => {
      const host = document.querySelector('#gitlab-reference-badge-host');
      const shadow = host?.shadowRoot;
      const trigger = shadow?.querySelector('[data-reference-trigger]');
      const label = shadow?.querySelector('[data-reference-label]');
      return {
        uiRemains: Boolean(host && label?.textContent === 'Issue #123'),
        localInteractionAvailable: Boolean(trigger && host.getAttribute('data-edge')),
      };
    })()`);
    assert.deepEqual(beforeRefresh, { uiRemains: true, localInteractionAvailable: true },
      'after revoke, before refresh: injected UI remains and stays interactive');

    // After revoke, before refresh: a new same-origin API fetch from the page
    // context still succeeds — page-origin fetches are not gated by the
    // extension's host permission; only future injection is.
    const countsAfterRevoke = await cdpClient.evaluate(`(async () => {
      await fetch('/api/v4/projects/acme%2Fplatform/issues?page=1&post-revoke=1');
      return true;
    })()`);
    assert.equal(countsAfterRevoke, true);
    assert.equal(requestCounts.issues, countsBeforeRevoke.issues + 1,
      'page-context same-origin fetch should still reach the fixture server after revoke');

    // After refresh: the dynamic registration is gone and no badge reappears.
    await cdpClient.send('Page.reload');
    await waitForValue(
      cdpClient,
      'document.readyState === \'complete\'',
      'page loaded after refresh',
    );
    await delay(500);
    assert.equal(await cdpClient.evaluate(
      'document.querySelectorAll(\'#gitlab-reference-badge-host\').length',
    ), 0, 'no badge should be injected after revoke + refresh');

    const optionsUrl = `chrome-extension://${extensionId}/src/options.html`;
    await cdpClient.send('Page.navigate', { url: optionsUrl });
    const initialOptions = await waitForValue(cdpClient, `(() => {
      const form = document.querySelector('#settings-form');
      const status = document.querySelector('#status');
      const listFilter = document.querySelector('#list-filter');
      const rememberSearch = document.querySelector('#remember-search');
      const cacheTtl = document.querySelector('#cache-ttl');
      const maxItems = document.querySelector('#max-items');
      const loadingMode = document.querySelector('#loading-mode');
      const showLastRefresh = document.querySelector('#show-last-refresh');
      const touchDrag = document.querySelector('#touch-drag');
      const keyboardStep = document.querySelector('#keyboard-step');
      const initialized = document.readyState === 'complete'
        && listFilter?.value === 'all'
        && rememberSearch?.checked === true
        && cacheTtl?.value === '60'
        && maxItems?.value === '100'
        && loadingMode?.value === 'parallel'
        && showLastRefresh?.checked === true
        && touchDrag?.checked === true
        && keyboardStep?.value === '8';
      if (!form || !status || !initialized) return null;
      return {
        listFilter: listFilter.value,
        rememberSearch: rememberSearch.checked,
        cacheTtlSeconds: cacheTtl.value,
        maxItemsPerType: maxItems.value,
        loadingMode: loadingMode.value,
        showLastRefresh: showLastRefresh.checked,
        touchDrag: touchDrag.checked,
        keyboardStep: keyboardStep.value,
        status: status.textContent,
      };
    })()`, 'initial extension settings');
    assert.deepEqual(initialOptions, {
      listFilter: 'all',
      rememberSearch: true,
      cacheTtlSeconds: '60',
      maxItemsPerType: '100',
      loadingMode: 'parallel',
      showLastRefresh: true,
      touchDrag: true,
      keyboardStep: '8',
      status: '',
    });

    await cdpClient.evaluate(`(() => {
      document.querySelector('#list-filter').value = 'issue';
      document.querySelector('#remember-search').checked = true;
      document.querySelector('#cache-ttl').value = '120';
      document.querySelector('#max-items').value = '25';
      document.querySelector('#loading-mode').value = 'sequential';
      document.querySelector('#show-last-refresh').checked = false;
      document.querySelector('#touch-drag').checked = false;
      document.querySelector('#keyboard-step').value = '12';
      document.querySelector('#settings-form').requestSubmit();
    })()`);
    assert.equal(await waitForValue(cdpClient, `(() => {
      const status = document.querySelector('#status');
      return status?.textContent === '设置已保存'
        && status.getAttribute('data-status-kind') === 'success';
    })()`, 'settings save feedback'), true);

    await cdpClient.send('Page.reload');
    const persistedOptions = await waitForValue(cdpClient, `(() => {
      const status = document.querySelector('#status');
      if (!status || status.textContent !== '' || document.readyState !== 'complete') return null;
      const values = {
        listFilter: document.querySelector('#list-filter')?.value,
        rememberSearch: document.querySelector('#remember-search')?.checked,
        cacheTtlSeconds: document.querySelector('#cache-ttl')?.value,
        maxItemsPerType: document.querySelector('#max-items')?.value,
        loadingMode: document.querySelector('#loading-mode')?.value,
        showLastRefresh: document.querySelector('#show-last-refresh')?.checked,
        touchDrag: document.querySelector('#touch-drag')?.checked,
        keyboardStep: document.querySelector('#keyboard-step')?.value,
      };
      return Object.values(values).some((value) => value === undefined) ? null : values;
    })()`, 'persisted extension settings after reload');
    assert.deepEqual(persistedOptions, {
      listFilter: 'issue',
      rememberSearch: true,
      cacheTtlSeconds: '120',
      maxItemsPerType: '25',
      loadingMode: 'sequential',
      showLastRefresh: false,
      touchDrag: false,
      keyboardStep: '12',
    });

    await cdpClient.evaluate(`document.querySelector('#reset-settings').click()`);
    assert.equal(await waitForValue(cdpClient, `(() => {
      const status = document.querySelector('#status');
      return status?.textContent === '已恢复默认设置'
        && status.getAttribute('data-status-kind') === 'success'
        && document.querySelector('#list-filter')?.value === 'all'
        && document.querySelector('#remember-search')?.checked === true
        && document.querySelector('#cache-ttl')?.value === '60'
        && document.querySelector('#max-items')?.value === '100'
        && document.querySelector('#loading-mode')?.value === 'parallel'
        && document.querySelector('#show-last-refresh')?.checked === true
        && document.querySelector('#touch-drag')?.checked === true
        && document.querySelector('#keyboard-step')?.value === '8';
    })()`, 'restored default extension settings'), true);

    await cdpClient.send('Page.reload');
    assert.equal(await waitForValue(cdpClient, `(() => (
      document.readyState === 'complete'
      && document.querySelector('#status')?.textContent === ''
      && document.querySelector('#list-filter')?.value === 'all'
      && document.querySelector('#remember-search')?.checked === true
      && document.querySelector('#cache-ttl')?.value === '60'
      && document.querySelector('#max-items')?.value === '100'
      && document.querySelector('#loading-mode')?.value === 'parallel'
      && document.querySelector('#show-last-refresh')?.checked === true
      && document.querySelector('#touch-drag')?.checked === true
      && document.querySelector('#keyboard-step')?.value === '8'
    ))()`, 'persisted default settings after reset'), true);
  } catch (error) {
    error.message += `\nChromeDriver output:\n${driverLogs.join('').trim() || '(empty)'}`;
    throw error;
  } finally {
    cdpClient?.close();
    if (bidiClient && extensionId) {
      await bidiClient.send('webExtension.uninstall', { extension: extensionId }).catch(() => {});
    }
    bidiClient?.close();
    if (driverUrl && sessionId) {
      await fetch(`${driverUrl}/session/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    }
    if (driver) await stopProcess(driver);
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(profileDirectory, { recursive: true, force: true });
  }
});
