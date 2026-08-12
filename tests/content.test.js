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
  const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
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

  const storage = options.storage === false ? undefined : {
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
        const changes = Object.fromEntries(
          Object.entries(value).map(([key, newValue]) => [
            key,
            { oldValue: storageData[key], newValue },
          ]),
        );
        Object.assign(storageData, value);
        for (const listener of storageChangeListeners) listener(changes, 'local');
        return Promise.resolve();
      },
      remove(key) {
        storageCalls.remove.push(key);
        if (options.storageRemoveError) return Promise.reject(options.storageRemoveError);
        const oldValue = storageData[key];
        delete storageData[key];
        const change = { [key]: { oldValue, newValue: undefined } };
        for (const listener of storageChangeListeners) listener(change, 'local');
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

  const context = {
    GitLabReferenceParser: parser,
    MutationObserver: FakeMutationObserver,
    document,
    fetch,
    location,
    navigator: clipboard ? { clipboard } : {},
    chrome: storage ? { storage } : {},
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
  };

  vm.runInNewContext(configSource, context, { filename: 'src/config.js' });
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
    dispatchStorageChanged(changes, areaName = 'local') {
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
    icon: shadow?.querySelector('[data-copy-icon]') || null,
    announcement: shadow?.querySelector('[data-copy-announcement]') || null,
    panel: shadow?.querySelector('[data-open-items-panel]') || null,
    refresh: shadow?.querySelector('[data-refresh-open-items]') || null,
    search: shadow?.querySelector('[data-open-items-search]') || null,
    filterAll: shadow?.querySelector('[data-open-items-filter="all"]') || null,
    filterIssue: shadow?.querySelector('[data-open-items-filter="issue"]') || null,
    filterMergeRequest: shadow?.querySelector('[data-open-items-filter="merge-request"]') || null,
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
  assert.equal(rendered.handle.getAttribute('aria-label'), '拖动调整位置，双击恢复默认位置');
  assert.equal(rendered.handleTooltip.textContent, '拖动调整位置');
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
    [[CONFIG_STORAGE_KEY, POSITION_STORAGE_KEY]],
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

test('renders an accessible local search field and type filters', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });

  const rendered = await openAndLoad(harness);

  assert.equal(rendered.search.tagName, 'INPUT');
  assert.equal(rendered.search.getAttribute('type'), 'search');
  assert.equal(rendered.search.getAttribute('aria-label'), '搜索 Open items');
  assert.equal(rendered.search.getAttribute('placeholder'), '搜索编号或标题');
  assert.equal(rendered.filterAll.tagName, 'BUTTON');
  assert.equal(rendered.filterIssue.tagName, 'BUTTON');
  assert.equal(rendered.filterMergeRequest.tagName, 'BUTTON');
  assert.equal(rendered.filterAll.textContent, '全部');
  assert.equal(rendered.filterIssue.textContent, 'Issue');
  assert.equal(rendered.filterMergeRequest.textContent, 'MR');
  assert.equal(rendered.filterAll.getAttribute('aria-pressed'), 'true');
  assert.equal(rendered.filterIssue.getAttribute('aria-pressed'), 'false');
  assert.equal(rendered.filterMergeRequest.getAttribute('aria-pressed'), 'false');
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
  assert.equal(empty.textContent, '没有匹配的 Open items');
  assert.equal(rendered.panel.querySelectorAll('[data-open-items-group]').length, 0);
  assert.equal(rendered.panel.querySelector('[data-open-items-total]').textContent, '0');
});

test('distinguishes a project with no Open items from filtered no matches', async () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/15', {
    fetchResults: [jsonResponse([]), jsonResponse([])],
  });

  const rendered = await openAndLoad(harness);
  const empty = rendered.panel.querySelector('[data-open-items-empty]');
  assert.equal(empty.getAttribute('role'), 'status');
  assert.equal(empty.textContent, '暂无 Open items');
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
  assert.equal(empty.textContent, '没有匹配的 Open items');
  assert.equal(rendered.panel.querySelector('[data-open-items-total]').textContent, '0');
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
  assert.match(renderedText(groups[0]), /无法加载/);
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
