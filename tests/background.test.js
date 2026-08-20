'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// background.js is an IIFE that wires chrome.runtime listeners against a
// root object. Load it in a fresh VM context with a chrome stub so we can
// assert the #14 onStartup re-sync wiring.

function loadBackground(chromeStub) {
  const root = { chrome: chromeStub.chrome, GitLabReferencePermissions: chromeStub.permissionsModule };
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'background.js'), 'utf8');
  vm.runInNewContext(source, root);
  return root;
}

function createChromeStub({ syncCalls = [] } = {}) {
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
      permissions: { onRemoved: { addListener: (fn) => { listeners.onRemoved = fn; } } },
      storage: { local: { get: async () => ({}) } },
    },
    listeners,
  };
}

test('#14 background registers an onStartup listener that re-syncs scripts', async () => {
  const stub = createChromeStub();
  loadBackground(stub);

  assert.equal(typeof stub.listeners.onStartup, 'function',
    'background should register chrome.runtime.onStartup listener');

  await stub.listeners.onStartup();
});

test('#14 onStartup triggers syncRegisteredScripts (#14 bootstrap fallback)', async () => {
  const syncCalls = [];
  const stub = createChromeStub({ syncCalls });
  loadBackground(stub);

  await stub.listeners.onStartup();

  assert.deepEqual(syncCalls, ['syncRegisteredScripts'],
    'onStartup should call permissions.syncRegisteredScripts to restore registrations');
});

test('background still wires onInstalled and onRemoved listeners', async () => {
  const stub = createChromeStub();
  loadBackground(stub);

  assert.equal(typeof stub.listeners.onInstalled, 'function');
  assert.equal(typeof stub.listeners.onRemoved, 'function');
});
