'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// background.js is an IIFE that wires chrome.runtime listeners and a top-level
// cold-boot self-heal against a root object. Load it in a fresh VM context with
// a chrome stub so we can assert the #15 path D wiring.

function loadBackground(chromeStub) {
  const root = { chrome: chromeStub.chrome, GitLabReferencePermissions: chromeStub.permissionsModule };
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'background.js'), 'utf8');
  vm.runInNewContext(source, root);
  return root;
}

function createChromeStub({ syncCalls = [], registeredScripts = [] } = {}) {
  const listeners = {};
  const permissionsModule = {
    syncRegisteredScripts: async () => {
      syncCalls.push('syncRegisteredScripts');
      return { patterns: [], registered: false };
    },
    handlePermissionRemoved: async () => {
      syncCalls.push('handlePermissionRemoved');
    },
    migrateLegacyOriginsOnUpdate: async () => [],
    updatePendingBadge: async () => {},
  };
  return {
    permissionsModule,
    chrome: {
      runtime: {
        onInstalled: { addListener: (fn) => { listeners.onInstalled = fn; } },
        onStartup: { addListener: (fn) => { listeners.onStartup = fn; } },
      },
      scripting: {
        getRegisteredContentScripts: async () => registeredScripts,
      },
      permissions: { onRemoved: { addListener: (fn) => { listeners.onRemoved = fn; } } },
      storage: { local: { get: async () => ({}) } },
    },
    listeners,
  };
}

test('#15 path D: cold boot with no registered scripts re-syncs', async () => {
  const syncCalls = [];
  const stub = createChromeStub({ syncCalls, registeredScripts: [] });
  loadBackground(stub);

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(syncCalls, ['syncRegisteredScripts'],
    'cold boot with empty registrations should call permissions.syncRegisteredScripts');
});

test('#15 path D: cold boot with existing registrations skips re-sync', async () => {
  const syncCalls = [];
  const stub = createChromeStub({
    syncCalls,
    registeredScripts: [{ id: 'gitlab-reference-main' }],
  });
  loadBackground(stub);

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(syncCalls, [],
    'cold boot with non-empty registrations should not re-sync (idempotent skip)');
});

test('#15 path D: no onStartup listener is registered', async () => {
  const stub = createChromeStub();
  loadBackground(stub);

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(stub.listeners.onStartup, undefined,
    'onStartup listener should be removed under path D');
});

test('background still wires onInstalled and onRemoved listeners', async () => {
  const stub = createChromeStub();
  loadBackground(stub);

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(typeof stub.listeners.onInstalled, 'function');
  assert.equal(typeof stub.listeners.onRemoved, 'function');
});
