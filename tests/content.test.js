const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const parser = require('../src/parser.js');

const GITHUB_COPY_PATH = 'M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z';
const GITHUB_COPY_PATH_FRONT = 'M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z';
const SUCCESS_PATH = 'M13.78 4.22a.75.75 0 0 1 0 1.06l-6.25 6.25a.75.75 0 0 1-1.06 0L3.22 8.28a.75.75 0 0 1 1.06-1.06L7 9.94l5.72-5.72a.75.75 0 0 1 1.06 0Z';

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    event.preventDefault ||= () => {};
    event.stopPropagation ||= () => {};
    for (const listener of this.listeners.get(event.type) || []) {
      listener.call(this, event);
    }
    return true;
  }
}

function matchesSelector(node, selector) {
  if (selector.startsWith('#')) {
    return node.id === selector.slice(1);
  }
  const attributeMatch = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
  if (attributeMatch) {
    const [, name, value] = attributeMatch;
    return value === undefined
      ? node.attributes.has(name)
      : node.getAttribute(name) === value;
  }
  return node.tagName === selector.toUpperCase();
}

class FakeNode extends FakeEventTarget {
  constructor(tagName = '') {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.id = '';
    this.textContent = '';
    this.shadowRoot = null;
    this.hidden = false;
    this.style = {};
    this.value = '';
    this.selected = false;
    this.ownerDocument = null;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      node.setOwnerDocument(this.ownerDocument);
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    for (const child of this.children) {
      child.parentNode = null;
    }
    this.children = [];
    this.append(...nodes);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  attachShadow() {
    this.shadowRoot = new FakeNode('#shadow-root');
    this.shadowRoot.parentNode = this;
    this.shadowRoot.setOwnerDocument(this.ownerDocument);
    return this.shadowRoot;
  }

  querySelector(selector) {
    return this.find((node) => matchesSelector(node, selector));
  }

  querySelectorAll(selector) {
    return this.findAll((node) => matchesSelector(node, selector));
  }

  find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested = child.find(predicate);
      if (nested) return nested;
    }
    return null;
  }

  findAll(predicate) {
    const matches = [];
    for (const child of this.children) {
      if (predicate(child)) matches.push(child);
      matches.push(...child.findAll(predicate));
    }
    return matches;
  }

  contains(node) {
    return node === this || this.children.some((child) => child.contains(node));
  }

  setOwnerDocument(document) {
    this.ownerDocument = document;
    for (const child of this.children) child.setOwnerDocument(document);
    this.shadowRoot?.setOwnerDocument(document);
  }

  focus() {
    if (!this.ownerDocument) return;
    this.ownerDocument.activeElement = this;
    this.dispatchEvent({ type: 'focus' });
  }

  select() {
    this.selected = true;
  }
}

class FakeDocument extends FakeEventTarget {
  constructor(execCommand) {
    super();
    this.documentElement = new FakeNode('html');
    this.documentElement.setOwnerDocument(this);
    this.execCommand = execCommand;
    this.activeElement = null;
  }

  createElement(tagName) {
    const node = new FakeNode(tagName);
    node.setOwnerDocument(this);
    return node;
  }

  createElementNS(_namespace, tagName) {
    return this.createElement(tagName);
  }

  getElementById(id) {
    return this.documentElement.find((node) => node.id === id);
  }

  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: {
      get(name) {
        return name.toLowerCase() === 'x-next-page'
          ? options.nextPage || ''
          : null;
      },
    },
    json() {
      if (options.jsonError) return Promise.reject(options.jsonError);
      return Promise.resolve(body);
    },
  };
}

function createHarness(initialUrl, options = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
  const windowEvents = new FakeEventTarget();
  const location = { href: initialUrl };
  const animationFrames = new Map();
  const timers = new Map();
  const observers = [];
  const clipboardWrites = [];
  const execCommandCalls = [];
  const fetchCalls = [];
  let nextFrameId = 1;
  let nextTimerId = 1;
  let now = 0;
  let fetchCall = 0;

  const execCommand = (command) => {
    execCommandCalls.push(command);
    if (options.execCommandError) throw options.execCommandError;
    return options.execCommandResult ?? true;
  };
  const document = new FakeDocument(execCommand);

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      observers.push(this);
    }

    observe() {
      this.connected = true;
    }

    disconnect() {
      this.connected = false;
    }
  }

  let clipboardCall = 0;
  const clipboardResults = options.clipboardResults || [];
  const clipboard = options.clipboard === false ? undefined : {
    writeText(text) {
      clipboardWrites.push(text);
      const result = clipboardResults[clipboardCall];
      clipboardCall += 1;
      if (result instanceof Error) return Promise.reject(result);
      return result || Promise.resolve();
    },
  };

  const fetchResults = options.fetchResults || [];
  const fetch = (url, init) => {
    fetchCalls.push({ url: String(url), init });
    const result = fetchResults[fetchCall];
    fetchCall += 1;
    if (typeof result === 'function') {
      try {
        return Promise.resolve(result(url, init));
      } catch (error) {
        return Promise.reject(error);
      }
    }
    if (result instanceof Error) return Promise.reject(result);
    if (result?.promise) return result.promise;
    return Promise.resolve(result);
  };

  class FakeDate extends Date {
    static now() {
      return now;
    }
  }

  const context = {
    GitLabReferenceParser: parser,
    MutationObserver: FakeMutationObserver,
    document,
    fetch,
    location,
    navigator: clipboard ? { clipboard } : {},
    Date: FakeDate,
    URL,
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id);
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, dueAt: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };

  vm.runInNewContext(source, context, { filename: 'src/content.js' });

  return {
    context,
    document,
    location,
    clipboardWrites,
    execCommandCalls,
    fetchCalls,
    dispatchWindow(type) {
      windowEvents.dispatchEvent({ type });
    },
    dispatchDocument(type) {
      document.dispatchEvent({ type });
    },
    triggerMutation() {
      for (const observer of observers) {
        if (observer.connected) observer.callback([]);
      }
    },
    flushAnimationFrames() {
      while (animationFrames.size > 0) {
        const callbacks = [...animationFrames.values()];
        animationFrames.clear();
        for (const callback of callbacks) callback();
      }
    },
    async flushMicrotasks() {
      await new Promise((resolve) => setImmediate(resolve));
    },
    advanceTimersBy(milliseconds) {
      now += milliseconds;
      let ranTimer = true;
      while (ranTimer) {
        ranTimer = false;
        for (const [id, timer] of [...timers]) {
          if (timer.dueAt <= now) {
            timers.delete(id);
            timer.callback();
            ranTimer = true;
          }
        }
      }
    },
  };
}

function getBadge(document) {
  const host = document.getElementById('gitlab-reference-badge-host');
  const shadow = host?.shadowRoot;
  return {
    host,
    badge: shadow?.querySelector('[data-reference-badge]') || null,
    trigger: shadow?.querySelector('[data-reference-trigger]') || null,
    label: shadow?.querySelector('[data-reference-label]') || null,
    button: shadow?.querySelector('[data-copy-reference]') || null,
    tooltip: shadow?.querySelector('[data-copy-tooltip]') || null,
    icon: shadow?.querySelector('[data-copy-icon]') || null,
    announcement: shadow?.querySelector('[data-copy-announcement]') || null,
    panel: shadow?.querySelector('[data-open-items-panel]') || null,
    refresh: shadow?.querySelector('[data-refresh-open-items]') || null,
    style: shadow?.querySelector('style') || null,
  };
}

function renderedText(node) {
  if (!node) return '';
  return `${node.textContent}${node.children.map(renderedText).join('')}`;
}

async function openAndLoad(harness) {
  const rendered = getBadge(harness.document);
  rendered.trigger.dispatchEvent({ type: 'focus' });
  await harness.flushMicrotasks();
  return getBadge(harness.document);
}

test('renders a segmented Issue reference with an accessible copy button', () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/123');
  const rendered = getBadge(harness.document);

  assert.ok(rendered.host?.shadowRoot);
  assert.equal(rendered.label.textContent, 'Issue #123');
  assert.equal(rendered.button.tagName, 'BUTTON');
  assert.equal(rendered.button.getAttribute('type'), 'button');
  assert.equal(rendered.button.getAttribute('aria-label'), '复制 #123');
  assert.equal(rendered.button.getAttribute('data-copy-text'), '#123');
  assert.equal(rendered.button.getAttribute('data-copy-state'), 'default');
  assert.equal(rendered.tooltip.textContent, '复制 #123');
  assert.equal(rendered.button.children.filter((node) => node.tagName === 'SVG').length, 1);
  assert.equal(rendered.icon.getAttribute('data-copy-icon'), 'copy');
  assert.equal(rendered.icon.children.length, 2);
  assert.equal(rendered.icon.children[0].getAttribute('d'), GITHUB_COPY_PATH);
  assert.equal(rendered.icon.children[1].getAttribute('d'), GITHUB_COPY_PATH_FRONT);
  assert.equal(rendered.announcement.getAttribute('aria-live'), 'polite');
  assert.equal(rendered.announcement.textContent, '');
  assert.equal(rendered.badge.getAttribute('aria-live'), null);
});

test('keeps rendering idempotent and declares passive label with an interactive button', () => {
  const harness = createHarness('http://git.tsintergy.com/acme/platform/-/issues/21');
  harness.context.GitLabReferenceBadge.sync();
  const rendered = getBadge(harness.document);
  const hosts = harness.document.documentElement.children.filter(
    (node) => node.id === 'gitlab-reference-badge-host',
  );

  assert.equal(hosts.length, 1);
  assert.match(rendered.style.textContent, /position:\s*fixed\s*!important/);
  assert.match(rendered.style.textContent, /top:\s*8px\s*!important/);
  assert.match(rendered.style.textContent, /pointer-events:\s*none\s*!important/);
  assert.match(rendered.style.textContent, /\[data-copy-reference\][\s\S]*pointer-events:\s*auto/);
  assert.match(
    rendered.style.textContent,
    /\[data-open-items-panel\][\s\S]*left:\s*50%[\s\S]*transform:\s*translateX\(-50%\)/,
  );
  assert.match(rendered.style.textContent, /z-index:\s*2147483647\s*!important/);
});

test('copies an Issue reference and restores the default state after 1500ms', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15');
  const rendered = getBadge(harness.document);

  rendered.button.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();

  assert.deepEqual(harness.clipboardWrites, ['#15']);
  assert.equal(rendered.button.getAttribute('data-copy-state'), 'success');
  assert.equal(rendered.tooltip.textContent, '已复制');
  assert.equal(rendered.button.children.filter((node) => node.tagName === 'SVG').length, 1);
  assert.equal(rendered.icon.getAttribute('data-copy-icon'), 'success');
  assert.equal(rendered.icon.children.length, 1);
  assert.equal(rendered.icon.children[0].getAttribute('d'), SUCCESS_PATH);
  assert.equal(rendered.announcement.textContent, '已复制');

  harness.advanceTimersBy(1499);
  assert.equal(rendered.button.getAttribute('data-copy-state'), 'success');
  harness.advanceTimersBy(1);
  assert.equal(rendered.button.getAttribute('data-copy-state'), 'default');
  assert.equal(rendered.tooltip.textContent, '复制 #15');
  assert.equal(rendered.icon.getAttribute('data-copy-icon'), 'copy');
  assert.equal(rendered.icon.children.length, 2);
  assert.equal(rendered.icon.children[0].getAttribute('d'), GITHUB_COPY_PATH);
  assert.equal(rendered.icon.children[1].getAttribute('d'), GITHUB_COPY_PATH_FRONT);
  assert.equal(rendered.announcement.textContent, '');
});

test('copies an MR reference using the exclamation-mark format', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/merge_requests/14');
  const rendered = getBadge(harness.document);

  rendered.button.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();

  assert.deepEqual(harness.clipboardWrites, ['!14']);
  assert.equal(rendered.label.textContent, 'MR !14');
  assert.equal(rendered.button.getAttribute('aria-label'), '复制 !14');
  assert.equal(rendered.tooltip.textContent, '已复制');
});

test('falls back to execCommand when Clipboard API is unavailable', async () => {
  const harness = createHarness('http://git.example.test/acme/platform/-/issues/8', {
    clipboard: false,
  });
  const rendered = getBadge(harness.document);

  rendered.button.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();

  assert.deepEqual(harness.execCommandCalls, ['copy']);
  assert.equal(harness.document.querySelector('textarea'), null);
  assert.equal(rendered.button.getAttribute('data-copy-state'), 'success');
});

test('falls back after Clipboard API rejection', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/9', {
    clipboardResults: [new Error('permission denied')],
  });
  const rendered = getBadge(harness.document);

  rendered.button.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();

  assert.deepEqual(harness.clipboardWrites, ['#9']);
  assert.deepEqual(harness.execCommandCalls, ['copy']);
  assert.equal(rendered.button.getAttribute('data-copy-state'), 'success');
});

test('reports copy failure when both copy mechanisms fail', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/10', {
    clipboardResults: [new Error('blocked')],
    execCommandResult: false,
  });
  const rendered = getBadge(harness.document);

  rendered.button.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();

  assert.equal(rendered.button.getAttribute('data-copy-state'), 'error');
  assert.equal(rendered.tooltip.textContent, '复制失败');
  assert.equal(rendered.icon.getAttribute('data-copy-icon'), 'copy');
  assert.equal(rendered.icon.children.length, 2);
  assert.equal(rendered.announcement.textContent, '复制失败');

  harness.advanceTimersBy(1500);
  assert.equal(rendered.button.getAttribute('data-copy-state'), 'default');
  assert.equal(rendered.tooltip.textContent, '复制 #10');
});

test('contains fallback exceptions and removes the temporary field', async () => {
  const harness = createHarness('http://git.example.test/acme/platform/-/issues/11', {
    clipboard: false,
    execCommandError: new Error('copy command unavailable'),
  });
  const rendered = getBadge(harness.document);

  rendered.button.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();

  assert.deepEqual(harness.execCommandCalls, ['copy']);
  assert.equal(harness.document.querySelector('textarea'), null);
  assert.equal(rendered.button.getAttribute('data-copy-state'), 'error');
  assert.equal(rendered.tooltip.textContent, '复制失败');
  assert.equal(rendered.announcement.textContent, '复制失败');
});

test('updates the reference and clears feedback after SPA navigation', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1');
  const issue = getBadge(harness.document);
  issue.button.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();
  assert.equal(issue.button.getAttribute('data-copy-state'), 'success');

  harness.location.href = 'https://gitlab.com/acme/platform/-/merge_requests/456/diffs';
  harness.dispatchWindow('popstate');
  harness.flushAnimationFrames();
  const mergeRequest = getBadge(harness.document);

  assert.equal(mergeRequest.label.textContent, 'MR !456');
  assert.equal(mergeRequest.button.getAttribute('data-copy-text'), '!456');
  assert.equal(mergeRequest.button.getAttribute('aria-label'), '复制 !456');
  assert.equal(mergeRequest.button.getAttribute('data-copy-state'), 'default');
  assert.equal(mergeRequest.tooltip.textContent, '复制 !456');
  assert.equal(mergeRequest.announcement.textContent, '');
});

test('ignores stale copy results after SPA navigation', async () => {
  const pending = deferred();
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/2', {
    clipboardResults: [pending.promise],
  });
  getBadge(harness.document).button.dispatchEvent({ type: 'click' });

  harness.location.href = 'https://gitlab.com/acme/platform/-/merge_requests/3';
  harness.dispatchWindow('popstate');
  harness.flushAnimationFrames();
  pending.resolve();
  await harness.flushMicrotasks();

  const rendered = getBadge(harness.document);
  assert.equal(rendered.label.textContent, 'MR !3');
  assert.equal(rendered.button.getAttribute('data-copy-state'), 'default');
  assert.equal(rendered.tooltip.textContent, '复制 !3');
});

test('keeps the latest copy result when clicks complete out of order', async () => {
  const first = deferred();
  const second = deferred();
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/4', {
    clipboardResults: [first.promise, second.promise],
  });
  const rendered = getBadge(harness.document);

  rendered.button.dispatchEvent({ type: 'click' });
  rendered.button.dispatchEvent({ type: 'click' });
  second.resolve();
  await harness.flushMicrotasks();
  assert.equal(rendered.button.getAttribute('data-copy-state'), 'success');

  first.reject(new Error('late rejection'));
  await harness.flushMicrotasks();
  assert.equal(rendered.button.getAttribute('data-copy-state'), 'success');
  assert.equal(rendered.tooltip.textContent, '已复制');
  assert.deepEqual(harness.execCommandCalls, []);
});

test('uses DOM mutations to detect URL changes and removes stale badges', () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/5');

  harness.location.href = 'https://gitlab.com/acme/platform/-/issues';
  harness.triggerMutation();
  harness.flushAnimationFrames();

  assert.equal(getBadge(harness.document).host, null);
});

test('destroy removes the badge and ignores a late copy result', async () => {
  const pending = deferred();
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/6', {
    clipboardResults: [pending.promise],
  });
  getBadge(harness.document).button.dispatchEvent({ type: 'click' });

  harness.context.GitLabReferenceBadge.destroy();
  pending.resolve();
  await harness.flushMicrotasks();
  assert.equal(getBadge(harness.document).host, null);

  harness.location.href = 'https://gitlab.com/acme/platform/-/merge_requests/7';
  harness.dispatchWindow('hashchange');
  harness.triggerMutation();
  harness.flushAnimationFrames();
  assert.equal(getBadge(harness.document).host, null);
});

test('loads Open items with encoded project API URLs, pagination, and current semantics', async () => {
  const harness = createHarness(
    'https://git.example.test/group/sub%20group/app/-/issues/15',
    {
      fetchResults: [
        jsonResponse([
          {
            iid: 15,
            title: 'Current issue',
            web_url: 'https://git.example.test/group/sub%20group/app/-/issues/15',
          },
        ], { nextPage: '2' }),
        jsonResponse([
          {
            iid: 8,
            title: 'Open MR',
            web_url: 'https://git.example.test/group/sub%20group/app/-/merge_requests/8',
          },
        ]),
        jsonResponse([{ iid: 16, title: 'Fallback issue URL' }]),
      ],
    },
  );

  const rendered = await openAndLoad(harness);

  assert.deepEqual(
    harness.fetchCalls.map(({ url }) => url),
    [
      'https://git.example.test/api/v4/projects/group%2Fsub%20group%2Fapp/issues'
        + '?state=opened&scope=all&order_by=updated_at&sort=desc&per_page=100&page=1',
      'https://git.example.test/api/v4/projects/group%2Fsub%20group%2Fapp/'
        + 'merge_requests?state=opened&scope=all&order_by=updated_at&sort=desc'
        + '&per_page=100&page=1',
      'https://git.example.test/api/v4/projects/group%2Fsub%20group%2Fapp/issues'
        + '?state=opened&scope=all&order_by=updated_at&sort=desc&per_page=100&page=2',
    ],
  );
  for (const { init } of harness.fetchCalls) {
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.headers.accept, 'application/json');
  }

  assert.equal(rendered.trigger.tagName, 'BUTTON');
  assert.equal(rendered.trigger.getAttribute('type'), 'button');
  assert.equal(rendered.trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(rendered.panel.hidden, false);
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]').length, 3);
  assert.equal(rendered.panel.querySelector('[data-open-items-total]').textContent, '3');

  const current = rendered.panel.querySelector('[data-current-open-item]');
  assert.equal(current.tagName, 'SPAN');
  assert.equal(current.getAttribute('aria-current'), 'page');
  assert.equal(current.getAttribute('href'), null);
  assert.match(renderedText(current), /#15Current issue当前/);

  const fallback = rendered.panel.querySelector('[data-iid="16"]');
  assert.equal(fallback.tagName, 'A');
  assert.equal(
    fallback.getAttribute('href'),
    'https://git.example.test/group/sub%20group/app/-/issues/16',
  );
  assert.equal(
    rendered.panel.querySelectorAll('[data-open-items-group]')[0]
      .getAttribute('data-open-items-group'),
    'issues',
  );
  assert.equal(
    rendered.panel.querySelectorAll('[data-open-items-group]')[1]
      .getAttribute('data-open-items-group'),
    'merge-requests',
  );
});

test('reuses a complete snapshot for 60 seconds and refreshes expired data', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [
      jsonResponse([{ iid: 1, title: 'Initial issue' }]),
      jsonResponse([{ iid: 2, title: 'Initial MR' }]),
      jsonResponse([{ iid: 1, title: 'Refreshed issue' }]),
      jsonResponse([{ iid: 3, title: 'Refreshed MR' }]),
    ],
  });

  let rendered = await openAndLoad(harness);
  assert.equal(harness.fetchCalls.length, 2);
  rendered.panel.dispatchEvent({ type: 'keydown', key: 'Escape' });

  harness.advanceTimersBy(59999);
  rendered.trigger.dispatchEvent({ type: 'focus' });
  await harness.flushMicrotasks();
  assert.equal(harness.fetchCalls.length, 2);
  rendered.panel.dispatchEvent({ type: 'keydown', key: 'Escape' });

  harness.advanceTimersBy(1);
  rendered.trigger.dispatchEvent({ type: 'focus' });
  assert.match(renderedText(rendered.panel), /Initial issue/);
  await harness.flushMicrotasks();
  rendered = getBadge(harness.document);

  assert.equal(harness.fetchCalls.length, 4);
  assert.match(renderedText(rendered.panel), /Refreshed issue/);
  assert.doesNotMatch(renderedText(rendered.panel), /Initial issue/);
});

test('shows a successful group on initial partial failure without caching it', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [
      new Error('Issues unavailable'),
      jsonResponse([{ iid: 4, title: 'Available MR' }]),
      jsonResponse([{ iid: 1, title: 'Recovered issue' }]),
      jsonResponse([{ iid: 4, title: 'Available MR' }]),
    ],
  });

  let rendered = await openAndLoad(harness);
  const groups = rendered.panel.querySelectorAll('[data-open-items-group]');
  assert.equal(groups[0].getAttribute('data-open-items-state'), 'error');
  assert.match(renderedText(groups[0]), /无法加载/);
  assert.equal(groups[1].getAttribute('data-open-items-state'), 'ready');
  assert.match(renderedText(groups[1]), /Available MR/);

  rendered.refresh.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();
  rendered = getBadge(harness.document);
  assert.equal(harness.fetchCalls.length, 4);
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]').length, 2);
  assert.match(renderedText(rendered.panel), /Recovered issue/);
});

test('keeps a complete snapshot when a manual refresh partially fails', async () => {
  const issueRefresh = deferred();
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [
      jsonResponse([{ iid: 1, title: 'Stable issue' }]),
      jsonResponse([{ iid: 2, title: 'Stable MR' }]),
      issueRefresh,
      jsonResponse([{ iid: 3, title: 'Uncommitted MR' }]),
    ],
  });

  let rendered = await openAndLoad(harness);
  rendered.refresh.dispatchEvent({ type: 'click' });
  assert.equal(rendered.refresh.getAttribute('aria-busy'), 'true');
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]').length, 2);

  issueRefresh.reject(new Error('refresh failed'));
  await harness.flushMicrotasks();
  rendered = getBadge(harness.document);

  assert.match(renderedText(rendered.panel), /刷新失败，显示上次结果/);
  assert.match(renderedText(rendered.panel), /Stable issue/);
  assert.match(renderedText(rendered.panel), /Stable MR/);
  assert.doesNotMatch(renderedText(rendered.panel), /Uncommitted MR/);
});

test('opens after hover delay and closes only after leaving the navigation region', () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1');
  const rendered = getBadge(harness.document);

  rendered.trigger.dispatchEvent({ type: 'mouseenter' });
  harness.advanceTimersBy(149);
  assert.equal(rendered.panel.hidden, true);
  harness.advanceTimersBy(1);
  assert.equal(rendered.panel.hidden, false);

  rendered.trigger.dispatchEvent({ type: 'mouseleave' });
  harness.advanceTimersBy(249);
  assert.equal(rendered.panel.hidden, false);
  rendered.panel.dispatchEvent({ type: 'mouseenter' });
  harness.advanceTimersBy(1);
  assert.equal(rendered.panel.hidden, false);

  rendered.panel.dispatchEvent({ type: 'mouseleave' });
  rendered.button.dispatchEvent({ type: 'mouseenter' });
  harness.advanceTimersBy(250);
  assert.equal(rendered.panel.hidden, false);

  rendered.button.dispatchEvent({ type: 'mouseleave' });
  harness.advanceTimersBy(250);
  assert.equal(rendered.panel.hidden, true);
});

test('supports keyboard opening and Escape closes with focus restored', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });
  const rendered = getBadge(harness.document);

  rendered.trigger.dispatchEvent({ type: 'keydown', key: 'Enter' });
  await harness.flushMicrotasks();
  assert.equal(rendered.panel.hidden, false);
  assert.equal(rendered.trigger.getAttribute('aria-expanded'), 'true');

  rendered.panel.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(rendered.panel.hidden, true);
  assert.equal(rendered.trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(harness.document.activeElement, rendered.trigger);

  rendered.trigger.dispatchEvent({ type: 'keydown', key: ' ' });
  assert.equal(rendered.panel.hidden, false);
  rendered.trigger.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert.equal(rendered.panel.hidden, false);
});

test('touch toggles the panel and an outside pointer closes it', () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1');
  const rendered = getBadge(harness.document);

  rendered.trigger.dispatchEvent({ type: 'click', pointerType: 'touch' });
  assert.equal(rendered.panel.hidden, false);
  rendered.trigger.dispatchEvent({ type: 'click', pointerType: 'touch' });
  assert.equal(rendered.panel.hidden, true);

  rendered.trigger.dispatchEvent({ type: 'click', pointerType: 'touch' });
  const outside = harness.document.createElement('div');
  harness.document.documentElement.append(outside);
  harness.document.dispatchEvent({ type: 'pointerdown', target: outside });
  assert.equal(rendered.panel.hidden, true);
});

test('touch focus followed by click opens the panel instead of immediately closing it', () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1');
  const rendered = getBadge(harness.document);

  rendered.trigger.dispatchEvent({ type: 'pointerdown', pointerType: 'touch' });
  rendered.trigger.dispatchEvent({ type: 'focus' });
  assert.equal(rendered.panel.hidden, true);

  rendered.trigger.dispatchEvent({ type: 'click', pointerType: 'touch' });
  assert.equal(rendered.panel.hidden, false);
});

test('focus stays open inside the extension and closes after focus leaves', () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1');
  const rendered = getBadge(harness.document);
  const outside = harness.document.createElement('button');
  harness.document.documentElement.append(outside);

  rendered.trigger.dispatchEvent({ type: 'focus' });
  rendered.host.shadowRoot.dispatchEvent({
    type: 'focusout',
    relatedTarget: rendered.button,
  });
  assert.equal(rendered.panel.hidden, false);

  rendered.host.shadowRoot.dispatchEvent({ type: 'focusout', relatedTarget: outside });
  assert.equal(rendered.panel.hidden, true);
});

test('reuses same-project data while moving the current marker after SPA navigation', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [
      jsonResponse([
        { iid: 1, title: 'First issue' },
        { iid: 2, title: 'Second issue' },
      ]),
      jsonResponse([]),
    ],
  });

  let rendered = await openAndLoad(harness);
  assert.equal(rendered.panel.querySelector('[data-current-open-item]').getAttribute('data-iid'), '1');

  harness.location.href = 'https://gitlab.com/acme/platform/-/issues/2';
  harness.dispatchWindow('popstate');
  harness.flushAnimationFrames();
  rendered = getBadge(harness.document);

  assert.equal(harness.fetchCalls.length, 2);
  assert.equal(rendered.panel.querySelector('[data-current-open-item]').getAttribute('data-iid'), '2');
});

test('ignores stale project results after navigating to another project', async () => {
  const oldIssues = deferred();
  const oldMergeRequests = deferred();
  const harness = createHarness('https://gitlab.com/acme/old-app/-/issues/1', {
    fetchResults: [
      oldIssues,
      oldMergeRequests,
      jsonResponse([{ iid: 7, title: 'New project issue' }]),
      jsonResponse([{ iid: 8, title: 'New project MR' }]),
    ],
  });

  getBadge(harness.document).trigger.dispatchEvent({ type: 'focus' });
  harness.location.href = 'https://gitlab.com/acme/new-app/-/issues/7';
  harness.dispatchWindow('popstate');
  harness.flushAnimationFrames();
  getBadge(harness.document).trigger.dispatchEvent({ type: 'focus' });
  await harness.flushMicrotasks();

  oldIssues.resolve(jsonResponse([{ iid: 1, title: 'Stale issue' }]));
  oldMergeRequests.resolve(jsonResponse([{ iid: 2, title: 'Stale MR' }]));
  await harness.flushMicrotasks();

  const rendered = getBadge(harness.document);
  assert.match(renderedText(rendered.panel), /New project issue/);
  assert.match(renderedText(rendered.panel), /New project MR/);
  assert.doesNotMatch(renderedText(rendered.panel), /Stale issue|Stale MR/);
});

test('ignores navigation responses after leaving a detail page', async () => {
  const issues = deferred();
  const mergeRequests = deferred();
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [issues, mergeRequests],
  });

  getBadge(harness.document).trigger.dispatchEvent({ type: 'focus' });
  harness.location.href = 'https://gitlab.com/acme/platform/-/issues';
  harness.dispatchWindow('popstate');
  harness.flushAnimationFrames();
  issues.resolve(jsonResponse([{ iid: 1, title: 'Late issue' }]));
  mergeRequests.resolve(jsonResponse([]));
  await harness.flushMicrotasks();

  assert.equal(getBadge(harness.document).host, null);
});
