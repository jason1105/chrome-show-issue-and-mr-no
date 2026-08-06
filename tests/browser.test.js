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
              '--headless=new',
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

test('navigates current-project open items while preserving copy and SPA behavior', {
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

    bidiClient = await JsonRpcClient.connect(capabilities.webSocketUrl, 'WebDriver BiDi');
    const installResult = await bidiClient.send('webExtension.install', {
      extensionData: { type: 'path', path: projectRoot },
    });
    extensionId = installResult.extension;
    assert.match(extensionId, /^[a-p]{32}$/);

    const target = await findPageTarget(
      capabilities['goog:chromeOptions'].debuggerAddress,
      'about:blank',
    );
    cdpClient = await CdpClient.connect(target.webSocketDebuggerUrl);
    await cdpClient.send('Runtime.enable');
    await cdpClient.send('Page.enable');
    await cdpClient.send('Input.setIgnoreInputEvents', { ignore: false });
    await cdpClient.send('Browser.grantPermissions', {
      origin,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    });
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

    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: initial.triggerCenterX,
      y: initial.triggerCenterY,
    });
    await delay(75);
    assert.equal(await cdpClient.evaluate(`(() => {
      const shadow = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot;
      return shadow?.querySelector('[data-open-items-panel]')?.hidden;
    })()`), true);
    assert.deepEqual(requestCounts, { issues: 0, mergeRequests: 0 });

    const openItems = await waitForValue(cdpClient, `(() => {
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
    })()`, 'Open items panel after hover');
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

    await clickAt(cdpClient, openItems.refreshCenterX, openItems.refreshCenterY);
    assert.equal(await waitForValue(cdpClient, `(() => {
      const shadow = document.querySelector('#gitlab-reference-badge-host')?.shadowRoot;
      const panel = shadow?.querySelector('[data-open-items-panel]');
      const refreshed = panel?.querySelector('[data-kind="issue"][data-iid="124"]');
      return !panel?.hidden
        && shadow.querySelector('[data-reference-trigger]')?.getAttribute('aria-expanded') === 'true'
        && refreshed?.querySelector('[data-open-item-title]')?.textContent === 'Refreshed issue';
    })()`, 'refreshed Open items list'), true);
    assert.deepEqual(requestCounts, { issues: 2, mergeRequests: 2 });

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
    assert.ok(dragStart, 'drag handle should be available while the panel is open');
    await dragAt(
      cdpClient,
      dragStart.startX,
      dragStart.startY,
      dragStart.endX,
      dragStart.endY,
    );
    const dragged = await waitForValue(cdpClient, `(() => {
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
    })()`, 'right-edge drag and panel close');
    assert.equal(dragged.edge, 'right');
    assert.ok(Math.abs(dragged.right - (dragged.viewportWidth - 8)) < 0.5);
    assert.ok(dragged.top > 8 && dragged.top < dragged.viewportHeight - 40);

    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: dragged.right - 40,
      y: dragged.top + 15,
    });
    const rightPanel = await waitForValue(cdpClient, `(() => {
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
    const tooltip = await waitForValue(cdpClient, `(() => {
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
    assert.deepEqual(requestCounts, { issues: 3, mergeRequests: 3 });

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
    assert.deepEqual(requestCounts, { issues: 3, mergeRequests: 3 });

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
    const mergeRequestLink = await waitForValue(cdpClient, `(() => {
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
    assert.deepEqual(requestCounts, { issues: 3, mergeRequests: 3 });
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
