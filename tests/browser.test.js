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
    if (request.url === '/favicon.ico') {
      response.writeHead(204).end();
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
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
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

test('keeps the GitLab reference visible through scrolling and SPA navigation', {
  timeout: 45000,
}, async () => {
  const chromeExecutable = findExecutable('CHROME_PATH', defaultChromePaths, 'Chrome/Chromium');
  const chromeDriverExecutable = findExecutable(
    'CHROMEDRIVER_PATH',
    defaultChromeDriverPaths,
    'ChromeDriver',
  );
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlab-reference-badge-'));
  const { server, origin } = await createFixtureServer();
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
      const labelRect = label.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      return {
        text: label.textContent,
        hostCount: document.querySelectorAll('#gitlab-reference-badge-host').length,
        top: hostRect.top,
        labelCenterX: labelRect.left + labelRect.width / 2,
        labelCenterY: labelRect.top + labelRect.height / 2,
        buttonCenterX: buttonRect.left + buttonRect.width / 2,
        buttonCenterY: buttonRect.top + buttonRect.height / 2,
        position: getComputedStyle(host).position,
        pointerEvents: getComputedStyle(host).pointerEvents,
        labelElement: document.elementFromPoint(
          labelRect.left + labelRect.width / 2,
          labelRect.top + labelRect.height / 2,
        )?.id || null,
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
    assert.equal(initial.labelElement, 'click-target');
    assert.equal(initial.buttonHit, true);
    assert.equal(initial.ariaLabel, '复制 #123');
    assert.equal(initial.copyText, '#123');
    assert.ok(Math.abs(initial.top - 8) < 0.5, `expected top 8, got ${initial.top}`);

    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: initial.labelCenterX,
      y: initial.labelCenterY,
      button: 'left',
      clickCount: 1,
    });
    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: initial.labelCenterX,
      y: initial.labelCenterY,
      button: 'left',
      clickCount: 1,
    });
    assert.equal(await cdpClient.evaluate(
      `document.querySelector('#click-target').dataset.clicks`,
    ), '1');

    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: initial.buttonCenterX,
      y: initial.buttonCenterY,
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

    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: initial.buttonCenterX,
      y: initial.buttonCenterY,
      button: 'left',
      clickCount: 1,
    });
    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: initial.buttonCenterX,
      y: initial.buttonCenterY,
      button: 'left',
      clickCount: 1,
    });
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

    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: mergeRequest.centerX,
      y: mergeRequest.centerY,
      button: 'left',
      clickCount: 1,
    });
    await cdpClient.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: mergeRequest.centerX,
      y: mergeRequest.centerY,
      button: 'left',
      clickCount: 1,
    });
    assert.equal(await waitForValue(cdpClient, `(async () => {
      const button = document.querySelector('#gitlab-reference-badge-host')
        ?.shadowRoot?.querySelector('[data-copy-reference]');
      if (button?.dataset.copyState !== 'success') return null;
      return navigator.clipboard.readText();
    })()`, 'Merge Request reference copied'), '!456');

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
