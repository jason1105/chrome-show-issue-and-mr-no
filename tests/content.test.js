const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const parser = require('../src/parser.js');

const CONFIG_STORAGE_KEY = 'gitlabReferenceConfig';
const GITHUB_COPY_PATH = 'M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z';
const GITHUB_COPY_PATH_FRONT = 'M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z';
const SUCCESS_PATH = 'M13.78 4.22a.75.75 0 0 1 0 1.06l-6.25 6.25a.75.75 0 0 1-1.06 0L3.22 8.28a.75.75 0 0 1 1.06-1.06L7 9.94l5.72-5.72a.75.75 0 0 1 1.06 0Z';
const POSITION_STORAGE_KEY = 'gitlabReferenceControlPosition';

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
    event.defaultPrevented ||= false;
    event.propagationStopped ||= false;
    event.preventDefault ||= () => {
      event.defaultPrevented = true;
    };
    event.stopPropagation ||= () => {
      event.propagationStopped = true;
    };
    for (const listener of this.listeners.get(event.type) || []) {
      listener.call(this, event);
    }
    return true;
  }
}

function createFakeStyle() {
  const values = new Map();
  return {
    setProperty(name, value) {
      values.set(name, String(value));
    },
    getPropertyValue(name) {
      return values.get(name) || '';
    },
    removeProperty(name) {
      const value = values.get(name) || '';
      values.delete(name);
      return value;
    },
  };
}

function matchesSelector(node, selector) {
  // Support comma-separated selector groups (e.g. 'button, input, [href]')
  // the same way real querySelectorAll does.
  if (selector.includes(',')) {
    return selector.split(',').some((part) => matchesSelector(node, part.trim()));
  }
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
    this.classList = {
      contains: (name) => (this.className || '').split(/\s+/).includes(name),
    };
    this.className = '';
    this.style = createFakeStyle();
    this.value = '';
    this.selected = false;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.activeElement = null;
    this.ownerDocument = null;
    this.rect = { left: 0, top: 0, width: 160, height: 30 };
    this.capturedPointerIds = new Set();
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
    let ancestor = this.parentNode;
    while (ancestor) {
      if (ancestor.tagName === '#SHADOW-ROOT') {
        ancestor.activeElement = this;
        break;
      }
      ancestor = ancestor.parentNode;
    }
    this.dispatchEvent({ type: 'focus' });
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  select() {
    this.selected = true;
  }

  matches(selector) {
    return matchesSelector(this, selector);
  }

  getBoundingClientRect() {
    const { left, top, width, height } = this.rect;
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
    };
  }

  setBoundingClientRect(rect) {
    this.rect = { ...this.rect, ...rect };
  }

  setPointerCapture(pointerId) {
    this.capturedPointerIds.add(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.capturedPointerIds.delete(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.capturedPointerIds.has(pointerId);
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
  const configSource = fs.readFileSync(path.join(__dirname, '../src/config.js'), 'utf8');
  const i18nSource = fs.readFileSync(path.join(__dirname, '../src/i18n.js'), 'utf8');
  const badgeCssSource = fs.readFileSync(path.join(__dirname, '../src/badge-css.js'), 'utf8');
  const uiSource = fs.readFileSync(path.join(__dirname, '../src/ui.js'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
  // i18n: load the zh_CN dictionary as the single source of truth so content
  // script assertions keep matching the shipped Chinese strings.
  const zhMessages = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../_locales/zh_CN/messages.json'), 'utf8'),
  );
  const windowEvents = new FakeEventTarget();
  const location = { href: initialUrl };
  const animationFrames = new Map();
  const timers = new Map();
  const observers = [];
  const clipboardWrites = [];
  const execCommandCalls = [];
  const fetchCalls = [];
  const storageCalls = { get: [], set: [], remove: [] };
  const storageData = { ...(options.storageData || {}) };
  const storageChangeListeners = new Set();
  let innerWidth = options.innerWidth || 1280;
  let innerHeight = options.innerHeight || 800;
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
    return new Promise((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')));
      if (typeof result === 'function') {
        try {
          resolve(result(url, init));
        } catch (error) {
          reject(error);
        }
        return;
      }
      if (result instanceof Error) {
        reject(result);
        return;
      }
      if (result?.promise) {
        result.promise.then(resolve, reject);
        return;
      }
      resolve(result);
    });
  };

  class FakeDate extends Date {
    static now() {
      return now;
    }
  }

  const storage = options.storage === false ? undefined : {
    // Both areas share one backing record so existing tests keep their
    // single data source; the extension reads config from sync and uses
    // local only as the legacy migration source (#17).
    sync: {
      get(key) {
        storageCalls.get.push(key);
        if (options.storageGetError) return Promise.reject(options.storageGetError);
        const keys = Array.isArray(key) ? key : [key];
        return Promise.resolve(Object.fromEntries(keys.map((name) => [name, storageData[name]])));
      },
      set(value) {
        storageCalls.set.push(value);
        if (options.storageSetError) return Promise.reject(options.storageSetError);
        const changes = Object.fromEntries(
          Object.entries(value).map(([key, newValue]) => [
            key,
            { oldValue: storageData[key], newValue },
          ]),
        );
        Object.assign(storageData, value);
        for (const listener of storageChangeListeners) listener(changes, 'sync');
        return Promise.resolve();
      },
      remove(key) {
        storageCalls.remove.push(key);
        if (options.storageRemoveError) return Promise.reject(options.storageRemoveError);
        const oldValue = storageData[key];
        delete storageData[key];
        const change = { [key]: { oldValue, newValue: undefined } };
        for (const listener of storageChangeListeners) listener(change, 'sync');
        return Promise.resolve();
      },
    },
    local: {
      get(key) {
        storageCalls.get.push(key);
        if (options.storageGetError) return Promise.reject(options.storageGetError);
        const keys = Array.isArray(key) ? key : [key];
        return Promise.resolve(Object.fromEntries(keys.map((name) => [name, storageData[name]])));
      },
      set(value) {
        storageCalls.set.push(value);
        if (options.storageSetError) return Promise.reject(options.storageSetError);
        Object.assign(storageData, value);
        return Promise.resolve();
      },
      remove(key) {
        storageCalls.remove.push(key);
        if (options.storageRemoveError) return Promise.reject(options.storageRemoveError);
        delete storageData[key];
        return Promise.resolve();
      },
    },
    onChanged: {
      addListener(listener) {
        storageChangeListeners.add(listener);
      },
      removeListener(listener) {
        storageChangeListeners.delete(listener);
      },
    },
  };

  const runtimeOpenOptionsCalls = [];
  const windowOpenCalls = [];
  const runtimeSendMessageCalls = [];
  const i18nMock = {
    getMessage(key, substitutions = []) {
      const entry = zhMessages[key];
      if (!entry) return key;
      let message = entry.message;
      const values = Array.isArray(substitutions) ? substitutions : [substitutions];
      message = message.replace(/\$(\d+)/g, (match, index) => {
        const value = values[Number(index) - 1];
        return value === undefined ? match : String(value);
      });
      return message;
    },
  };
  const context = {
    GitLabReferenceParser: parser,
    GitLabReferenceI18n: i18nMock,
    MutationObserver: FakeMutationObserver,
    document,
    fetch,
    location,
    navigator: clipboard ? { clipboard } : {},
    chrome: storage ? {
      storage,
      runtime: {
        // #20 (final): content-script contexts cannot call openOptionsPage, and
        // getURL + window.open is blocked (ERR_BLOCKED_BY_CLIENT), so the click
        // handler sends a message to the service worker to open options instead.
        openOptionsPage() {
          runtimeOpenOptionsCalls.push(Date.now());
        },
        getURL(path) {
          return `chrome-extension://mock-extension-id/${path}`;
        },
        sendMessage(message) {
          runtimeSendMessageCalls.push(message);
          return null;
        },
      },
    } : {},
    open(url, target) {
      windowOpenCalls.push({ url, target });
      return null;
    },
    Date: FakeDate,
    URL,
    get innerWidth() {
      return innerWidth;
    },
    get innerHeight() {
      return innerHeight;
    },
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
    matchMedia(query) {
      return {
        matches: options.reducedMotion === true,
        media: query,
      };
    },
    AbortController,
  };

  vm.runInNewContext(configSource, context, { filename: 'src/config.js' });
  vm.runInNewContext(i18nSource, context, { filename: 'src/i18n.js' });
  vm.runInNewContext(badgeCssSource, context, { filename: 'src/badge-css.js' });
  vm.runInNewContext(uiSource, context, { filename: 'src/ui.js' });
  vm.runInNewContext(source, context, { filename: 'src/content.js' });

  return {
    context,
    document,
    location,
    clipboardWrites,
    execCommandCalls,
    fetchCalls,
    storageCalls,
    storageData,
    runtimeOpenOptionsCalls,
    windowOpenCalls,
    runtimeSendMessageCalls,
    dispatchStorageChanged(changes, areaName = 'sync') {
      return Promise.all([...storageChangeListeners].map((listener) => listener(changes, areaName)));
    },
    dispatchWindow(type, overrides = {}) {
      windowEvents.dispatchEvent({ type, ...overrides });
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
    setViewport(width, height) {
      innerWidth = width;
      innerHeight = height;
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
    handle: shadow?.querySelector('[data-drag-handle]') || null,
    handleIcon: shadow?.querySelector('[data-drag-handle-icon]') || null,
    handleTooltip: shadow?.querySelector('[data-drag-tooltip]') || null,
    button: shadow?.querySelector('[data-copy-reference]') || null,
    tooltip: shadow?.querySelector('[data-copy-tooltip]') || null,
    toast: shadow?.querySelector('[data-copy-toast]') || null,
    toastLabel: shadow?.querySelector('[data-copy-toast-label]') || null,
    icon: shadow?.querySelector('[data-copy-icon]') || null,
    announcement: shadow?.querySelector('[data-copy-announcement]') || null,
    panel: shadow?.querySelector('[data-open-items-panel]') || null,
    refresh: shadow?.querySelector('[data-refresh-open-items]') || null,
    search: shadow?.querySelector('[data-open-items-search]') || null,
    searchSummary: shadow?.querySelector('[data-open-items-search-summary]') || null,
    filterAll: shadow?.querySelector('[data-open-items-filter="all"]') || null,
    filterIssue: shadow?.querySelector('[data-open-items-filter="issue"]') || null,
    filterMergeRequest: shadow?.querySelector('[data-open-items-filter="merge-request"]') || null,
    stateControls: shadow?.querySelector('[data-item-state-controls]') || null,
    stateFilterOpen: shadow?.querySelector('[data-item-state-filter="open"]') || null,
    stateFilterAll: shadow?.querySelector('[data-item-state-filter="all"]') || null,
    openOptions: shadow?.querySelector('[data-open-options]') || null,
    style: shadow?.querySelector('style') || null,
  };
}

function renderedText(node) {
  if (!node) return '';
  return `${node.textContent}${node.children.map(renderedText).join('')}`;
}

function dispatchPointer(node, type, clientX, clientY, overrides = {}) {
  const event = {
    type,
    button: 0,
    isPrimary: true,
    pointerId: 7,
    pointerType: 'mouse',
    clientX,
    clientY,
    ...overrides,
  };
  node.dispatchEvent(event);
  return event;
}

function readPixelStyle(node, property) {
  return Number.parseFloat(node.style.getPropertyValue(property));
}

async function openAndLoad(harness) {
  const rendered = getBadge(harness.document);
  rendered.trigger.dispatchEvent({ type: 'focus' });
  await harness.flushMicrotasks();
  return getBadge(harness.document);
}

function searchOpenItems(harness, query) {
  const rendered = getBadge(harness.document);
  rendered.search.value = query;
  rendered.search.selectionStart = query.length;
  rendered.search.selectionEnd = query.length;
  rendered.search.dispatchEvent({ type: 'input' });
  return getBadge(harness.document);
}

function filterOpenItems(harness, kind) {
  const rendered = getBadge(harness.document);
  const control = kind === 'issue'
    ? rendered.filterIssue
    : kind === 'merge-request'
      ? rendered.filterMergeRequest
      : rendered.filterAll;
  control.dispatchEvent({ type: 'click' });
  return getBadge(harness.document);
}

test('renders a segmented Issue reference with an accessible copy button', () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/123');
  const rendered = getBadge(harness.document);

  assert.ok(rendered.host?.shadowRoot);
  assert.equal(rendered.label.textContent, 'Issue #123');
  assert.equal(rendered.button.tagName, 'BUTTON');
  assert.equal(rendered.button.getAttribute('type'), 'button');
  assert.equal(rendered.button.getAttribute('aria-label'), 'Copy #123');
  assert.equal(rendered.button.getAttribute('data-copy-text'), '#123');
  assert.equal(rendered.button.getAttribute('data-copy-state'), 'default');
  assert.equal(rendered.tooltip.textContent, 'Copy #123');
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
  assert.match(rendered.style.textContent, /top:\s*var\(--reference-top\)\s*!important/);
  assert.match(rendered.style.textContent, /left:\s*var\(--reference-left\)\s*!important/);
  assert.match(rendered.style.textContent, /pointer-events:\s*none\s*!important/);
  assert.match(rendered.style.textContent, /\[data-copy-reference\][\s\S]*pointer-events:\s*auto/);
  assert.match(
    rendered.style.textContent,
    /data-panel-placement="down"[\s\S]*top:\s*calc\(100% \+ 6px\)/,
  );
  assert.match(rendered.style.textContent, /z-index:\s*2147483647\s*!important/);
});

test('renders an accessible six-dot drag handle with grab affordances', () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/123');
  const rendered = getBadge(harness.document);

  assert.equal(rendered.handle.tagName, 'BUTTON');
  assert.equal(rendered.handle.getAttribute('type'), 'button');
  assert.equal(rendered.handle.getAttribute('aria-label'), 'Drag to reposition, double-click to reset. Use arrow keys to fine-tune when focused, Home to reset.');
  assert.equal(rendered.handleTooltip.textContent, 'Drag to reposition');
  assert.equal(rendered.handleIcon.tagName, 'SVG');
  assert.equal(rendered.handleIcon.querySelectorAll('circle').length, 6);
  assert.match(rendered.style.textContent, /\[data-drag-handle\][\s\S]*cursor:\s*grab/);
  assert.match(rendered.style.textContent, /data-dragging[\s\S]*cursor:\s*grabbing/);
  assert.match(rendered.style.textContent, /touch-action:\s*none/);
});

test('ignores movement below the drag threshold without opening, copying, or saving', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/123');
  await harness.flushMicrotasks();
  const rendered = getBadge(harness.document);
  rendered.host.setBoundingClientRect({ left: 560, top: 8, width: 160, height: 30 });

  dispatchPointer(rendered.handle, 'pointerdown', 568, 20);
  assert.equal(rendered.handle.hasPointerCapture(7), true);
  const move = dispatchPointer(rendered.handle, 'pointermove', 571, 22);
  dispatchPointer(rendered.handle, 'pointerup', 571, 22);
  rendered.handle.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();

  assert.equal(move.defaultPrevented, false);
  assert.equal(rendered.handle.hasPointerCapture(7), false);
  assert.equal(rendered.host.getAttribute('data-dragging'), null);
  assert.equal(rendered.panel.hidden, true);
  assert.deepEqual(harness.clipboardWrites, []);
  assert.deepEqual(harness.fetchCalls, []);
  assert.equal(harness.storageCalls.set.length, 0);
});

test('drags freely, closes navigation, then snaps right and saves a normalized position', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/123');
  await harness.flushMicrotasks();
  let rendered = getBadge(harness.document);
  rendered.host.setBoundingClientRect({ left: 560, top: 8, width: 160, height: 30 });
  rendered.trigger.dispatchEvent({ type: 'focus' });
  assert.equal(rendered.panel.hidden, false);

  dispatchPointer(rendered.handle, 'pointerdown', 568, 20);
  const move = dispatchPointer(rendered.handle, 'pointermove', 1200, 310);

  assert.equal(move.defaultPrevented, true);
  assert.equal(rendered.host.getAttribute('data-dragging'), 'true');
  assert.equal(rendered.panel.hidden, true);
  assert.equal(rendered.handle.hasPointerCapture(7), true);
  assert.equal(readPixelStyle(rendered.host, '--reference-left'), 1112);
  assert.ok(readPixelStyle(rendered.host, '--reference-top') > 250);

  dispatchPointer(rendered.handle, 'pointerup', 1200, 310);
  await harness.flushMicrotasks();
  rendered = getBadge(harness.document);

  assert.equal(rendered.host.getAttribute('data-dragging'), null);
  assert.equal(rendered.host.getAttribute('data-edge'), 'right');
  assert.equal(rendered.handle.hasPointerCapture(7), false);
  assert.equal(harness.storageCalls.set.length, 1);
  const saved = harness.storageCalls.set[0][CONFIG_STORAGE_KEY].position;
  assert.equal(saved.edge, 'right');
  assert.ok(saved.ratio > 0 && saved.ratio < 1);
});

test('snaps to the nearest top or left edge', async () => {
  const topHarness = createHarness('https://gitlab.com/acme/platform/-/issues/1');
  await topHarness.flushMicrotasks();
  let rendered = getBadge(topHarness.document);
  rendered.host.setBoundingClientRect({ left: 560, top: 300, width: 160, height: 30 });
  dispatchPointer(rendered.handle, 'pointerdown', 568, 312);
  dispatchPointer(rendered.handle, 'pointermove', 900, 12);
  dispatchPointer(rendered.handle, 'pointerup', 900, 12);
  await topHarness.flushMicrotasks();
  assert.equal(rendered.host.getAttribute('data-edge'), 'top');
  assert.equal(readPixelStyle(rendered.host, '--reference-top'), 8);

  const leftHarness = createHarness('https://gitlab.com/acme/platform/-/issues/2');
  await leftHarness.flushMicrotasks();
  rendered = getBadge(leftHarness.document);
  rendered.host.setBoundingClientRect({ left: 560, top: 300, width: 160, height: 30 });
  dispatchPointer(rendered.handle, 'pointerdown', 568, 312);
  dispatchPointer(rendered.handle, 'pointermove', 12, 500);
  dispatchPointer(rendered.handle, 'pointerup', 12, 500);
  await leftHarness.flushMicrotasks();
  assert.equal(rendered.host.getAttribute('data-edge'), 'left');
  assert.equal(readPixelStyle(rendered.host, '--reference-left'), 8);
});

test('restores a shared stored position and falls back from invalid data', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    storageData: {
      [POSITION_STORAGE_KEY]: { edge: 'right', ratio: 0.25 },
    },
  });
  await harness.flushMicrotasks();
  let rendered = getBadge(harness.document);

  assert.deepEqual(
    harness.storageCalls.get.map((keys) => [...keys]),
    [
      [CONFIG_STORAGE_KEY],
      ['language'],
      [CONFIG_STORAGE_KEY],
      [CONFIG_STORAGE_KEY, POSITION_STORAGE_KEY],
    ],
  );
  assert.equal(rendered.host.getAttribute('data-edge'), 'right');
  assert.equal(readPixelStyle(rendered.host, '--reference-left'), 1112);
  assert.equal(readPixelStyle(rendered.host, '--reference-top'), 196.5);

  const invalidHarness = createHarness('https://gitlab.com/other/project/-/issues/2', {
    storageData: {
      [POSITION_STORAGE_KEY]: { edge: 'bottom', ratio: 3 },
    },
  });
  await invalidHarness.flushMicrotasks();
  rendered = getBadge(invalidHarness.document);
  assert.equal(rendered.host.getAttribute('data-edge'), 'top');
  assert.equal(readPixelStyle(rendered.host, '--reference-top'), 8);
  assert.equal(readPixelStyle(rendered.host, '--reference-left'), 560);
});

test('pressing Home on a focused handle clears storage and restores top center', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    storageData: {
      [CONFIG_STORAGE_KEY]: {
        version: 1,
        position: { edge: 'left', ratio: 0.8 },
      },
    },
  });
  await harness.flushMicrotasks();
  const rendered = getBadge(harness.document);
  const homeKey = rendered.handle.dispatchEvent({ type: 'keydown', key: 'Home' });
  await harness.flushMicrotasks();

  assert.deepEqual(harness.storageCalls.remove, [POSITION_STORAGE_KEY]);
  assert.equal(rendered.host.getAttribute('data-edge'), 'top');
  assert.equal(readPixelStyle(rendered.host, '--reference-left'), 560);
  assert.equal(readPixelStyle(rendered.host, '--reference-top'), 8);
});

test('double-clicking the handle clears storage and restores top center', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    storageData: {
      [CONFIG_STORAGE_KEY]: {
        version: 1,
        position: { edge: 'left', ratio: 0.8 },
      },
    },
  });
  await harness.flushMicrotasks();
  const rendered = getBadge(harness.document);
  rendered.handle.dispatchEvent({ type: 'dblclick' });
  await harness.flushMicrotasks();

  assert.deepEqual(harness.storageCalls.remove, [POSITION_STORAGE_KEY]);
  assert.equal(rendered.host.getAttribute('data-edge'), 'top');
  assert.equal(readPixelStyle(rendered.host, '--reference-left'), 560);
  assert.equal(readPixelStyle(rendered.host, '--reference-top'), 8);
});

test('reconstrains the control on resize and chooses an inward panel direction', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    storageData: {
      [CONFIG_STORAGE_KEY]: {
        version: 1,
        position: { edge: 'right', ratio: 1 },
      },
    },
  });
  await harness.flushMicrotasks();
  const rendered = getBadge(harness.document);
  assert.equal(rendered.host.getAttribute('data-panel-placement'), 'up');

  harness.setViewport(320, 200);
  harness.dispatchWindow('resize');
  harness.flushAnimationFrames();

  assert.equal(readPixelStyle(rendered.host, '--reference-left'), 152);
  assert.equal(readPixelStyle(rendered.host, '--reference-top'), 162);
  assert.equal(rendered.host.getAttribute('data-panel-placement'), 'up');
  assert.match(rendered.style.textContent, /data-panel-placement="up"[\s\S]*bottom:\s*calc\(100% \+ 6px\)/);
  assert.match(rendered.style.textContent, /data-panel-placement="right"[\s\S]*left:\s*calc\(100% \+ 6px\)/);
  assert.match(rendered.style.textContent, /data-panel-placement="left"[\s\S]*right:\s*calc\(100% \+ 6px\)/);
});

test('pointer cancellation restores the prior snapped position without saving', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1');
  await harness.flushMicrotasks();
  const rendered = getBadge(harness.document);
  rendered.host.setBoundingClientRect({ left: 560, top: 8, width: 160, height: 30 });

  dispatchPointer(rendered.handle, 'pointerdown', 568, 20);
  dispatchPointer(rendered.handle, 'pointermove', 12, 500);
  dispatchPointer(rendered.handle, 'pointercancel', 12, 500);

  assert.equal(rendered.host.getAttribute('data-edge'), 'top');
  assert.equal(readPixelStyle(rendered.host, '--reference-left'), 560);
  assert.equal(readPixelStyle(rendered.host, '--reference-top'), 8);
  assert.equal(rendered.handle.hasPointerCapture(7), false);
  assert.equal(harness.storageCalls.set.length, 0);
});

test('destroy releases an active drag and removes resize behavior', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1');
  await harness.flushMicrotasks();
  const rendered = getBadge(harness.document);
  rendered.host.setBoundingClientRect({ left: 560, top: 8, width: 160, height: 30 });
  dispatchPointer(rendered.handle, 'pointerdown', 568, 20);
  dispatchPointer(rendered.handle, 'pointermove', 12, 500);
  assert.equal(rendered.handle.hasPointerCapture(7), true);

  harness.context.GitLabReferenceBadge.destroy();
  assert.equal(rendered.handle.hasPointerCapture(7), false);
  harness.setViewport(320, 200);
  harness.dispatchWindow('resize');
  harness.flushAnimationFrames();
  assert.equal(getBadge(harness.document).host, null);
});

test('copies an Issue reference and restores the default state after 1500ms', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15');
  const rendered = getBadge(harness.document);

  rendered.button.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();

  assert.deepEqual(harness.clipboardWrites, ['#15']);
  assert.equal(rendered.button.getAttribute('data-copy-state'), 'success');
  assert.equal(rendered.tooltip.textContent, 'Copied');
  assert.equal(rendered.button.children.filter((node) => node.tagName === 'SVG').length, 1);
  assert.equal(rendered.icon.getAttribute('data-copy-icon'), 'success');
  assert.equal(rendered.icon.children.length, 1);
  assert.equal(rendered.icon.children[0].getAttribute('d'), SUCCESS_PATH);
  assert.equal(rendered.announcement.textContent, 'Copied');

  harness.advanceTimersBy(1499);
  assert.equal(rendered.button.getAttribute('data-copy-state'), 'success');
  harness.advanceTimersBy(1);
  assert.equal(rendered.button.getAttribute('data-copy-state'), 'default');
  assert.equal(rendered.tooltip.textContent, 'Copy #15');
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
  assert.equal(rendered.button.getAttribute('aria-label'), 'Copy !14');
  assert.equal(rendered.tooltip.textContent, 'Copied');
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
  assert.equal(rendered.tooltip.textContent, 'Copy failed');
  assert.equal(rendered.icon.getAttribute('data-copy-icon'), 'copy');
  assert.equal(rendered.icon.children.length, 2);
  assert.equal(rendered.announcement.textContent, 'Copy failed');

  harness.advanceTimersBy(1500);
  assert.equal(rendered.button.getAttribute('data-copy-state'), 'default');
  assert.equal(rendered.tooltip.textContent, 'Copy #10');
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
  assert.equal(rendered.tooltip.textContent, 'Copy failed');
  assert.equal(rendered.announcement.textContent, 'Copy failed');
});

// ---- #11 P1 copy-success toast (spec §4): a separate surface sharing the copy
// button anchor with the tooltip, mutually exclusive while visible. Dwells
// 1800ms, fades 150ms, replaces in place; SR hears the announcement only.

test('#11 P1 copy-success toast shows in place, dwells 1800ms, then fades over 150ms', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15');
  const rendered = getBadge(harness.document);

  rendered.button.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();

  assert.deepEqual(harness.clipboardWrites, ['#15']);
  assert.equal(rendered.button.getAttribute('data-copy-toast'), 'on');
  assert.equal(rendered.toast.getAttribute('aria-hidden'), 'true');
  assert.equal(rendered.toastLabel.textContent, 'Copied');
  const toastIcon = rendered.toast.querySelector('[data-copy-toast-icon]');
  assert.ok(toastIcon);
  assert.equal(toastIcon.getAttribute('width'), '16');
  assert.equal(toastIcon.getAttribute('aria-hidden'), 'true');

  // 1499ms: still dwelling.
  harness.advanceTimersBy(1499);
  assert.equal(rendered.button.getAttribute('data-copy-toast'), 'on');

  // 1800ms total: dwell ends, fade-out starts.
  harness.advanceTimersBy(301);
  assert.equal(rendered.button.getAttribute('data-copy-toast'), 'leaving');

  // 1950ms total: fade done, attribute dropped (no stacking on repeat copies).
  harness.advanceTimersBy(150);
  assert.equal(rendered.button.getAttribute('data-copy-toast'), null);
});

test('#11 P1 a repeated copy replaces the toast in place and resets the dwell', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15');
  const rendered = getBadge(harness.document);

  rendered.button.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();
  assert.equal(rendered.button.getAttribute('data-copy-toast'), 'on');

  // Second copy at t=1000 clears the first dwell timer and starts a fresh one.
  harness.advanceTimersBy(1000);
  rendered.button.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();
  assert.equal(rendered.button.getAttribute('data-copy-toast'), 'on');

  // t=2700: the ORIGINAL timer (due at 1800) must have been cancelled, so the
  // toast is still fully on — a stale fade would have put it in 'leaving'.
  harness.advanceTimersBy(1700);
  assert.equal(rendered.button.getAttribute('data-copy-toast'), 'on');

  // t=2800: second dwell ends.
  harness.advanceTimersBy(100);
  assert.equal(rendered.button.getAttribute('data-copy-toast'), 'leaving');
  harness.advanceTimersBy(150);
  assert.equal(rendered.button.getAttribute('data-copy-toast'), null);
});

test('#11 P1 a failed copy never shows the success toast', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/10', {
    clipboardResults: [new Error('blocked')],
    execCommandResult: false,
  });
  const rendered = getBadge(harness.document);

  rendered.button.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();

  assert.equal(rendered.button.getAttribute('data-copy-state'), 'error');
  assert.equal(rendered.button.getAttribute('data-copy-toast'), null);
  assert.equal(rendered.toastLabel.textContent, '');
});

test('#11 P1 reduced motion hides the toast instantly with no fade phase', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    reducedMotion: true,
  });
  const rendered = getBadge(harness.document);

  rendered.button.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();
  assert.equal(rendered.button.getAttribute('data-copy-toast'), 'on');

  // Dwell ends at 1800ms; hideCopyToast drops the attribute directly under
  // prefers-reduced-motion (no 'leaving' intermediate, no 150ms fade).
  harness.advanceTimersBy(1800);
  assert.equal(rendered.button.getAttribute('data-copy-toast'), null);
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
  assert.equal(mergeRequest.button.getAttribute('aria-label'), 'Copy !456');
  assert.equal(mergeRequest.button.getAttribute('data-copy-state'), 'default');
  assert.equal(mergeRequest.tooltip.textContent, 'Copy !456');
  assert.equal(mergeRequest.announcement.textContent, '');
});

test('responds to glr:navigate dispatched on window (MAIN-world hook channel)', () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/7');

  assert.equal(getBadge(harness.document).label.textContent, 'Issue #7');

  // Simulates src/navigation-hook.js dispatching from the MAIN world onto
  // window — a DOM event on window never reaches document listeners, so the
  // content script must register glr:navigate on window (not document).
  harness.location.href = 'https://gitlab.com/acme/platform/-/merge_requests/9';
  harness.dispatchWindow('glr:navigate', { detail: { type: 'pushState' } });
  harness.flushAnimationFrames();

  const mergeRequest = getBadge(harness.document);
  assert.equal(mergeRequest.label.textContent, 'MR !9');
  assert.equal(mergeRequest.button.getAttribute('data-copy-text'), '!9');
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
  assert.equal(rendered.tooltip.textContent, 'Copy !3');
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
  assert.equal(rendered.tooltip.textContent, 'Copied');
  assert.deepEqual(harness.execCommandCalls, []);
});

test('uses DOM mutations to detect URL changes and removes stale badges', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/5', {
    storageData: {
      gitlabReferenceConfig: {
        version: 6,
        user: { showOnAllRepoPages: false },
        userOverrides: { showOnAllRepoPages: true },
      },
    },
  });

  // Let the async config load settle so the effective (off) preference,
  // not the in-memory default, drives the first render.
  await harness.flushMicrotasks();
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
  assert.match(renderedText(current), /#15Current issueCurrent/);

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

test('loads all-state items when itemStateFilter is all, with closed visual distinction', async () => {
  const harness = createHarness(
    'https://git.example.test/group/app/-/issues/15',
    {
      storageData: {
        [CONFIG_STORAGE_KEY]: {
          version: 4,
          user: { itemStateFilter: 'all' },
          userOverrides: { itemStateFilter: true },
        },
      },
      fetchResults: [
        jsonResponse([
          { iid: 15, title: 'Current issue', state: 'opened' },
          { iid: 14, title: 'Closed issue', state: 'closed' },
        ]),
        jsonResponse([
          { iid: 8, title: 'Merged MR', state: 'merged' },
        ]),
      ],
    },
  );

  const rendered = await openAndLoad(harness);

  assert.deepEqual(
    harness.fetchCalls.map(({ url }) => url),
    [
      'https://git.example.test/api/v4/projects/group%2Fapp/issues'
        + '?state=all&scope=all&order_by=updated_at&sort=desc&per_page=100&page=1',
      'https://git.example.test/api/v4/projects/group%2Fapp/merge_requests'
        + '?state=all&scope=all&order_by=updated_at&sort=desc&per_page=100&page=1',
    ],
  );

  const closed = rendered.panel.querySelector('[data-iid="14"]');
  assert.equal(closed.getAttribute('data-item-state'), 'closed');
  const merged = rendered.panel.querySelector('[data-iid="8"]');
  assert.equal(merged.getAttribute('data-item-state'), 'merged');
  const currentRows = rendered.panel.querySelectorAll('[data-current-open-item]');
  assert.equal(currentRows.length, 1);
  assert.equal(currentRows[0].getAttribute('data-iid'), '15');
  assert.equal(currentRows[0].getAttribute('data-item-state'), null);
});

test('keeps state=opened by default and adjusts empty-state copy in all mode', async () => {
  const openHarness = createHarness('https://git.example.test/group/app/-/issues/15', {
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });
  const openRendered = await openAndLoad(openHarness);
  assert.match(openHarness.fetchCalls[0].url, /state=opened/);
  const openText = renderedText(openRendered.panel);
  assert.match(openText, /No open issues/);
  assert.match(openText, /No open MRs/);
  assert.doesNotMatch(openText, /No open items/);

  const allHarness = createHarness('https://git.example.test/group/app/-/issues/15', {
    storageData: {
      [CONFIG_STORAGE_KEY]: {
        version: 4,
        user: { itemStateFilter: 'all' },
        userOverrides: { itemStateFilter: true },
      },
    },
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });
  const allRendered = await openAndLoad(allHarness);
  const allText = renderedText(allRendered.panel);
  assert.match(allHarness.fetchCalls[0].url, /state=all/);
  assert.match(allText, /No issues/);
  assert.match(allText, /No MRs/);
  assert.doesNotMatch(allText, /No open/);
});

test('#16 renders a panel-owned state filter row and a settings button in the header', async () => {
  const harness = createHarness('https://git.example.test/group/app/-/issues/15', {
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });

  const rendered = await openAndLoad(harness);

  assert.equal(rendered.stateControls.getAttribute('data-item-state-controls'), '');
  assert.equal(rendered.stateFilterOpen.tagName, 'BUTTON');
  assert.equal(rendered.stateFilterOpen.textContent, 'Open only');
  assert.equal(rendered.stateFilterAll.textContent, 'All states');
  assert.equal(rendered.stateFilterOpen.getAttribute('aria-pressed'), 'true');
  assert.equal(rendered.stateFilterAll.getAttribute('aria-pressed'), 'false');
  // The state row sits between the type-filter controls row and the results.
  const panelChildren = [...rendered.panel.children];
  const controlsIndex = panelChildren.findIndex(
    (node) => node.getAttribute('data-open-items-controls') !== null,
  );
  const stateIndex = panelChildren.indexOf(rendered.stateControls);
  const resultsIndex = panelChildren.findIndex(
    (node) => node.getAttribute('data-open-items-results') !== null,
  );
  assert.ok(controlsIndex >= 0 && stateIndex === controlsIndex + 1
    && resultsIndex > stateIndex);

  assert.equal(rendered.openOptions.tagName, 'BUTTON');
  assert.equal(rendered.openOptions.getAttribute('aria-label'), 'Open settings page');
  const header = rendered.panel.querySelector('[data-open-items-header]');
  const buttonOrder = [...header.children].map((child) => child.getAttribute('data-open-options') === '' || child.getAttribute('data-refresh-open-items') === '');
  assert.ok(buttonOrder.length >= 3);
  assert.equal(header.children[1].getAttribute('data-open-options'), '');
  assert.equal(header.children[2].getAttribute('data-refresh-open-items'), '');
});

test('#16/#20 clicking the header settings button asks the service worker to open the options page', async () => {
  const harness = createHarness('https://git.example.test/group/app/-/issues/15', {
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });

  const rendered = await openAndLoad(harness);
  assert.equal(harness.runtimeSendMessageCalls.length, 0);
  assert.equal(harness.windowOpenCalls.length, 0);
  rendered.openOptions.dispatchEvent({ type: 'click' });
  // #20 (final): openOptionsPage no-ops and getURL + window.open is blocked in
  // content-script contexts, so the handler must delegate to the service worker
  // via runtime.sendMessage; it must not use window.open directly.
  assert.equal(harness.windowOpenCalls.length, 0);
  assert.equal(harness.runtimeOpenOptionsCalls.length, 0);
  assert.equal(harness.runtimeSendMessageCalls.length, 1);
  assert.equal(harness.runtimeSendMessageCalls[0]?.type, 'gitlab-reference-open-options');
});

test('#16 switching the panel state filter to all refetches with state=all and updates counts', async () => {
  const harness = createHarness('https://git.example.test/group/app/-/issues/15', {
    fetchResults: [
      jsonResponse([{ iid: 15, title: 'Open issue', state: 'opened' }]),
      jsonResponse([{ iid: 7, title: 'Open MR', state: 'opened' }]),
      jsonResponse([
        { iid: 15, title: 'Open issue', state: 'opened' },
        { iid: 14, title: 'Closed issue', state: 'closed' },
      ]),
      jsonResponse([{ iid: 8, title: 'Merged MR', state: 'merged' }]),
    ],
  });

  const rendered = await openAndLoad(harness);
  assert.match(harness.fetchCalls[0].url, /state=opened/);
  assert.equal(rendered.panel.querySelector('[data-open-items-total]').textContent, '2');

  rendered.stateFilterAll.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();
  const afterSwitch = getBadge(harness.document);

  assert.match(harness.fetchCalls[2].url, /state=all/);
  assert.equal(afterSwitch.stateFilterAll.getAttribute('aria-pressed'), 'true');
  assert.equal(afterSwitch.stateFilterOpen.getAttribute('aria-pressed'), 'false');
  assert.equal(afterSwitch.panel.querySelector('[data-open-items-total]').textContent, '3');
  const closed = afterSwitch.panel.querySelector('[data-iid="14"]');
  assert.equal(closed.getAttribute('data-item-state'), 'closed');

  // The choice persists through the config store (panel is the single entry).
  await harness.flushMicrotasks();
  const savedWrites = harness.storageCalls.set
    .map((value) => value[CONFIG_STORAGE_KEY])
    .filter(Boolean);
  assert.equal(savedWrites.at(-1).user.itemStateFilter, 'all');
  assert.equal(savedWrites.at(-1).userOverrides.itemStateFilter, true);
});

test('#16 state filter choice survives navigation to another project without refetch churn', async () => {
  const harness = createHarness('https://git.example.test/group/app/-/issues/15', {
    fetchResults: [
      jsonResponse([{ iid: 15, title: 'Open issue', state: 'opened' }]),
      jsonResponse([]),
      jsonResponse([{ iid: 15, title: 'Open issue', state: 'opened' }]),
      jsonResponse([]),
    ],
  });

  const rendered = await openAndLoad(harness);
  rendered.stateFilterAll.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();
  assert.match(harness.fetchCalls[2].url, /state=all/);

  harness.location.href = 'https://git.example.test/group/app/-/merge_requests/7';
  harness.triggerMutation();
  harness.flushAnimationFrames();
  await harness.flushMicrotasks();

  const reopened = getBadge(harness.document);
  reopened.trigger.dispatchEvent({ type: 'focus' });
  await harness.flushMicrotasks();

  const navigated = getBadge(harness.document);
  assert.equal(navigated.stateFilterAll.getAttribute('aria-pressed'), 'true');
});

test('renders an accessible local search field and type filters', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });

  const rendered = await openAndLoad(harness);

  assert.equal(rendered.search.tagName, 'INPUT');
  assert.equal(rendered.search.getAttribute('type'), 'search');
  assert.equal(rendered.search.getAttribute('aria-label'), 'Search open items');
  assert.equal(rendered.search.getAttribute('placeholder'), 'Search number or title');
  assert.equal(rendered.searchSummary.getAttribute('aria-live'), 'polite');
  assert.equal(rendered.searchSummary.getAttribute('aria-atomic'), 'true');
  assert.equal(rendered.filterAll.tagName, 'BUTTON');
  assert.equal(rendered.filterIssue.tagName, 'BUTTON');
  assert.equal(rendered.filterMergeRequest.tagName, 'BUTTON');
  assert.equal(rendered.filterAll.textContent, 'All');
  assert.equal(rendered.filterIssue.textContent, 'Issue');
  assert.equal(rendered.filterMergeRequest.textContent, 'MR');
  assert.equal(rendered.filterAll.getAttribute('aria-pressed'), 'true');
  assert.equal(rendered.filterIssue.getAttribute('aria-pressed'), 'false');
  assert.equal(rendered.filterMergeRequest.getAttribute('aria-pressed'), 'false');
});

test('keeps one live region while announcing filtered result changes', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/12', {
    fetchResults: [
      jsonResponse([
        { iid: 12, title: 'Release blocker' },
        { iid: 13, title: 'Documentation' },
      ]),
      jsonResponse([{ iid: 8, title: 'Release MR' }]),
    ],
  });
  let rendered = await openAndLoad(harness);
  const summary = rendered.searchSummary;

  assert.equal(summary.textContent, 'Found 3 open items');

  rendered = searchOpenItems(harness, 'release');
  assert.equal(rendered.searchSummary, summary);
  assert.equal(summary.textContent, 'Found 2 open items');

  rendered = searchOpenItems(harness, 'missing');
  assert.equal(rendered.searchSummary, summary);
  assert.equal(summary.textContent, 'No matching open items');
});

test('stops search keyboard events before they reach GitLab shortcuts', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/12', {
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });
  const rendered = await openAndLoad(harness);

  for (const type of ['keydown', 'keypress', 'keyup']) {
    const event = { type, key: 's' };
    rendered.search.dispatchEvent(event);
    assert.equal(event.propagationStopped, true, `${type} should stop propagation`);
  }
});

test('searches exact references and case-insensitive title substrings locally', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/12', {
    fetchResults: [
      jsonResponse([
        { iid: 12, title: 'Release blocker' },
        { iid: 123, title: 'Unrelated issue' },
      ]),
      jsonResponse([
        { iid: 12, title: 'Release notes' },
        { iid: 456, title: 'Hotfix MR' },
      ]),
    ],
  });
  await openAndLoad(harness);

  let rendered = searchOpenItems(harness, '#12');
  assert.deepEqual(
    rendered.panel.querySelectorAll('[data-open-item]').map((row) => [
      row.getAttribute('data-kind'),
      row.getAttribute('data-iid'),
    ]),
    [['issue', '12']],
  );

  rendered = searchOpenItems(harness, '!456');
  assert.deepEqual(
    rendered.panel.querySelectorAll('[data-open-item]').map((row) => [
      row.getAttribute('data-kind'),
      row.getAttribute('data-iid'),
    ]),
    [['merge-request', '456']],
  );

  rendered = searchOpenItems(harness, '12');
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]').length, 2);

  rendered.search.focus();
  rendered.search.value = '  RELEASE  ';
  rendered.search.setSelectionRange(3, 8);
  rendered.search.dispatchEvent({ type: 'input' });
  rendered = getBadge(harness.document);
  assert.equal(rendered.search.value, '  RELEASE  ');
  assert.equal(rendered.host.shadowRoot.activeElement, rendered.search);
  assert.equal(rendered.search.selectionStart, 3);
  assert.equal(rendered.search.selectionEnd, 8);
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]').length, 2);
  assert.equal(harness.fetchCalls.length, 2);
});

test('matches bare numbers against titles by default (title scope)', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/8', {
    fetchResults: [
      jsonResponse([
        { iid: 8, title: 'Fix login bug' },
        { iid: 11, title: 'Depends on #8' },
      ]),
      jsonResponse([
        { iid: 48, title: 'Backend refactor 8' },
        { iid: 3, title: 'Unrelated' },
      ]),
    ],
  });
  await openAndLoad(harness);

  const rendered = searchOpenItems(harness, '8');
  assert.deepEqual(
    rendered.panel.querySelectorAll('[data-open-item]').map((row) => [
      row.getAttribute('data-kind'),
      row.getAttribute('data-iid'),
    ]),
    [['issue', '8'], ['issue', '11'], ['merge-request', '48']],
  );
});

test('restricts bare-number search to exact iid in number scope', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/8', {
    storageData: {
      [CONFIG_STORAGE_KEY]: {
        version: 2,
        user: { searchScope: 'number' },
      },
    },
    fetchResults: [
      jsonResponse([
        { iid: 8, title: 'Fix login bug' },
        { iid: 11, title: 'Depends on #8' },
      ]),
      jsonResponse([
        { iid: 48, title: 'Backend refactor 8' },
        { iid: 3, title: 'Unrelated' },
      ]),
    ],
  });
  await openAndLoad(harness);

  const rendered = searchOpenItems(harness, '8');
  assert.deepEqual(
    rendered.panel.querySelectorAll('[data-open-item]').map((row) => [
      row.getAttribute('data-kind'),
      row.getAttribute('data-iid'),
    ]),
    [['issue', '8']],
  );
});

test('keeps # and ! references exact regardless of search scope', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/8', {
    storageData: {
      [CONFIG_STORAGE_KEY]: {
        version: 2,
        user: { searchScope: 'number' },
      },
    },
    fetchResults: [
      jsonResponse([
        { iid: 8, title: 'Fix login bug' },
        { iid: 11, title: 'Depends on #8' },
      ]),
      jsonResponse([
        { iid: 48, title: 'Backend refactor 8' },
        { iid: 3, title: 'Unrelated' },
      ]),
    ],
  });
  await openAndLoad(harness);

  let rendered = searchOpenItems(harness, '#8');
  assert.deepEqual(
    rendered.panel.querySelectorAll('[data-open-item]').map((row) => row.getAttribute('data-iid')),
    ['8'],
  );

  rendered = searchOpenItems(harness, '!48');
  assert.deepEqual(
    rendered.panel.querySelectorAll('[data-open-item]').map((row) => row.getAttribute('data-iid')),
    ['48'],
  );
});

test('updates search results during IME composition without replacing the input node', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/12', {
    fetchResults: [
      jsonResponse([
        { iid: 12, title: '中文输入修复' },
        { iid: 13, title: 'Unrelated issue' },
      ]),
      jsonResponse([]),
    ],
  });
  let rendered = await openAndLoad(harness);
  const search = rendered.search;
  search.focus();
  search.dispatchEvent({ type: 'compositionstart' });
  search.value = '中文';
  search.setSelectionRange(2, 2);
  search.dispatchEvent({ type: 'input', isComposing: true });

  rendered = getBadge(harness.document);
  assert.equal(rendered.search, search);
  assert.equal(rendered.host.shadowRoot.activeElement, search);
  assert.deepEqual(
    rendered.panel.querySelectorAll('[data-open-item]').map((row) => row.getAttribute('data-iid')),
    ['12'],
  );
  assert.equal(rendered.panel.querySelector('[data-open-items-total]').textContent, '1');
});

test('preserves an active IME search input when the initial load completes', async () => {
  const issues = deferred();
  const mergeRequests = deferred();
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/12', {
    fetchResults: [issues, mergeRequests],
  });
  getBadge(harness.document).trigger.dispatchEvent({ type: 'focus' });
  await harness.flushMicrotasks();

  let rendered = getBadge(harness.document);
  const search = rendered.search;
  search.focus();
  search.dispatchEvent({ type: 'compositionstart' });
  search.value = '中文';
  search.setSelectionRange(2, 2);
  search.dispatchEvent({ type: 'input', isComposing: true });

  issues.resolve(jsonResponse([{ iid: 12, title: '中文输入修复' }]));
  mergeRequests.resolve(jsonResponse([]));
  await harness.flushMicrotasks();
  rendered = getBadge(harness.document);

  assert.equal(rendered.search, search);
  assert.equal(rendered.host.shadowRoot.activeElement, search);
  assert.equal(rendered.search.value, '中文');
  assert.equal(rendered.panel.querySelector('[data-open-items-total]').textContent, '1');
});

test('combines local text search with type filters without refetching', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [
      jsonResponse([
        { iid: 15, title: 'Current release issue' },
        { iid: 16, title: 'Documentation' },
      ]),
      jsonResponse([
        { iid: 8, title: 'Release MR' },
        { iid: 9, title: 'Maintenance' },
      ]),
    ],
  });
  await openAndLoad(harness);

  searchOpenItems(harness, 'release');
  let rendered = filterOpenItems(harness, 'merge-request');
  assert.equal(rendered.filterMergeRequest.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(
    rendered.panel.querySelectorAll('[data-open-item]').map((row) => row.getAttribute('data-iid')),
    ['8'],
  );

  rendered = filterOpenItems(harness, 'issue');
  assert.equal(rendered.filterIssue.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(
    rendered.panel.querySelectorAll('[data-open-item]').map((row) => row.getAttribute('data-iid')),
    ['15'],
  );

  rendered = searchOpenItems(harness, '');
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]').length, 2);
  assert.equal(rendered.panel.querySelector('[data-open-items-total]').textContent, '2');
  assert.equal(harness.fetchCalls.length, 2);
});

test('hides a nonmatching current item and distinguishes no matches from loading and errors', async () => {
  const issues = deferred();
  const mergeRequests = deferred();
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [issues, mergeRequests],
  });

  getBadge(harness.document).trigger.dispatchEvent({ type: 'focus' });
  await harness.flushMicrotasks();
  let rendered = searchOpenItems(harness, 'missing');
  assert.equal(rendered.panel.querySelector('[data-open-items-empty]'), null);
  assert.equal(
    rendered.panel.querySelectorAll('[data-open-items-state="loading"]').length,
    2,
  );

  issues.resolve(jsonResponse([{ iid: 15, title: 'Current issue' }]));
  mergeRequests.reject(new Error('MRs unavailable'));
  await harness.flushMicrotasks();
  rendered = getBadge(harness.document);
  assert.equal(rendered.panel.querySelector('[data-current-open-item]'), null);
  assert.equal(rendered.panel.querySelector('[data-open-items-empty]'), null);
  assert.ok(rendered.panel.querySelector('[data-open-items-state="error"]'));
});

test('shows one clear empty state when loaded items do not match', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [
      jsonResponse([{ iid: 15, title: 'Current issue' }]),
      jsonResponse([{ iid: 8, title: 'Open MR' }]),
    ],
  });
  await openAndLoad(harness);

  const rendered = searchOpenItems(harness, 'missing');
  const empty = rendered.panel.querySelector('[data-open-items-empty]');
  assert.equal(empty.getAttribute('role'), 'status');
  assert.equal(
    empty.querySelector('[data-open-items-empty-title]').textContent,
    'No matching open items',
  );
  assert.ok(empty.querySelector('[data-open-items-empty-icon]'));
  assert.equal(empty.querySelector('[data-open-items-empty-icon]').getAttribute('aria-hidden'), 'true');
  assert.equal(
    empty.querySelector('[data-open-items-empty-hint]').textContent,
    'Try a different number or keyword.',
  );
  const action = empty.querySelector('[data-open-items-empty-action]');
  assert.ok(action);
  assert.equal(action.textContent, 'Clear search');
  assert.equal(action.tagName, 'BUTTON');
  assert.equal(rendered.panel.querySelectorAll('[data-open-items-group]').length, 0);
  assert.equal(rendered.panel.querySelector('[data-open-items-total]').textContent, '0');
});

test('distinguishes a project with no Open items from filtered no matches', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });

  const rendered = await openAndLoad(harness);
  const openText = renderedText(rendered.panel);
  assert.match(openText, /No open issues/);
  assert.match(openText, /No open MRs/);
  assert.equal(rendered.panel.querySelector('[data-open-items-empty]'), null);
  assert.equal(rendered.panel.querySelectorAll('[data-open-items-group]').length, 2);
  assert.equal(rendered.panel.querySelector('[data-open-items-total]').textContent, '0');
});

test('treats an empty type filter as no matches when another type has open items', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [
      jsonResponse([]),
      jsonResponse([{ iid: 8, title: 'Open MR' }]),
    ],
  });
  await openAndLoad(harness);

  const rendered = filterOpenItems(harness, 'issue');
  const empty = rendered.panel.querySelector('[data-open-items-empty]');
  assert.equal(empty.getAttribute('role'), 'status');
  assert.equal(
    empty.querySelector('[data-open-items-empty-title]').textContent,
    'No matching open items',
  );
  assert.equal(
    empty.querySelector('[data-open-items-empty-hint]').textContent,
    'Try a different number or keyword.',
  );
  // A type filter (not a query) hides everything: the single action widens it.
  const action = empty.querySelector('[data-open-items-empty-action]');
  assert.ok(action);
  assert.equal(action.textContent, 'Show all types');
  assert.equal(rendered.panel.querySelector('[data-open-items-total]').textContent, '0');
});

// ---- #11 P1 spec §3: the empty state carries at most one action button that
// removes the cause of the empty view.

test('#11 P1 empty-state "Clear search" action clears the query, re-renders, and refocuses search', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [
      jsonResponse([{ iid: 15, title: 'Current issue' }]),
      jsonResponse([{ iid: 8, title: 'Open MR' }]),
    ],
  });
  await openAndLoad(harness);

  let rendered = searchOpenItems(harness, 'missing');
  const empty = rendered.panel.querySelector('[data-open-items-empty]');
  const action = empty.querySelector('[data-open-items-empty-action]');
  assert.equal(action.textContent, 'Clear search');

  action.dispatchEvent({ type: 'click' });
  rendered = getBadge(harness.document);

  // The search box itself must reflect the cleared query, not just the rows.
  assert.equal(rendered.search.value, '');
  assert.equal(rendered.panel.querySelector('[data-open-items-empty]'), null);
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]').length, 2);
  assert.equal(rendered.panel.querySelector('[data-open-items-total]').textContent, '2');
  assert.equal(rendered.host.shadowRoot.activeElement, rendered.search);
});

test('#11 P1 empty-state "Show all types" action resets the type filter without refetching', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [
      jsonResponse([]),
      jsonResponse([{ iid: 8, title: 'Open MR' }]),
    ],
  });
  await openAndLoad(harness);
  const fetchCallsBeforeAction = harness.fetchCalls.length;

  let rendered = filterOpenItems(harness, 'issue');
  const action = rendered.panel.querySelector('[data-open-items-empty-action]');
  assert.equal(action.textContent, 'Show all types');

  action.dispatchEvent({ type: 'click' });
  rendered = getBadge(harness.document);

  assert.equal(rendered.filterAll.getAttribute('aria-pressed'), 'true');
  assert.equal(rendered.panel.querySelector('[data-open-items-empty]'), null);
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]').length, 1);
  assert.equal(rendered.panel.querySelector('[data-open-items-total]').textContent, '1');
  // Pure client-side re-render: no extra API calls.
  assert.equal(harness.fetchCalls.length, fetchCallsBeforeAction);
});

test('#11 P1 an issue-only list with an errored hidden MR group still shows the empty state', async () => {
  // Issue-only list filter: the hidden MR group is unloaded/errored, so the
  // project does NOT count as "no open items" and the visible issue group is
  // empty. The structured empty state must still render, with the search hint
  // and the "Show all types" action (the type filter is what hides everything).
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    storageData: {
      [CONFIG_STORAGE_KEY]: {
        version: 2,
        user: { listFilter: 'issue' },
        userOverrides: { listFilter: true },
      },
    },
    fetchResults: [
      jsonResponse([]),
      new Error('MR fetch blocked'),
    ],
  });
  await openAndLoad(harness);

  const rendered = getBadge(harness.document);
  const empty = rendered.panel.querySelector('[data-open-items-empty]');
  assert.ok(empty);
  assert.equal(
    empty.querySelector('[data-open-items-empty-title]').textContent,
    'No matching open items',
  );
  assert.equal(
    empty.querySelector('[data-open-items-empty-hint]').textContent,
    'Try a different number or keyword.',
  );
  assert.equal(empty.querySelector('[data-open-items-empty-action]').textContent, 'Show all types');
  // Only the visible issue group participates in the empty decision.
  assert.equal(rendered.panel.querySelectorAll('[data-open-items-group]').length, 0);
});

test('keeps search, filter, panel state, and refresh focus during a manual refresh', async () => {
  const issueRefresh = deferred();
  const mergeRequestRefresh = deferred();
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [
      jsonResponse([{ iid: 15, title: 'Release issue' }]),
      jsonResponse([{ iid: 8, title: 'Release MR' }]),
      issueRefresh,
      mergeRequestRefresh,
    ],
  });
  await openAndLoad(harness);
  searchOpenItems(harness, 'release');
  let rendered = filterOpenItems(harness, 'merge-request');
  rendered.refresh.focus();
  rendered.refresh.dispatchEvent({ type: 'click' });

  rendered = getBadge(harness.document);
  assert.equal(rendered.panel.hidden, false);
  assert.equal(rendered.search.value, 'release');
  assert.equal(rendered.filterMergeRequest.getAttribute('aria-pressed'), 'true');
  assert.equal(rendered.host.shadowRoot.activeElement, rendered.refresh);

  issueRefresh.resolve(jsonResponse([{ iid: 16, title: 'New issue' }]));
  mergeRequestRefresh.resolve(jsonResponse([{ iid: 9, title: 'Release replacement' }]));
  await harness.flushMicrotasks();
  rendered = getBadge(harness.document);
  assert.equal(rendered.panel.hidden, false);
  assert.equal(rendered.search.value, 'release');
  assert.equal(rendered.filterMergeRequest.getAttribute('aria-pressed'), 'true');
  assert.equal(rendered.host.shadowRoot.activeElement, rendered.refresh);
  assert.equal(rendered.panel.querySelector('[data-open-item]').getAttribute('data-iid'), '9');
});

test('remembers search state across content contexts when enabled by default', async () => {
  const first = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });
  await openAndLoad(first);
  searchOpenItems(first, '#123');
  filterOpenItems(first, 'issue');
  await first.flushMicrotasks();

  assert.equal(first.storageData[CONFIG_STORAGE_KEY].searchState.query, '#123');
  assert.equal(first.storageData[CONFIG_STORAGE_KEY].searchState.listFilter, 'issue');

  const second = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    storageData: { [CONFIG_STORAGE_KEY]: first.storageData[CONFIG_STORAGE_KEY] },
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });
  const restored = await openAndLoad(second);
  assert.equal(restored.search.value, '#123');
  assert.equal(restored.filterIssue.getAttribute('aria-pressed'), 'true');
});

test('debounces repeated search persistence and saves only the latest query', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });
  await openAndLoad(harness);
  const writesBeforeSearch = harness.storageCalls.set.length;

  searchOpenItems(harness, 'r');
  searchOpenItems(harness, 're');
  searchOpenItems(harness, 'release');
  await harness.flushMicrotasks();
  assert.equal(harness.storageCalls.set.length, writesBeforeSearch);

  harness.advanceTimersBy(199);
  await harness.flushMicrotasks();
  assert.equal(harness.storageCalls.set.length, writesBeforeSearch);

  harness.advanceTimersBy(1);
  await harness.flushMicrotasks();
  assert.equal(harness.storageCalls.set.length, writesBeforeSearch + 1);
  assert.equal(
    harness.storageCalls.set.at(-1)[CONFIG_STORAGE_KEY].searchState.query,
    'release',
  );
});

test('keeps search state in the current session without storage writes when memory is disabled', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    storageData: {
      [CONFIG_STORAGE_KEY]: {
        version: 2,
        user: { rememberSearch: false },
        userOverrides: { rememberSearch: true },
      },
    },
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });
  let rendered = await openAndLoad(harness);
  const writesBeforeSearch = harness.storageCalls.set.length;
  searchOpenItems(harness, 'release');
  filterOpenItems(harness, 'merge-request');
  await harness.flushMicrotasks();
  assert.equal(harness.storageCalls.set.length, writesBeforeSearch);

  rendered = getBadge(harness.document);
  rendered.panel.dispatchEvent({ type: 'keydown', key: 'Escape' });
  rendered.trigger.dispatchEvent({ type: 'focus' });
  rendered = getBadge(harness.document);
  assert.equal(rendered.search.value, 'release');
  assert.equal(rendered.filterMergeRequest.getAttribute('aria-pressed'), 'true');
});

test('ignores stale persisted search state when search memory is disabled', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    storageData: {
      [CONFIG_STORAGE_KEY]: {
        version: 2,
        user: { listFilter: 'issue', rememberSearch: false },
        userOverrides: { listFilter: true, rememberSearch: true },
        searchState: { query: 'stale query', listFilter: 'merge-request' },
      },
    },
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });

  const rendered = await openAndLoad(harness);

  assert.equal(rendered.search.value, '');
  assert.equal(rendered.filterIssue.getAttribute('aria-pressed'), 'true');
  assert.equal(rendered.filterMergeRequest.getAttribute('aria-pressed'), 'false');
});

test('clears locally owned search when another context disables search memory', async () => {
  const initialConfig = {
    version: 2,
    user: { listFilter: 'issue', rememberSearch: true },
    userOverrides: { listFilter: true, rememberSearch: true },
    searchState: { query: '', listFilter: 'issue' },
  };
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    storageData: { [CONFIG_STORAGE_KEY]: initialConfig },
    fetchResults: [
      jsonResponse([{ iid: 15, title: 'Release issue' }]),
      jsonResponse([{ iid: 8, title: 'Release MR' }]),
    ],
  });
  await openAndLoad(harness);
  searchOpenItems(harness, 'release');
  filterOpenItems(harness, 'merge-request');
  await harness.flushMicrotasks();
  const fetchCount = harness.fetchCalls.length;

  const nextConfig = {
    ...harness.storageData[CONFIG_STORAGE_KEY],
    user: { listFilter: 'issue', rememberSearch: false },
    userOverrides: { listFilter: true, rememberSearch: true },
    searchState: { query: '', listFilter: 'issue' },
  };
  harness.storageData[CONFIG_STORAGE_KEY] = nextConfig;
  await harness.dispatchStorageChanged({
    [CONFIG_STORAGE_KEY]: {
      oldValue: initialConfig,
      newValue: nextConfig,
    },
  });
  await harness.flushMicrotasks();

  const rendered = getBadge(harness.document);
  assert.equal(rendered.search.value, '');
  assert.equal(rendered.filterIssue.getAttribute('aria-pressed'), 'true');
  assert.equal(rendered.filterMergeRequest.getAttribute('aria-pressed'), 'false');
  assert.equal(harness.fetchCalls.length, fetchCount);
});

test('applies the default list filter while still loading both item types', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    storageData: {
      [CONFIG_STORAGE_KEY]: {
        version: 1,
        user: { listFilter: 'issue', maxItemsPerType: 1 },
      },
    },
    fetchResults: [
      jsonResponse([
        { iid: 15, title: 'Current issue' },
        { iid: 16, title: 'Second issue' },
      ]),
      jsonResponse([{ iid: 8, title: 'Open MR' }]),
    ],
  });

  const rendered = await openAndLoad(harness);
  assert.equal(harness.fetchCalls.length, 2);
  assert.match(harness.fetchCalls[0].url, /issues\?[^#]*per_page=1/);
  assert.match(harness.fetchCalls[1].url, /merge_requests\?[^#]*per_page=1/);
  assert.equal(rendered.panel.querySelectorAll('[data-open-items-group]').length, 1);
  assert.equal(rendered.panel.querySelector('[data-open-items-group]').getAttribute('data-open-items-group'), 'issues');
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]').length, 1);
});

test('loads configured item groups sequentially', async () => {
  const issueResponse = deferred();
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    storageData: {
      [CONFIG_STORAGE_KEY]: {
        version: 1,
        user: { loadingMode: 'sequential' },
      },
    },
    fetchResults: [issueResponse, jsonResponse([{ iid: 8, title: 'Open MR' }])],
  });

  const rendered = await openAndLoad(harness);
  assert.equal(harness.fetchCalls.length, 1);
  assert.match(harness.fetchCalls[0].url, /\/issues\?/);
  issueResponse.resolve(jsonResponse([{ iid: 15, title: 'Current issue' }]));
  await harness.flushMicrotasks();

  assert.equal(harness.fetchCalls.length, 2);
  assert.match(harness.fetchCalls[1].url, /\/merge_requests\?/);
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]').length, 2);
});

test('renders last refresh time only when enabled', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    storageData: {
      [CONFIG_STORAGE_KEY]: {
        version: 1,
        user: { showLastRefresh: false },
      },
    },
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });

  const rendered = await openAndLoad(harness);
  assert.equal(rendered.panel.querySelector('[data-last-refresh]'), null);
  assert.equal(rendered.refresh.getAttribute('aria-busy'), 'false');
});

test('configuration load failures keep the reference control available', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    storageGetError: new Error('storage unavailable'),
  });
  await harness.flushMicrotasks();
  const rendered = getBadge(harness.document);
  assert.equal(rendered.label.textContent, 'Issue #15');
  assert.equal(rendered.button.getAttribute('data-copy-text'), '#15');
});

test('disables touch dragging and uses the configured keyboard step', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    storageData: {
      [CONFIG_STORAGE_KEY]: {
        version: 1,
        user: { touchDrag: false, keyboardStep: 20 },
      },
    },
  });
  await harness.flushMicrotasks();
  const rendered = getBadge(harness.document);
  assert.equal(rendered.host.getAttribute('data-touch-drag'), 'false');
  const writesBeforeMove = harness.storageCalls.set.length;

  const touchDown = dispatchPointer(rendered.handle, 'pointerdown', 568, 20, {
    pointerType: 'touch',
  });
  assert.equal(rendered.handle.hasPointerCapture(7), false);
  assert.equal(touchDown.propagationStopped, false);

  rendered.handle.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  assert.equal(readPixelStyle(rendered.host, '--reference-left'), 580);
  assert.equal(harness.storageCalls.set.length, writesBeforeMove);
  harness.advanceTimersBy(200);
  await harness.flushMicrotasks();
  assert.equal(harness.storageCalls.set.length, writesBeforeMove + 1);
});

test('coalesces repeated keyboard position changes into one storage write', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15');
  await harness.flushMicrotasks();
  const rendered = getBadge(harness.document);
  const initialPanelChild = rendered.panel.children[0];

  rendered.handle.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  rendered.handle.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  rendered.handle.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });

  assert.equal(harness.storageCalls.set.length, 0);
  harness.advanceTimersBy(199);
  assert.equal(harness.storageCalls.set.length, 0);
  harness.advanceTimersBy(1);
  await harness.flushMicrotasks();

  assert.equal(harness.storageCalls.set.length, 1);
  assert.equal(rendered.panel.children[0], initialPanelChild);
});

test('flushes a pending keyboard position before a subsequent drag save', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15');
  await harness.flushMicrotasks();
  const rendered = getBadge(harness.document);
  rendered.host.setBoundingClientRect({ left: 560, top: 8, width: 160, height: 30 });

  rendered.handle.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  assert.equal(harness.storageCalls.set.length, 0);

  dispatchPointer(rendered.handle, 'pointerdown', 568, 20);
  dispatchPointer(rendered.handle, 'pointermove', 12, 500);
  dispatchPointer(rendered.handle, 'pointerup', 12, 500);
  await harness.flushMicrotasks();

  assert.equal(harness.storageCalls.set.length, 2);
  const savedPositions = harness.storageCalls.set.map(
    (value) => value[CONFIG_STORAGE_KEY].position,
  );
  assert.equal(savedPositions[0].edge, 'top');
  assert.equal(savedPositions[1].edge, 'left');
  assert.equal(typeof savedPositions[1].ratio, 'number');
  assert.ok(savedPositions[1].ratio > 0 && savedPositions[1].ratio < 1);
  assert.equal(rendered.host.getAttribute('data-edge'), 'left');
  assert.equal(readPixelStyle(rendered.host, '--reference-left'), 8);
});

test('applies a persisted position update without rebuilding the navigation panel', async () => {
  const initialConfig = {
    version: 1,
    position: { edge: 'right', ratio: 0.25 },
  };
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    storageData: { [CONFIG_STORAGE_KEY]: initialConfig },
  });
  await harness.flushMicrotasks();
  const rendered = getBadge(harness.document);
  const nextConfig = {
    ...initialConfig,
    position: { edge: 'left', ratio: 0.75 },
  };
  harness.storageData[CONFIG_STORAGE_KEY] = nextConfig;
  const panelChild = rendered.panel.children[0];
  await harness.dispatchStorageChanged({
    [CONFIG_STORAGE_KEY]: { oldValue: initialConfig, newValue: nextConfig },
  });
  await harness.flushMicrotasks();

  assert.equal(rendered.host.getAttribute('data-edge'), 'left');
  assert.equal(readPixelStyle(rendered.host, '--reference-left'), 8);
  assert.equal(rendered.panel.children[0], panelChild);
});

test('restores the persisted position when a position write fails', async () => {
  const initialConfig = {
    version: 1,
    position: { edge: 'right', ratio: 0.25 },
  };
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    storageData: { [CONFIG_STORAGE_KEY]: initialConfig },
    storageSetError: new Error('quota exceeded'),
  });
  await harness.flushMicrotasks();
  const rendered = getBadge(harness.document);
  rendered.host.setBoundingClientRect({ left: 560, top: 8, width: 160, height: 30 });

  dispatchPointer(rendered.handle, 'pointerdown', 568, 20);
  dispatchPointer(rendered.handle, 'pointermove', 12, 500);
  dispatchPointer(rendered.handle, 'pointerup', 12, 500);
  await harness.flushMicrotasks();

  assert.equal(rendered.host.getAttribute('data-edge'), 'right');
  assert.equal(readPixelStyle(rendered.host, '--reference-left'), 1112);
});

test('applies display configuration changes without refetching loaded Open items', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    storageData: {
      [CONFIG_STORAGE_KEY]: {
        version: 1,
        user: { listFilter: 'all', touchDrag: true },
      },
    },
    fetchResults: [
      jsonResponse([{ iid: 15, title: 'Current issue' }]),
      jsonResponse([{ iid: 16, title: 'Open MR' }]),
    ],
  });
  let rendered = await openAndLoad(harness);
  assert.equal(harness.fetchCalls.length, 2);
  assert.equal(rendered.panel.querySelectorAll('[data-open-items-group]').length, 2);

  const nextConfig = {
    ...harness.storageData[CONFIG_STORAGE_KEY],
    user: { ...harness.storageData[CONFIG_STORAGE_KEY].user, listFilter: 'issue', touchDrag: false },
    userOverrides: { listFilter: true, touchDrag: true },
  };
  harness.storageData[CONFIG_STORAGE_KEY] = nextConfig;
  await harness.dispatchStorageChanged({
    [CONFIG_STORAGE_KEY]: { newValue: nextConfig },
  });
  await harness.flushMicrotasks();
  rendered = getBadge(harness.document);

  assert.equal(rendered.host.getAttribute('data-touch-drag'), 'false');
  assert.equal(rendered.panel.querySelectorAll('[data-open-items-group]').length, 1);
  assert.equal(rendered.panel.querySelector('[data-open-items-group]').getAttribute('data-open-items-group'), 'issues');
  assert.equal(harness.fetchCalls.length, 2);
});

test('preserves an active IME search input while applying display configuration changes', async () => {
  const initialConfig = {
    version: 1,
    user: { listFilter: 'all', touchDrag: true },
  };
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    storageData: { [CONFIG_STORAGE_KEY]: initialConfig },
    fetchResults: [
      jsonResponse([{ iid: 15, title: 'Current issue' }]),
      jsonResponse([{ iid: 16, title: 'Open MR' }]),
    ],
  });
  let rendered = await openAndLoad(harness);
  const search = rendered.search;
  search.focus();
  search.dispatchEvent({ type: 'compositionstart' });
  search.value = 'current';
  search.setSelectionRange(7, 7);
  search.dispatchEvent({ type: 'input', isComposing: true });

  const nextConfig = {
    ...initialConfig,
    user: { ...initialConfig.user, listFilter: 'issue', touchDrag: false },
    userOverrides: { listFilter: true, touchDrag: true },
  };
  harness.storageData[CONFIG_STORAGE_KEY] = nextConfig;
  await harness.dispatchStorageChanged({
    [CONFIG_STORAGE_KEY]: { oldValue: initialConfig, newValue: nextConfig },
  });
  await harness.flushMicrotasks();
  rendered = getBadge(harness.document);

  assert.equal(rendered.search, search);
  assert.equal(rendered.host.shadowRoot.activeElement, search);
  assert.equal(rendered.search.value, 'current');
  assert.equal(rendered.host.getAttribute('data-touch-drag'), 'false');
  assert.equal(rendered.filterAll.getAttribute('aria-pressed'), 'true');
  assert.equal(rendered.panel.querySelectorAll('[data-open-items-group]').length, 2);
  assert.equal(harness.fetchCalls.length, 2);
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
  assert.match(renderedText(groups[0]), /Failed to load/);
  assert.equal(groups[1].getAttribute('data-open-items-state'), 'ready');
  assert.match(renderedText(groups[1]), /Available MR/);

  rendered.refresh.dispatchEvent({ type: 'click' });
  assert.equal(rendered.panel.hidden, false);
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

  assert.match(renderedText(rendered.panel), /Refresh failed, showing last results/);
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

test('keeps the panel open after mouseleave while search focus remains inside', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });
  const rendered = await openAndLoad(harness);
  rendered.search.focus();

  rendered.panel.dispatchEvent({ type: 'mouseleave' });
  harness.advanceTimersBy(250);

  assert.equal(rendered.panel.hidden, false);
  assert.equal(rendered.host.shadowRoot.activeElement, rendered.search);
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

// #11 P0-b focus loop — 初始焦点入面板: opening the panel via the keyboard
// must move focus into the search box, so the next Tab cycles inside the
// panel (focus trap) instead of escaping into the page.
test('moves focus into the search box when opened with the Enter key', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });
  const rendered = getBadge(harness.document);

  rendered.trigger.dispatchEvent({ type: 'keydown', key: 'Enter' });
  await harness.flushMicrotasks();

  assert.equal(rendered.panel.hidden, false);
  assert.equal(rendered.trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(rendered.host.shadowRoot.activeElement, rendered.search);
});

test('moves focus into the search box when the trigger is focused with Tab', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });
  const rendered = getBadge(harness.document);

  rendered.trigger.dispatchEvent({ type: 'focus' });
  await harness.flushMicrotasks();

  assert.equal(rendered.panel.hidden, false);
  assert.equal(rendered.host.shadowRoot.activeElement, rendered.search);
});

// Hover-to-open must NOT steal focus into the panel, otherwise the panel can
// never close on mouseleave (scheduleNavigationClose bails when focus is
// inside the shadow root) and the mouse user loses their page context.
test('does not steal focus into the panel when opened by hover', () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1');
  const rendered = getBadge(harness.document);

  rendered.trigger.dispatchEvent({ type: 'mouseenter' });
  harness.advanceTimersBy(150);

  assert.equal(rendered.panel.hidden, false);
  assert.equal(rendered.host.shadowRoot.activeElement, null);
});

// #11 P0-b aria sync — the trigger exposes which region the panel controls
// and reflects the open state the whole time the panel is visible.
test('keeps aria-expanded and aria-controls in sync with the panel state', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });
  const rendered = getBadge(harness.document);

  assert.equal(rendered.panel.id, 'gitlab-open-items-panel');
  assert.equal(rendered.trigger.getAttribute('aria-controls'), rendered.panel.id);
  assert.equal(rendered.trigger.getAttribute('aria-expanded'), 'false');

  rendered.trigger.dispatchEvent({ type: 'keydown', key: 'Enter' });
  await harness.flushMicrotasks();
  assert.equal(rendered.trigger.getAttribute('aria-expanded'), 'true');

  rendered.panel.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(rendered.panel.hidden, true);
  assert.equal(rendered.trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(harness.document.activeElement, rendered.trigger);
});

test('does not close the navigation panel for Escape during IME composition', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });
  let rendered = await openAndLoad(harness);
  rendered.search.focus();
  rendered.search.dispatchEvent({ type: 'compositionstart' });
  const event = {
    type: 'keydown',
    key: 'Escape',
    isComposing: true,
    target: rendered.search,
  };

  rendered.panel.dispatchEvent(event);
  rendered = getBadge(harness.document);

  assert.equal(event.defaultPrevented, false);
  assert.equal(rendered.panel.hidden, false);
  assert.equal(rendered.trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(rendered.host.shadowRoot.activeElement, rendered.search);
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
  await harness.flushMicrotasks();
  assert.equal(harness.fetchCalls.length, 2);
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
    storageData: {
      gitlabReferenceConfig: {
        version: 6,
        user: { showOnAllRepoPages: false },
        userOverrides: { showOnAllRepoPages: true },
      },
    },
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

test('aborts a request that exceeds the configured timeout', async () => {
  const issues = deferred();
  const mergeRequests = jsonResponse([]);
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [issues, mergeRequests],
    storageData: {
      gitlabReferenceConfig: {
        version: 2,
        user: { requestTimeoutMs: 5000 },
      },
    },
  });

  getBadge(harness.document).trigger.dispatchEvent({ type: 'focus' });
  await harness.flushMicrotasks();
  harness.advanceTimersBy(4999);
  await harness.flushMicrotasks();
  assert.match(renderedText(getBadge(harness.document).panel), /Loading/);

  harness.advanceTimersBy(1);
  await harness.flushMicrotasks();
  const rendered = getBadge(harness.document);
  assert.doesNotMatch(renderedText(rendered.panel), /Loading/);
});

test('paginated mode loads the first batch and appends more on demand', async () => {
  const issuePage1 = Array.from({ length: 50 }, (_, index) => ({
    iid: index + 1,
    title: `Issue ${index + 1}`,
  }));
  const issuePage2 = [{ iid: 51, title: 'Issue 51' }];
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [
      jsonResponse(issuePage1, { nextPage: '2' }),
      jsonResponse([]),
      jsonResponse(issuePage2),
    ],
    storageData: {
      gitlabReferenceConfig: {
        version: 2,
        user: { loadingMode: 'paginated', maxItemsPerBatch: 50 },
      },
    },
  });

  const rendered = await openAndLoad(harness);
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]').length, 50);
  const loadMore = rendered.panel.querySelector('[data-open-items-load-more="issue"]');
  assert.notEqual(loadMore.disabled, true);
  assert.match(loadMore.textContent, /Load more/);

  loadMore.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();
  await harness.flushMicrotasks();

  const updated = getBadge(harness.document);
  assert.equal(updated.panel.querySelectorAll('[data-open-item]').length, 51);
  const updatedLoadMore = updated.panel.querySelector('[data-open-items-load-more="issue"]');
  assert.match(updatedLoadMore.textContent, /All 51 loaded/);
  assert.equal(updatedLoadMore.disabled, true);
});

test('paginated mode load-more continues from the stored next page until done', async () => {
  const issuePage1 = Array.from({ length: 40 }, (_, index) => ({
    iid: index + 1,
    title: `Issue ${index + 1}`,
  }));
  const issuePage2 = Array.from({ length: 40 }, (_, index) => ({
    iid: index + 41,
    title: `Issue ${index + 41}`,
  }));
  const issuePage3 = [{ iid: 81, title: 'Issue 81' }];
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [
      jsonResponse(issuePage1, { nextPage: '2' }),
      jsonResponse([]),
      jsonResponse(issuePage2, { nextPage: '3' }),
      jsonResponse(issuePage3),
    ],
    storageData: {
      gitlabReferenceConfig: {
        version: 2,
        user: { loadingMode: 'paginated', maxItemsPerBatch: 40, maxItemsPerType: 200 },
      },
    },
  });

  const rendered = await openAndLoad(harness);
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]').length, 40);
  // One load-more click continues from the stored next page (page 2) and keeps
  // fetching until no next page remains.
  rendered.panel.querySelector('[data-open-items-load-more="issue"]').dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();
  await harness.flushMicrotasks();
  const updated = getBadge(harness.document);
  assert.equal(updated.panel.querySelectorAll('[data-open-item]').length, 81);
  const updatedLoadMore = updated.panel.querySelector('[data-open-items-load-more="issue"]');
  assert.equal(updatedLoadMore.disabled, true);
  assert.match(updatedLoadMore.textContent, /All 81 loaded/);
});

test('paginated mode with exact batch size and no next page shows all-loaded', async () => {
  const issuePage1 = Array.from({ length: 50 }, (_, index) => ({
    iid: index + 1,
    title: `Issue ${index + 1}`,
  }));
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [
      jsonResponse(issuePage1, { nextPage: '' }),
      jsonResponse([]),
    ],
    storageData: {
      gitlabReferenceConfig: {
        version: 2,
        user: { loadingMode: 'paginated', maxItemsPerBatch: 50 },
      },
    },
  });

  const rendered = await openAndLoad(harness);
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]').length, 50);
  const loadMore = rendered.panel.querySelector('[data-open-items-load-more="issue"]');
  assert.equal(loadMore.disabled, true);
  assert.match(loadMore.textContent, /All 50 loaded/);
});

test('shows relative last-refresh times', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [jsonResponse([{ iid: 1, title: 'One' }]), jsonResponse([])],
  });

  const rendered = await openAndLoad(harness);
  assert.match(rendered.panel.querySelector('[data-last-refresh]').textContent, /Just now/);

  harness.advanceTimersBy(5 * 60 * 1000);
  getBadge(harness.document).panel.querySelector('[data-refresh-open-items]')
    .dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();
  assert.match(
    getBadge(harness.document).panel.querySelector('[data-last-refresh]').textContent,
    /5 min ago/,
  );
});

test('reports a partial failure message when only one kind fails', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [
      jsonResponse([{ iid: 1, title: 'Ok issue' }]),
      new Error('MR API failed'),
    ],
  });

  const rendered = await openAndLoad(harness);
  assert.match(renderedText(rendered.panel), /MR update failed, Issue updated/);
  assert.match(renderedText(rendered.panel), /Ok issue/);
});

test('discards a late load-more response after a refresh supersedes it', async () => {
  const issuePage1 = Array.from({ length: 50 }, (_, index) => ({
    iid: index + 1,
    title: `Issue ${index + 1}`,
  }));
  const loadMoreResponse = deferred();
  const refreshIssues = deferred();
  const refreshMergeRequests = jsonResponse([]);
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [
      jsonResponse(issuePage1, { nextPage: '2' }),
      jsonResponse([]),
      loadMoreResponse,
      refreshIssues,
      refreshMergeRequests,
    ],
    storageData: {
      gitlabReferenceConfig: {
        version: 2,
        user: { loadingMode: 'paginated', maxItemsPerBatch: 50 },
      },
    },
  });

  const rendered = await openAndLoad(harness);
  const loadMore = rendered.panel.querySelector('[data-open-items-load-more="issue"]');
  loadMore.dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();

  // While the load-more request is in flight, the user refreshes the list.
  getBadge(harness.document).panel.querySelector('[data-refresh-open-items]')
    .dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();

  // The refresh completes first with fresh data.
  refreshIssues.resolve(jsonResponse([{ iid: 900, title: 'Fresh issue' }]));
  await harness.flushMicrotasks();
  assert.match(renderedText(getBadge(harness.document).panel), /Fresh issue/);

  // The stale load-more response arrives late and must be discarded.
  loadMoreResponse.resolve(jsonResponse([{ iid: 51, title: 'Stale issue 51' }]));
  await harness.flushMicrotasks();
  await harness.flushMicrotasks();
  assert.doesNotMatch(renderedText(getBadge(harness.document).panel), /Stale issue 51/);
  assert.match(renderedText(getBadge(harness.document).panel), /Fresh issue/);
});

// ---------------------------------------------------------------------------
// #6 step 1: render-safety regression coverage
// ---------------------------------------------------------------------------

// 1) resetNavigation aborts in-flight stale requests instead of letting slow
//    responses race a newer navigation.
test('aborts stale in-flight requests when navigating to another project', async () => {
  const oldIssues = deferred();
  const oldMergeRequests = deferred();
  const harness = createHarness('https://gitlab.com/acme/old-app/-/issues/1', {
    fetchResults: [oldIssues, oldMergeRequests],
  });

  const rendered = getBadge(harness.document);
  rendered.trigger.dispatchEvent({ type: 'focus' });
  await harness.flushMicrotasks();
  assert.equal(harness.fetchCalls.length, 2);

  harness.location.href = 'https://gitlab.com/acme/new-app/-/issues/7';
  harness.dispatchWindow('popstate');
  harness.flushAnimationFrames();
  await harness.flushMicrotasks();

  // Navigating away aborts the stale request controllers; the fetch wrapper
  // rejects aborted calls, so the stale responses never land.
  assert.equal(
    harness.fetchCalls[0].init?.signal?.aborted,
    true,
    'stale issue request should be aborted after project navigation',
  );
  assert.equal(
    harness.fetchCalls[1].init?.signal?.aborted,
    true,
    'stale merge request should be aborted after project navigation',
  );
});

// 5) #6 step 2: an in-flight load-more request must be aborted (not merely
//    ignored afterwards) when the route changes to another project.
test('aborts an in-flight load-more request when navigating to another project', async () => {
  const issuePage1 = Array.from({ length: 40 }, (_, index) => ({
    iid: index + 1,
    title: `Issue ${index + 1}`,
  }));
  const loadMorePage = deferred();
  const harness = createHarness('https://gitlab.com/acme/old-app/-/issues/1', {
    fetchResults: [
      jsonResponse(issuePage1, { nextPage: '2' }),
      jsonResponse([]),
      loadMorePage,
    ],
    storageData: {
      gitlabReferenceConfig: {
        version: 2,
        user: { loadingMode: 'paginated', maxItemsPerBatch: 40, maxItemsPerType: 200 },
      },
    },
  });

  const rendered = await openAndLoad(harness);
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]').length, 40);
  rendered.panel.querySelector('[data-open-items-load-more="issue"]').dispatchEvent({ type: 'click' });
  await harness.flushMicrotasks();
  assert.equal(harness.fetchCalls.length, 3);

  // Navigating away must actively abort the pending load-more fetch.
  harness.location.href = 'https://gitlab.com/acme/new-app/-/issues/7';
  harness.dispatchWindow('popstate');
  harness.flushAnimationFrames();
  await harness.flushMicrotasks();

  assert.equal(
    harness.fetchCalls[2].init?.signal?.aborted,
    true,
    'in-flight load-more request should be aborted after project navigation',
  );
});

// 2) load-more clicks while a full (re)load is running are ignored.
test('ignores load-more clicks while a full reload is in flight', async () => {
  const issues = deferred();
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [issues, jsonResponse([])],
    storageData: {
      gitlabReferenceConfig: {
        version: 2,
        user: { loadingMode: 'paginated', maxItemsPerBatch: 50 },
      },
    },
  });

  const rendered = getBadge(harness.document);
  rendered.trigger.dispatchEvent({ type: 'focus' });
  await harness.flushMicrotasks();
  assert.equal(harness.fetchCalls.length, 2);

  // While the initial load is still pending, fire refresh (full reload, but
  // deduped) and a load-more click captured from the loading-state panel.
  rendered.refresh.dispatchEvent({ type: 'click' });
  harness.context.GitLabOpenItems?.loadMore?.('issue');

  issues.resolve(jsonResponse([
    { iid: 1, title: 'Issue 1' },
    { iid: 2, title: 'Issue 2' },
  ]));
  await harness.flushMicrotasks();
  await harness.flushMicrotasks();

  // Only the initial issue + MR fetches happened: no extra load-more fetch.
  assert.equal(harness.fetchCalls.length, 2);
  const updated = getBadge(harness.document);
  assert.match(updated.refresh.getAttribute('aria-busy') || 'false', /false/);
});

// 3) repeated sync() with the same reference must not re-render the panel.
test('second sync on the same reference does not re-render the panel', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1', {
    fetchResults: [
      jsonResponse([{ iid: 1, title: 'Issue 1' }]),
      jsonResponse([]),
    ],
  });

  const rendered = await openAndLoad(harness);
  const results = rendered.panel.querySelector('[data-open-items-results]');
  const firstGroup = results.querySelector('[data-open-items-group]');
  assert.ok(firstGroup, 'initial render should produce a results group');

  // A resize event triggers scheduleSync -> sync() with an unchanged URL.
  harness.dispatchWindow('resize');
  harness.flushAnimationFrames();
  await harness.flushMicrotasks();

  const afterResize = getBadge(harness.document);
  const resultsAfter = afterResize.panel.querySelector('[data-open-items-results]');
  assert.equal(
    resultsAfter.querySelector('[data-open-items-group]'),
    firstGroup,
    'unchanged reference must keep the existing DOM nodes instead of re-rendering',
  );
});

// 4) a slow response landing after a newer request must not clobber the fresh
//    list even when it was not aborted (generation guard).
test('slow out-of-order response does not overwrite the newer list', async () => {
  const oldIssues = deferred();
  const oldMergeRequests = deferred();
  const harness = createHarness('https://gitlab.com/acme/old-app/-/issues/1', {
    fetchResults: [
      oldIssues,
      oldMergeRequests,
      jsonResponse([{ iid: 7, title: 'Fresh issue' }]),
      jsonResponse([{ iid: 8, title: 'Fresh MR' }]),
    ],
  });

  getBadge(harness.document).trigger.dispatchEvent({ type: 'focus' });
  await harness.flushMicrotasks();
  assert.equal(harness.fetchCalls.length, 2);

  // Navigate to another project: stale controllers are aborted, but resolve
  // the old promises anyway to prove the generation guard also holds.
  harness.location.href = 'https://gitlab.com/acme/new-app/-/issues/7';
  harness.dispatchWindow('popstate');
  harness.flushAnimationFrames();
  getBadge(harness.document).trigger.dispatchEvent({ type: 'focus' });
  await harness.flushMicrotasks();
  assert.equal(harness.fetchCalls.length, 4);

  oldIssues.resolve(jsonResponse([{ iid: 1, title: 'Stale issue' }]));
  oldMergeRequests.resolve(jsonResponse([{ iid: 2, title: 'Stale MR' }]));
  await harness.flushMicrotasks();
  await harness.flushMicrotasks();

  const text = renderedText(getBadge(harness.document).panel);
  assert.match(text, /Fresh issue/);
  assert.match(text, /Fresh MR/);
  assert.doesNotMatch(text, /Stale issue|Stale MR/);
});

test('full-repo mode shows a project badge on non-detail pages with open item counts', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/tree/main/src', {
    storageData: {
      gitlabReferenceConfig: {
        version: 3,
        user: { showOnAllRepoPages: true },
      },
    },
    fetchResults: [
      jsonResponse([{ iid: 11, title: 'Open issue A' }]),
      jsonResponse([{ iid: 22, title: 'Open MR B' }]),
    ],
  });
  await harness.flushMicrotasks();

  const rendered = getBadge(harness.document);
  assert.notEqual(rendered.host, null);
  assert.equal(renderedText(rendered.label), 'acme/platform');
  assert.ok(!rendered.button.getAttribute('data-copy-text'));

  const panel = await openAndLoad(harness);
  assert.match(renderedText(panel.panel), /Open issue A/);
  assert.match(renderedText(panel.panel), /Open MR B/);
  const urls = harness.fetchCalls.map((call) => call.url);
  assert.ok(urls.some((url) => url.startsWith('https://gitlab.com/api/v4/projects/acme%2Fplatform/issues')));
  assert.ok(urls.some((url) => url.includes('/merge_requests')));
});

test('full-repo mode keeps the badge hidden by default on non-detail pages', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/tree/main/src', {
    storageData: {
      gitlabReferenceConfig: {
        version: 6,
        user: { showOnAllRepoPages: false },
        userOverrides: { showOnAllRepoPages: true },
      },
    },
  });
  await harness.flushMicrotasks();

  assert.equal(getBadge(harness.document).host, null);
});

test('full-repo mode stays off for migrated version 2 configs', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/pipelines', {
    storageData: {
      gitlabReferenceConfig: {
        version: 2,
        user: { requestTimeoutMs: 8000 },
      },
    },
  });
  await harness.flushMicrotasks();

  assert.equal(getBadge(harness.document).host, null);
});

test('full-repo mode does not show the badge on non-project GitLab routes', async () => {
  const harness = createHarness('https://gitlab.com/dashboard/projects', {
    storageData: {
      gitlabReferenceConfig: {
        version: 3,
        user: { showOnAllRepoPages: true },
      },
    },
  });
  await harness.flushMicrotasks();

  assert.equal(getBadge(harness.document).host, null);
});

test('toggling full-repo mode via storage changes updates the badge', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/blob/main/README.md', {
    storageData: {
      gitlabReferenceConfig: {
        version: 6,
        user: { showOnAllRepoPages: false },
        userOverrides: { showOnAllRepoPages: true },
      },
    },
  });
  await harness.flushMicrotasks();
  assert.equal(getBadge(harness.document).host, null);

  const baseConfig = {
    version: 3,
    user: { showOnAllRepoPages: false },
  };
  await harness.dispatchStorageChanged({
    [CONFIG_STORAGE_KEY]: {
      oldValue: baseConfig,
      newValue: { ...baseConfig, user: { ...baseConfig.user, showOnAllRepoPages: true } },
    },
  });
  await harness.flushMicrotasks();
  await harness.flushMicrotasks();

  const rendered = getBadge(harness.document);
  assert.notEqual(rendered.host, null);
  assert.equal(renderedText(rendered.label), 'acme/platform');
});

test('full-repo mode transitions between project and detail pages within one project', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/tree/main', {
    storageData: {
      gitlabReferenceConfig: {
        version: 3,
        user: { showOnAllRepoPages: true },
      },
    },
    fetchResults: [
      jsonResponse([]),
      jsonResponse([]),
    ],
  });
  await harness.flushMicrotasks();
  assert.equal(renderedText(getBadge(harness.document).label), 'acme/platform');

  harness.location.href = 'https://gitlab.com/acme/platform/-/issues/7';
  harness.dispatchWindow('popstate');
  harness.flushAnimationFrames();
  await harness.flushMicrotasks();

  const detail = getBadge(harness.document);
  assert.equal(renderedText(detail.label), 'Issue #7');
  assert.equal(detail.button.getAttribute('data-copy-text'), '#7');

  harness.location.href = 'https://gitlab.com/acme/platform/-/pipelines';
  harness.dispatchWindow('popstate');
  harness.flushAnimationFrames();
  await harness.flushMicrotasks();

  assert.equal(renderedText(getBadge(harness.document).label), 'acme/platform');
  assert.ok(!getBadge(harness.document).button.getAttribute('data-copy-text'));
});

test('initializes in the stored language from storage.sync.language', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/123', {
    storageData: { language: 'zh_CN' },
  });
  await harness.flushMicrotasks();
  const rendered = getBadge(harness.document);
  assert.equal(rendered.button.getAttribute('aria-label'), '复制 #123');
  assert.equal(rendered.trigger.getAttribute('aria-label'), '打开 acme/platform 项目的 Open Issue 和 MR 列表');
  assert.equal(rendered.tooltip.textContent, '复制 #123');
});

test('re-renders badge and panel strings when storage.sync.language changes', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/123');
  await harness.flushMicrotasks();
  assert.equal(getBadge(harness.document).button.getAttribute('aria-label'), 'Copy #123');

  await harness.dispatchStorageChanged({
    language: { oldValue: undefined, newValue: 'zh_CN' },
  });
  const zh = getBadge(harness.document);
  assert.equal(zh.button.getAttribute('aria-label'), '复制 #123');
  assert.equal(zh.trigger.getAttribute('aria-label'), '打开 acme/platform 项目的 Open Issue 和 MR 列表');

  // Opening the panel builds static controls in the active language.
  zh.trigger.dispatchEvent({ type: 'focus' });
  await harness.flushMicrotasks();
  const zhPanel = getBadge(harness.document);
  assert.equal(zhPanel.search.getAttribute('placeholder'), '搜索编号或标题');
  assert.equal(zhPanel.filterAll.textContent, '全部');

  await harness.dispatchStorageChanged({
    language: { oldValue: 'zh_CN', newValue: 'en' },
  });
  const en = getBadge(harness.document);
  assert.equal(en.button.getAttribute('aria-label'), 'Copy #123');
  assert.equal(en.trigger.getAttribute('aria-label'), 'Open the open issues and MRs list for the acme/platform project');
  assert.equal(en.search.getAttribute('placeholder'), 'Search number or title');
  assert.equal(en.filterAll.textContent, 'All');
});

test('language override is reset when storage.sync.language is removed', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/123', {
    storageData: { language: 'zh_CN' },
  });
  await harness.flushMicrotasks();
  assert.equal(getBadge(harness.document).button.getAttribute('aria-label'), '复制 #123');

  await harness.dispatchStorageChanged({
    language: { oldValue: 'zh_CN', newValue: undefined },
  });
  // With no chrome.i18n in the sandbox, getUILanguage() falls back to 'en'.
  assert.equal(getBadge(harness.document).button.getAttribute('aria-label'), 'Copy #123');
});

test('ignores storage changes for unrelated keys', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/123');
  await harness.flushMicrotasks();
  assert.equal(getBadge(harness.document).button.getAttribute('aria-label'), 'Copy #123');

  await harness.dispatchStorageChanged({
    unrelatedKey: { oldValue: undefined, newValue: 'x' },
  });
  const rendered = getBadge(harness.document);
  assert.equal(rendered.button.getAttribute('aria-label'), 'Copy #123');
  assert.equal(rendered.search.getAttribute('placeholder'), 'Search number or title');
});

// ---- #11 C-line (dev): GitLab theme detection, roving tabindex, focus trap,
// panel dialog semantics ----

test('badges resolve a deterministic light theme when GitLab exposes no theme signal', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1');
  await harness.flushMicrotasks();
  const rendered = getBadge(harness.document);

  assert.equal(rendered.host.getAttribute('data-theme'), 'light');
});

test('badges follow GitLab data-theme and gl-dark theme signals', async () => {
  // The content script resolves the theme when it builds the host, so the
  // <html> attribute/class must be in place before the first sync.
  const darkAttribute = createHarness('https://gitlab.com/acme/platform/-/issues/1');
  darkAttribute.document.documentElement.setAttribute('data-theme', 'dark');
  darkAttribute.context.GitLabReferenceBadge.sync();
  await darkAttribute.flushMicrotasks();
  assert.equal(getBadge(darkAttribute.document).host.getAttribute('data-theme'), 'dark');

  const darkClass = createHarness('https://gitlab.com/acme/platform/-/issues/2');
  darkClass.document.documentElement.className = 'gl-dark';
  darkClass.context.GitLabReferenceBadge.sync();
  await darkClass.flushMicrotasks();
  assert.equal(getBadge(darkClass.document).host.getAttribute('data-theme'), 'dark');

  const lightDeclared = createHarness('https://gitlab.com/acme/platform/-/issues/3');
  lightDeclared.document.documentElement.setAttribute('data-theme', 'light');
  lightDeclared.context.GitLabReferenceBadge.sync();
  await lightDeclared.flushMicrotasks();
  assert.equal(getBadge(lightDeclared.document).host.getAttribute('data-theme'), 'light');

  const unknownValue = createHarness('https://gitlab.com/acme/platform/-/issues/4');
  unknownValue.document.documentElement.setAttribute('data-theme', 'system');
  unknownValue.context.GitLabReferenceBadge.sync();
  await unknownValue.flushMicrotasks();
  assert.equal(getBadge(unknownValue.document).host.getAttribute('data-theme'), 'light');
});

test('badge theme re-applies deterministically on every re-sync after a runtime switch', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/5');
  await harness.flushMicrotasks();
  let rendered = getBadge(harness.document);
  assert.equal(rendered.host.getAttribute('data-theme'), 'light');

  // GitLab flips to dark: the html data-theme attribute changes and the next
  // sync (driven by the theme observer in the browser, by sync() here in the
  // harness) re-applies it.
  harness.document.documentElement.setAttribute('data-theme', 'dark');
  harness.context.GitLabReferenceBadge.sync();
  await harness.flushMicrotasks();
  rendered = getBadge(harness.document);
  assert.equal(rendered.host.getAttribute('data-theme'), 'dark');

  // Runtime switch back to light via the gl-dark class signal.
  harness.document.documentElement.removeAttribute('data-theme');
  harness.document.documentElement.className = 'gl-dark';
  harness.context.GitLabReferenceBadge.sync();
  await harness.flushMicrotasks();
  rendered = getBadge(harness.document);
  assert.equal(rendered.host.getAttribute('data-theme'), 'dark');

  harness.document.documentElement.className = '';
  harness.context.GitLabReferenceBadge.sync();
  await harness.flushMicrotasks();
  rendered = getBadge(harness.document);
  assert.equal(rendered.host.getAttribute('data-theme'), 'light');
});

// ---- #24 B2: the shadow host consumes data-theme so the badge follows the
// GitLab theme, not the OS preference. The content script guarantees the host
// attribute is always 'dark' | 'light', and the injected shadow-root stylesheet
// carries a :host([data-theme="dark"]) rule whose dark values mirror the
// @media (prefers-color-scheme: dark) block. The bare :host default keeps the
// light theme as the fallback when the attribute is 'light'.

test('BADGE_CSS carries the data-theme consumer selectors (dark, light, no-theme fallback)', () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1');
  return harness.flushMicrotasks().then(() => {
    const rendered = getBadge(harness.document);
    const css = rendered.style.textContent;

    // The dark theme is driven by the host's data-theme attribute, not by the
    // OS media query. The consumer rule must exist on the injected stylesheet.
    assert.match(css, /:host\(\[data-theme="dark"\]\)/);

    // The merged light base at the top explicitly matches the light theme and
    // the no-attribute fallback, so the layout shell applies when the host is
    // 'light' or has no attribute — no dark flash / no broken layout.
    assert.match(css, /:host,\s*\n\s*:host\(\[data-theme="light"\]\),\s*\n\s*:host\(:not\(\[data-theme\]\)\)\s*\{/);
    assert.match(css, /:host\(\[data-theme="light"\]\)/);
    assert.match(css, /:host\(:not\(\[data-theme\]\)\)/);

    // P0-a: the dark palette is tokenized. Each selector that renders a
    // protected color references a --pin-* token, and that token's dark value
    // in the :host([data-theme="dark"]) scope equals the original hex
    // byte-for-byte. These two-part checks are equivalent-or-stronger than the
    // old hex-bound assertions: they pin both the var() wiring and the resolved
    // value (spec §2.4 / manager ruling, dark focus #58a6ff aside).
    // [data-reference-badge] background: #ffffff → var(--pin-bg-surface) → #24272d (dark)
    assert.match(css, /\[data-reference-badge\][\s\S]*?background:\s*var\(--pin-bg-surface\)/);
    assert.match(css, /:host\(\[data-theme="dark"\]\)\s*\{[\s\S]*?--pin-bg-surface:\s*#24272d/);
    // [data-reference-badge] color: #1f2937 → var(--pin-text-primary) → #f0f2f5 (dark)
    assert.match(css, /\[data-reference-badge\][\s\S]*?color:\s*var\(--pin-text-primary\)/);
    assert.match(css, /:host\(\[data-theme="dark"\]\)\s*\{[\s\S]*?--pin-text-primary:\s*#f0f2f5/);
    // [data-open-items-panel] background: #ffffff → var(--pin-bg-surface) → #24272d (dark, shared token)
    assert.match(css, /\[data-open-items-panel\][\s\S]*?background:\s*var\(--pin-bg-surface\)/);
    // [data-open-items-search] background: #ffffff → var(--pin-bg-field) → #1f2227 (dark)
    assert.match(css, /\[data-open-items-search\][\s\S]*?background:\s*var\(--pin-bg-field\)/);
    assert.match(css, /:host\(\[data-theme="dark"\]\)\s*\{[\s\S]*?--pin-bg-field:\s*#1f2227/);

    // The OS-preference media query remains as a degradation fallback.
    assert.match(css, /@media\s*\(prefers-color-scheme:\s*dark\)/);
  });
});

test('badge host is marked dark when GitLab is dark so the CSS consumer applies', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/2');
  harness.document.documentElement.setAttribute('data-theme', 'dark');
  harness.context.GitLabReferenceBadge.sync();
  await harness.flushMicrotasks();

  const rendered = getBadge(harness.document);
  // The host attribute is the attribute the :host([data-theme="dark"]) selector
  // matches — it must carry 'dark' when GitLab is dark.
  assert.equal(rendered.host.getAttribute('data-theme'), 'dark');
});

test('light theme falls through to the bare :host default (no dark styles)', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/3');
  await harness.flushMicrotasks();

  const rendered = getBadge(harness.document);
  assert.equal(rendered.host.getAttribute('data-theme'), 'light');
  // The base light theme is the fallback: the bare :host block only sets the
  // host's layout shell (no background/color), and [data-reference-badge]
  // carries the light background. Dark values live only under the
  // :host([data-theme="dark"]) selector, never at the bare :host level.
  const css = rendered.style.textContent;
  // The merged light base (bare :host, light, and no-theme fallback) is the
  // layout shell applied by default; the first light-colored rule is
  // [data-reference-badge] right after it.
  assert.match(css, /:host,\s*\n\s*:host\(\[data-theme="light"\]\),\s*\n\s*:host\(:not\(\[data-theme\]\)\)\s*\{([\s\S]*?)\}\s*\n\s*\[data-reference-badge\]/);
  // P0-a: the light default is a token on the bare :host block. The badge
  // background resolves #ffffff → var(--pin-bg-surface), and the literal hex
  // lives only at the token definition — no literal #ffffff in the rule.
  assert.match(css, /\[data-reference-badge\][\s\S]*?background:\s*var\(--pin-bg-surface\)/);
  assert.match(css, /^\s*:host\s*\{[\s\S]*?--pin-bg-surface:\s*#ffffff/);
  assert.ok(!/\[data-reference-badge\][\s\S]*?background:\s*#ffffff/.test(css), 'badge background must come from the --pin-bg-surface token, not a literal hex');
  // The base host block (the token defaults + layout shell before any [data-*]
  // rule) must not leak any dark-only value — dark is scoped to the
  // :host([data-theme="dark"]) selector and the @media dark fallback only.
  const baseHost = css.split(/\n\s*\[data-reference-badge\]/, 1)[0];
  const darkOnly = ['#24272d', '#f0f2f5', '#1f2227', '#58a6ff', '#b7bdc8', '#8b949e', '#79c0ff', '#56d364', '#d2a8ff', '#9ac1ff', '#4d2d00', '#9e6a03', '#ffd18a', 'rgba(255,', 'rgba(117,'];
  for (const needle of darkOnly) {
    assert.ok(!baseHost.includes(needle), `bare host token block must stay light (no ${needle})`);
  }
});

test('focus rings and the search box focus resolve from the shared --pin-focus-ring token', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/16');
  await harness.flushMicrotasks();

  const css = getBadge(harness.document).style.textContent;
  // P0-a + spec §2.4: every panel :focus-visible rule switches to the token
  // (light #0969da / dark #58a6ff), width stays 2px, ring stays inset -2px.
  const tokenOutlines = css.match(/outline:\s*var\(--pin-focus-ring-width\)\s+solid\s+var\(--pin-focus-ring\)/g) || [];
  assert.ok(tokenOutlines.length >= 6, `expected all :focus-visible rules to use the token, got ${tokenOutlines.length}`);
  // The search input keeps the GitHub input convention, also via the token.
  assert.match(css, /\[data-open-items-search\]:focus\s*\{[\s\S]*?border-color:\s*var\(--pin-focus-ring\)/);
  assert.match(css, /\[data-open-items-search\]:focus\s*\{[\s\S]*?box-shadow:\s*0 0 0 1px var\(--pin-focus-ring\)/);
  // Light default lives on the bare :host block; the dark override #58a6ff is
  // scoped to :host([data-theme="dark"]) and mirrored by the @media fallback —
  // never on the bare :host (original #24272d guard, now for the focus ring).
  assert.match(css, /^\s*:host\s*\{[\s\S]*?--pin-focus-ring:\s*#0969da/);
  assert.match(css, /:host\(\[data-theme="dark"\]\)\s*\{[\s\S]*?--pin-focus-ring:\s*#58a6ff/);
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?--pin-focus-ring:\s*#58a6ff/);
  const baseHost = css.split(/\n\s*\[data-reference-badge\]/, 1)[0];
  assert.ok(!baseHost.includes('#58a6ff'), 'bare :host must keep the light #0969da focus ring');
});

// ---- #11 P1 (spec §3/§4/§5): empty-state styles, the copy-success toast
// surface, and the reduced-motion kill switch must all be present in the
// injected shadow stylesheet with the manager-ruled landing tokens.

test('#11 P1 BADGE_CSS carries the empty-state, toast, and reduced-motion rules', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/16');
  await harness.flushMicrotasks();
  const css = getBadge(harness.document).style.textContent;

  // §3 empty state: flex column layout with the 120px floor.
  assert.match(css, /\[data-open-items-empty\]\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\[data-open-items-empty\]\s*\{[^}]*min-height:\s*120px/);
  assert.match(css, /\[data-open-items-empty-action\]:focus-visible/);

  // §3 landing hook (manager ruling): the dark empty-state primary text is
  // #f0f6fc (NOT the global #f0f2f5), mirrored in both dark scopes; the light
  // default lives on the bare :host block only.
  assert.match(css, /^\s*:host\s*\{[\s\S]*?--pin-empty-title:\s*#1f2328/);
  assert.match(css, /:host\(\[data-theme="dark"\]\)\s*\{[\s\S]*?--pin-empty-title:\s*#f0f6fc/);
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?--pin-empty-title:\s*#f0f6fc/);
  const baseHost = css.split(/\n\s*\[data-reference-badge\]/, 1)[0];
  assert.ok(!/--pin-empty-title:\s*#f0f6fc/.test(baseHost),
    'bare :host must keep the light empty-title token');

  // §4 toast: shares the tooltip anchor, sits above it, and suppresses it.
  // The base styling is scoped to the direct child span so the state attribute
  // on the button ([data-copy-reference][data-copy-toast]) never matches this
  // selector (manager-ruled, #43 regression guard). Layout props live on it.
  assert.match(css, /\[data-copy-reference\]\s*>\s*\[data-copy-toast\]\s*\{[\s\S]*?top:\s*calc\(100% \+ 7px\)/);
  assert.match(css, /\[data-copy-reference\]\s*>\s*\[data-copy-toast\]\s*\{[\s\S]*?z-index:\s*3/);
  assert.match(css, /\[data-copy-reference\]\s*>\s*\[data-copy-toast\]\s*\{[\s\S]*?background:\s*var\(--pin-surface-pop\)/);
  // A bare selector at the start of a rule (the #43 collision that hid the whole
  // button subtree) must be gone — the toast span is always the direct child.
  assert.ok(!/\n\s*\[data-copy-toast\]\s*\{/.test(css),
    'no bare [data-copy-toast] base selector — must be scoped under the copy button');
  assert.match(css, /\[data-copy-toast-icon\]\s*\{[\s\S]*?color:\s*var\(--pin-success-on-pop\)/);
  assert.match(css, /\[data-copy-reference\]\[data-copy-toast="on"\]\s*\[data-copy-toast\]/);
  assert.match(css, /\[data-copy-reference\]\[data-copy-toast="leaving"\]\s*\[data-copy-toast\]/);
  // Mutual exclusion while both exist (spec §4 / manager ruling).
  assert.match(css, /\[data-copy-reference\]\[data-copy-toast="on"\]\s*\[data-copy-tooltip\]/);
  // Dark pop surface = #1f2227 per manager ruling; light = #24292f.
  assert.match(css, /^\s*:host\s*\{[\s\S]*?--pin-surface-pop:\s*#24292f/);
  assert.match(css, /:host\(\[data-theme="dark"\]\)\s*\{[\s\S]*?--pin-surface-pop:\s*#1f2227/);
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?--pin-surface-pop:\s*#1f2227/);

  // §5 reduced motion: transforms/transitions killed for the animated pops.
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\[data-copy-tooltip\][\s\S]*?\[data-copy-toast\][\s\S]*?transition:\s*none[\s\S]*?transform:\s*none/);
});

test('#43 follow-up: toast z-index strictly beats the panel header z-index (#44 guard)', async () => {
  // Root cause of the panel-open invisibility: the toast and the sticky panel
  // header both lived at z-index 2 inside the same shadow root, and the header
  // (appended later in content.js) won the paint order. Static guard: parse the
  // two rules and compare their z-index values numerically so any future
  // regression back to `>= header` fails here rather than on a browser.
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/16');
  await harness.flushMicrotasks();
  const css = getBadge(harness.document).style.textContent;

  const toastMatch = css.match(
    /\[data-copy-reference\]\s*>\s*\[data-copy-toast\]\s*\{[^}]*?z-index:\s*(\d+)/);
  const headerMatch = css.match(
    /\[data-open-items-header\]\s*\{[^}]*?z-index:\s*(\d+)/);
  assert.ok(toastMatch, 'toast base rule must carry a numeric z-index');
  assert.ok(headerMatch, 'panel header rule must carry a numeric z-index');

  const toastZ = Number(toastMatch[1]);
  const headerZ = Number(headerMatch[1]);
  assert.ok(toastZ > headerZ,
    `toast z-index (${toastZ}) must be strictly greater than the panel header z-index (${headerZ})`);
});

test('panel is announced as a labelled dialog and result rows use a roving tabindex', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [
      jsonResponse([
        { iid: 15, title: 'Current issue' },
        { iid: 16, title: 'Second issue' },
        { iid: 17, title: 'Third issue' },
      ]),
      jsonResponse([]),
    ],
  });

  const rendered = await openAndLoad(harness);

  assert.equal(rendered.panel.getAttribute('role'), 'dialog');
  assert.equal(rendered.panel.getAttribute('aria-label'), 'Open items');
  const rows = rendered.panel.querySelectorAll('[data-open-item]');
  assert.deepEqual(rows.map((row) => row.getAttribute('tabindex')), ['0', '-1', '-1']);
  assert.equal(rows[0].getAttribute('data-open-item-focus'), 'true');
});

test('arrow keys move the roving focus across result rows without leaving the panel', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [
      jsonResponse([
        { iid: 15, title: 'Current issue' },
        { iid: 16, title: 'Second issue' },
        { iid: 17, title: 'Third issue' },
      ]),
      jsonResponse([]),
    ],
  });
  let rendered = await openAndLoad(harness);
  const rows = rendered.panel.querySelectorAll('[data-open-item]');

  rendered.panel.dispatchEvent({ type: 'keydown', key: 'ArrowDown' });
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]')[1]
    .getAttribute('data-open-item-focus'), 'true');
  assert.deepEqual(
    rendered.panel.querySelectorAll('[data-open-item]').map((row) => row.getAttribute('tabindex')),
    ['-1', '0', '-1'],
  );

  // First row keeps arrow-focus on itself when already at the top.
  rendered.panel.dispatchEvent({ type: 'keydown', key: 'ArrowUp' });
  rendered.panel.dispatchEvent({ type: 'keydown', key: 'ArrowUp' });
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]')[0]
    .getAttribute('data-open-item-focus'), 'true');

  rendered.panel.dispatchEvent({ type: 'keydown', key: 'End' });
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]')[2]
    .getAttribute('data-open-item-focus'), 'true');

  rendered.panel.dispatchEvent({ type: 'keydown', key: 'Home' });
  assert.equal(rendered.panel.querySelectorAll('[data-open-item]')[0]
    .getAttribute('data-open-item-focus'), 'true');

  // The current page's row is the default roving target when present.
  const currentHarness = createHarness('https://gitlab.com/acme/platform/-/issues/16', {
    fetchResults: [
      jsonResponse([
        { iid: 15, title: 'Other issue' },
        { iid: 16, title: 'Current issue' },
      ]),
      jsonResponse([]),
    ],
  });
  const currentRendered = await openAndLoad(currentHarness);
  const currentRows = currentRendered.panel.querySelectorAll('[data-open-item]');
  assert.equal(currentRows[1].getAttribute('data-current-open-item'), '');
  assert.equal(currentRows[1].getAttribute('data-open-item-focus'), 'true');
  assert.deepEqual(
    currentRows.map((row) => row.getAttribute('tabindex')),
    ['-1', '0'],
  );
});

test('open panel keeps Tab cycling within its controls (focus trap)', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [
      jsonResponse([{ iid: 15, title: 'Current issue' }]),
      jsonResponse([]),
    ],
  });
  let rendered = await openAndLoad(harness);

  // Mirror the focus trap's own focusable set exactly: same selector group,
  // same filtering (skip hidden/disabled/tabindex="-1"), so first/last match
  // what handlePanelTabCycle computes at runtime.
  const focusable = rendered.panel
    .querySelectorAll('button, input, [href], [tabindex]')
    .filter((node) => !node.hidden
      && node.disabled !== true
      && node.getAttribute('disabled') === null
      && node.getAttribute('tabindex') !== '-1');
  assert.ok(focusable.length >= 3);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  // Tab on the last control wraps to the first.
  last.focus();
  const tabForward = { type: 'keydown', key: 'Tab', preventDefault() {} };
  rendered.panel.dispatchEvent(tabForward);
  assert.equal(first.getAttribute('data-drag-tooltip'), null);
  assert.equal(harness.document.activeElement, first);

  // Shift+Tab on the first control wraps to the last.
  const shiftBack = { type: 'keydown', key: 'Tab', shiftKey: true, preventDefault() {} };
  first.focus();
  rendered.panel.dispatchEvent(shiftBack);
  assert.equal(harness.document.activeElement, last);

  // Tab is untouched while the panel is closed.
  rendered = getBadge(harness.document);
  rendered.trigger.focus();
  rendered.panel.dispatchEvent({ type: 'keydown', key: 'Escape' });
  const closedTab = { type: 'keydown', key: 'Tab', preventDefault() {} };
  rendered.panel.dispatchEvent(closedTab);
  assert.equal(closedTab.defaultPrevented !== true || closedTab.defaultPrevented === false, true);
});

// #41 regression: the former !host.contains(active) fallback on BOTH branches
// was a false trigger — Node.contains() never crosses the shadow boundary, so
// host.contains(active) is always false for focus inside the panel. Every Tab
// from a middle control was hijacked (forward -> first, Shift+Tab -> last).
// The trap is now pure boundary wrapping: middle-control Tab / Shift+Tab must
// be left untouched (no preventDefault, focus unchanged). This test FAILS on
// baseline 2374326 (shift branch) and on 5c6bc0e (both branches).
test('#41 regression: middle panel control keeps focus on Tab and Shift+Tab (no boundary hijack)', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [
      jsonResponse([{ iid: 15, title: 'Current issue' }]),
      jsonResponse([]),
    ],
  });
  const rendered = getBadge(harness.document);

  rendered.trigger.dispatchEvent({ type: 'mouseenter' });
  harness.advanceTimersBy(150);
  assert.equal(rendered.panel.hidden, false);

  const focusable = rendered.panel
    .querySelectorAll('button, input, [href], [tabindex]')
    .filter((node) => !node.hidden
      && node.disabled !== true
      && node.getAttribute('disabled') === null
      && node.getAttribute('tabindex') !== '-1');
  assert.ok(focusable.length >= 3);
  const middle = focusable[1];
  middle.focus();
  assert.equal(harness.document.activeElement, middle);

  let preventedForward = false;
  rendered.panel.dispatchEvent({
    type: 'keydown', key: 'Tab',
    preventDefault() { preventedForward = true; },
  });
  assert.equal(preventedForward, false);
  assert.equal(harness.document.activeElement, middle);

  let preventedBack = false;
  rendered.panel.dispatchEvent({
    type: 'keydown', key: 'Tab', shiftKey: true,
    preventDefault() { preventedBack = true; },
  });
  assert.equal(preventedBack, false);
  assert.equal(harness.document.activeElement, middle);
});

// #41 (reachable): the panel-scoped trap cannot see a Tab whose focus origin is
// outside the panel (NULL shadowRoot.activeElement), so the NULL -> drag-handle
// escape is only stoppable at the document level. These dispatch on
// harness.document because the harness's dispatchEvent only triggers listeners
// on the target itself (no ancestor bubbling) — document dispatch is the exact
// real-world reachable route (focus on <body>, Tab caught in document capture).
// The middle-control regression test above (panel dispatch) keeps the pure
// boundary-wrap contract on the record: mid-list Tab/Shift+Tab must NOT be
// intercepted (no preventDefault, focus unchanged).
test('document-level Tab intercepts a NULL focus back into the panel (#41, forward and back)', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [
      jsonResponse([]),
      jsonResponse([]),
    ],
  });
  const rendered = getBadge(harness.document);

  // Hover opens the panel without moving focus into it (shadow activeElement NULL).
  rendered.trigger.dispatchEvent({ type: 'mouseenter' });
  harness.advanceTimersBy(150);
  assert.equal(rendered.panel.hidden, false);
  assert.equal(rendered.host.shadowRoot.activeElement, null);

  const focusable = rendered.panel
    .querySelectorAll('button, input, [href], [tabindex]')
    .filter((node) => !node.hidden
      && node.disabled !== true
      && node.getAttribute('disabled') === null
      && node.getAttribute('tabindex') !== '-1');
  assert.ok(focusable.length >= 3);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  let prevented = false;
  harness.document.dispatchEvent({
    type: 'keydown', key: 'Tab',
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(harness.document.activeElement, first);

  // The forward rescue moved focus into the panel, which would make the next
  // Tab early-return; reset the NULL-focus precondition to model a fresh
  // drop-to-body before exercising the Shift+Tab rescue direction.
  rendered.host.shadowRoot.activeElement = null;
  harness.document.activeElement = null;

  let preventedBack = false;
  harness.document.dispatchEvent({
    type: 'keydown', key: 'Tab', shiftKey: true,
    preventDefault() { preventedBack = true; },
  });
  assert.equal(preventedBack, true);
  assert.equal(harness.document.activeElement, last);
});

// #41 compat: when focus is still inside the widget (badge or panel), the
// document listener must early-return and leave Tab to the badge/panel native
// ordering — proving hover-open (non-modal) semantics survive the new layer.
test('document-level Tab leaves panel focus untouched when focus is inside the widget (#41 compat)', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [
      jsonResponse([]),
      jsonResponse([]),
    ],
  });
  const rendered = getBadge(harness.document);
  rendered.trigger.dispatchEvent({ type: 'mouseenter' });
  harness.advanceTimersBy(150);
  assert.equal(rendered.panel.hidden, false);

  const focusable = rendered.panel
    .querySelectorAll('button, input, [href], [tabindex]')
    .filter((node) => !node.hidden
      && node.disabled !== true
      && node.getAttribute('disabled') === null
      && node.getAttribute('tabindex') !== '-1');
  focusable[focusable.length - 1].focus();
  assert.ok(rendered.host.shadowRoot.activeElement);

  let prevented = false;
  harness.document.dispatchEvent({
    type: 'keydown', key: 'Tab',
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, false); // document listener early-returns on in-widget focus
});

test('#35 T10: ArrowDown in the search box moves focus onto a result row', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [
      jsonResponse([
        { iid: 15, title: 'Current issue' },
        { iid: 16, title: 'Second issue' },
        { iid: 17, title: 'Third issue' },
      ]),
      jsonResponse([]),
    ],
  });
  let rendered = await openAndLoad(harness);
  const rows = rendered.panel.querySelectorAll('[data-open-item]');
  assert.ok(rows.length >= 2);

  // User is typing in the search box; the first ArrowDown starts roving
  // tabindex from the search box instead of being swallowed.
  rendered.search.focus();
  const down = { type: 'keydown', key: 'ArrowDown' };
  rendered.search.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(harness.document.activeElement, rows[0]);
  assert.equal(rows[0].getAttribute('data-open-item-focus'), 'true');
  assert.equal(rows[0].getAttribute('tabindex'), '0');

  // Subsequent ArrowDown keeps roving within the list (via the panel handler).
  rendered.panel.dispatchEvent({ type: 'keydown', key: 'ArrowDown' });
  assert.equal(harness.document.activeElement, rows[1]);
  assert.equal(rows[1].getAttribute('data-open-item-focus'), 'true');
  assert.equal(rows[1].getAttribute('tabindex'), '0');
});

test('#35 T2: re-render restores roving focus when the focused result row is replaced', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [
      jsonResponse([
        { iid: 15, title: 'Current issue' },
        { iid: 16, title: 'Second issue' },
        { iid: 17, title: 'Third issue' },
      ]),
      jsonResponse([]),
    ],
  });
  let rendered = await openAndLoad(harness);
  const rows = rendered.panel.querySelectorAll('[data-open-item]');
  assert.ok(rows.length >= 2);

  // Move roving focus onto the second row (real arrow navigation).
  rendered.panel.dispatchEvent({ type: 'keydown', key: 'ArrowDown' });
  assert.equal(harness.document.activeElement, rows[1]);

  // A search re-render replaces the results container's children. In a real
  // browser the focused node is removed and focus drops to <body>; the roving
  // target must be re-focused so a Tab in the render window cannot escape.
  rendered = searchOpenItems(harness, 'issue');
  const rowsAfter = rendered.panel.querySelectorAll('[data-open-item]');
  assert.ok(rowsAfter.length >= 1);
  const active = harness.document.activeElement;
  assert.equal(active.getAttribute('data-open-item'), '');
  assert.equal(active.getAttribute('data-open-item-focus'), 'true');
  assert.equal(active.getAttribute('tabindex'), '0');
});

test('#35 T2: re-render while typing keeps focus in the search box', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [
      jsonResponse([
        { iid: 15, title: 'Current issue' },
        { iid: 16, title: 'Second issue' },
      ]),
      jsonResponse([]),
    ],
  });
  let rendered = await openAndLoad(harness);
  rendered.search.focus();
  rendered = searchOpenItems(harness, 'second');
  assert.equal(harness.document.activeElement, rendered.search);
  assert.equal(harness.document.activeElement.getAttribute('data-open-items-search'), '');
});

test('destroy disconnects the theme observer without leaking listeners', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/6');
  await harness.flushMicrotasks();
  harness.context.GitLabReferenceBadge.destroy();
  harness.document.documentElement.setAttribute('data-theme', 'dark');
  harness.triggerMutation();
  await harness.flushMicrotasks();

  const rendered = getBadge(harness.document);
  assert.equal(rendered.host, null);
});
