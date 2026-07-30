const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const parser = require('../src/parser.js');

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
    for (const listener of this.listeners.get(event.type) || []) {
      listener.call(this, event);
    }
  }
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
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
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

  attachShadow() {
    this.shadowRoot = new FakeNode('#shadow-root');
    return this.shadowRoot;
  }

  querySelector(selector) {
    if (selector === '[data-reference-badge]') {
      return this.find((node) => node.attributes.has('data-reference-badge'));
    }
    if (selector === 'style') {
      return this.find((node) => node.tagName === 'STYLE');
    }
    return null;
  }

  find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested = child.find(predicate);
      if (nested) return nested;
    }
    return null;
  }
}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.documentElement = new FakeNode('html');
  }

  createElement(tagName) {
    return new FakeNode(tagName);
  }

  getElementById(id) {
    return this.documentElement.find((node) => node.id === id);
  }
}

function createHarness(initialUrl) {
  const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
  const document = new FakeDocument();
  const windowEvents = new FakeEventTarget();
  const location = { href: initialUrl };
  const animationFrames = new Map();
  const observers = [];
  let nextFrameId = 1;

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

  const context = {
    GitLabReferenceParser: parser,
    MutationObserver: FakeMutationObserver,
    document,
    location,
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
  };

  vm.runInNewContext(source, context, { filename: 'src/content.js' });

  return {
    context,
    document,
    location,
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
  };
}

function getBadge(document) {
  const host = document.getElementById('gitlab-reference-badge-host');
  return {
    host,
    badge: host?.shadowRoot.querySelector('[data-reference-badge]') || null,
    style: host?.shadowRoot.querySelector('style') || null,
  };
}

test('renders one isolated issue badge and keeps synchronization idempotent', () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/123');

  let rendered = getBadge(harness.document);
  assert.ok(rendered.host);
  assert.ok(rendered.host.shadowRoot);
  assert.equal(rendered.badge.textContent, 'Issue #123');
  assert.equal(rendered.badge.getAttribute('role'), 'status');
  assert.equal(rendered.badge.getAttribute('aria-live'), 'polite');

  harness.context.GitLabReferenceBadge.sync();
  rendered = getBadge(harness.document);
  const hosts = harness.document.documentElement.children.filter(
    (node) => node.id === 'gitlab-reference-badge-host',
  );
  assert.equal(hosts.length, 1);
  assert.equal(rendered.badge.textContent, 'Issue #123');
});

test('declares fixed non-interactive host styling', () => {
  const harness = createHarness('http://git.tsintergy.com/acme/platform/-/issues/21');
  const { style } = getBadge(harness.document);

  assert.match(style.textContent, /position:\s*fixed\s*!important/);
  assert.match(style.textContent, /top:\s*8px\s*!important/);
  assert.match(style.textContent, /pointer-events:\s*none\s*!important/);
  assert.match(style.textContent, /z-index:\s*2147483647\s*!important/);
});

test('updates the badge after browser and GitLab navigation events', () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/1');

  harness.location.href = 'https://gitlab.com/acme/platform/-/merge_requests/456/diffs';
  harness.dispatchWindow('popstate');
  harness.flushAnimationFrames();
  assert.equal(getBadge(harness.document).badge.textContent, 'MR !456');

  harness.location.href = 'https://gitlab.com/acme/platform/-/issues/9';
  harness.dispatchDocument('turbo:load');
  harness.flushAnimationFrames();
  assert.equal(getBadge(harness.document).badge.textContent, 'Issue #9');
});

test('uses DOM mutations to detect SPA URL changes and removes stale badges', () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/2');

  harness.location.href = 'https://gitlab.com/acme/platform/-/issues';
  harness.triggerMutation();
  harness.flushAnimationFrames();

  assert.equal(getBadge(harness.document).host, null);
});

test('destroy removes the badge and stops future event-driven rendering', () => {
  const harness = createHarness('https://gitlab.com/acme/platform/-/issues/3');

  harness.context.GitLabReferenceBadge.destroy();
  assert.equal(getBadge(harness.document).host, null);

  harness.location.href = 'https://gitlab.com/acme/platform/-/merge_requests/4';
  harness.dispatchWindow('hashchange');
  harness.triggerMutation();
  harness.flushAnimationFrames();
  assert.equal(getBadge(harness.document).host, null);
});
