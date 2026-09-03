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
  const openOptionsPageCalls = [];
  const badgeCalls = [];
  const permissionsModule = {
    syncRegisteredScripts: async () => {
      syncCalls.push('syncRegisteredScripts');
      return { patterns: [], registered: false };
    },
    handlePermissionRemoved: async () => {
      syncCalls.push('handlePermissionRemoved');
    },
    migrateLegacyOriginsOnUpdate: async () => [],
    updatePendingBadge: async () => { badgeCalls.push('updatePendingBadge'); },
  };
  return {
    permissionsModule,
    chrome: {
      runtime: {
        onInstalled: { addListener: (fn) => { listeners.onInstalled = fn; } },
        onStartup: { addListener: (fn) => { listeners.onStartup = fn; } },
        onMessage: { addListener: (fn) => { listeners.onMessage = fn; } },
        openOptionsPage() {
          openOptionsPageCalls.push(Date.now());
        },
      },
      scripting: {
        getRegisteredContentScripts: async () => registeredScripts,
      },
      permissions: { onRemoved: { addListener: (fn) => { listeners.onRemoved = fn; } } },
      storage: { local: { get: async () => ({}) } },
    },
    listeners,
    openOptionsPageCalls,
    badgeCalls,
  };
}

// Boot-integration harness that loads the REAL permissions module (as the SW does
// via importScripts) into the same VM root before background.js, so the actual
// updatePendingBadge → setBadgeText derivation is observable end-to-end. This
// closes the follow-up acceptance gaps that the stubbed permissionsModule above
// cannot see: the real badge text after a boot (not just that the hook ran).
function loadBackgroundWithRealPermissions({ pending = [] } = {}) {
  const root = {};
  const badgeState = { badgeText: undefined, badgeColorCalls: 0 };
  const chromeStub = {
    chrome: {
      runtime: {
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
        onMessage: { addListener: () => {} },
        openOptionsPage() {},
      },
      scripting: {
        getRegisteredContentScripts: async () => [],
      },
      permissions: { onRemoved: { addListener: () => {} } },
      storage: {
        local: {
          get: async (keys) => {
            const result = {};
            for (const key of keys) result[key] = key === 'gitlabReferencePendingOrigins' ? pending : undefined;
            return result;
          },
          set: async () => {},
        },
      },
      action: {
        setBadgeText: async (details) => { badgeState.badgeText = details.text; },
        setBadgeBackgroundColor: async () => { badgeState.badgeColorCalls += 1; },
      },
    },
    permissions: { getAll: async () => ({ origins: [] }) },
  };
  root.chrome = chromeStub.chrome;
  root.GitLabReferencePermissions = undefined;
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  // Load permissions.js first so the real API lands on root.GitLabReferencePermissions,
  // mirroring the SW importScripts order (permissions.js guards module.exports in Node).
  const permSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'permissions.js'), 'utf8');
  vm.runInNewContext(permSource, root, { filename: 'src/permissions.js' });
  const bgSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'background.js'), 'utf8');
  vm.runInNewContext(bgSource, root, { filename: 'src/background.js' });
  return { badgeState, chromeStub };
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

test('follow-up badge: boot re-derives badge when no registrations exist (re-sync path)', async () => {
  const stub = createChromeStub({
    syncCalls: [],
    registeredScripts: [],
  });
  loadBackground(stub);

  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(stub.badgeCalls.includes('updatePendingBadge'),
    'cold boot should re-derive the pending badge after clearing a restart');
});

test('follow-up badge: boot re-derives badge even when content scripts are already registered', async () => {
  // The badge reflects storage.local.pending (durable source of truth), which is
  // independent of dynamic content-script registration state. A full browser
  // restart may clear the provisional badge while registrations persist, so the
  // badge must be re-derived regardless of the re-sync skip.
  const syncCalls = [];
  const stub = createChromeStub({
    syncCalls,
    registeredScripts: [{ id: 'gitlab-reference-main' }],
  });
  loadBackground(stub);

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(syncCalls, [],
    'registrations present means the content-script re-sync path is skipped');
  assert.ok(stub.badgeCalls.includes('updatePendingBadge'),
    'badge re-derivation must still run even when registration re-sync is skipped');
});

test('follow-up badge: boot with real pending set lights the badge to "!" (no user action)', async () => {
  // Acceptance 1 end-to-end: with non-empty storage.local.pending and a fully fresh
  // SW boot (no user action), the boot path must re-derive the badge to "!". This
  // loads the REAL permissions module so the actual setBadgeText text is observed,
  // not just the hook being called.
  const { badgeState } = loadBackgroundWithRealPermissions({
    pending: ['https://gitlab.com'],
  });

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(badgeState.badgeText, '!',
    'real pending origins after a cold boot should re-light the badge to "!"');
});

test('follow-up badge: boot with empty pending leaves no stale "!" (converges to clean state)', async () => {
  // Acceptance 2: the badge is a pure derived view of storage.local.pending. When a
  // full restart cleared both the badge and (correctly) pending is empty, boot must
  // not resurrect a phantom "!". updatePendingBadge converges setBadgeText to '' —
  // writing the empty value is the correct state, not a spurious disturbance.
  const { badgeState } = loadBackgroundWithRealPermissions({ pending: [] });

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(badgeState.badgeText, '',
    'empty pending on cold boot should leave the badge cleared (text "")');
});

test('follow-up badge: repeated SW boots are idempotent (badge stays correct, no runaway)', async () => {
  // Acceptance 3: updatePendingBadge is idempotent and re-derivation runs once per
  // SW boot. Simulate several consecutive boot/restart shapes on a fresh module each
  // time with a real pending set — the badge must land at "!" every time with no
  // drift or error across repeated boots.
  const texts = [];
  for (let i = 0; i < 4; i++) {
    const { badgeState } = loadBackgroundWithRealPermissions({
      pending: ['https://gitlab.com', 'http://10.0.0.5:8080'],
    });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    texts.push(badgeState.badgeText);
  }
  assert.ok(texts.every((t) => t === '!'),
    'repeated cold boots with real pending should keep the badge at "!" every time (got ' + JSON.stringify(texts) + ')');
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

test('#20 final: open-options message routes to openOptionsPage on the service worker', async () => {
  const stub = createChromeStub();
  loadBackground(stub);

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(typeof stub.listeners.onMessage, 'function');

  let response = null;
  stub.listeners.onMessage({ type: 'gitlab-reference-open-options' }, {}, (r) => { response = r; });
  assert.equal(stub.openOptionsPageCalls.length, 1,
    'open-options message should call chrome.runtime.openOptionsPage');
  assert.equal(response?.opened, true);
});

test('#20 final: unrelated message types do not open options', async () => {
  const stub = createChromeStub();
  loadBackground(stub);

  await new Promise((resolve) => setImmediate(resolve));

  // The pre-existing permissions ping must not trigger openOptionsPage.
  stub.listeners.onMessage({ type: 'gitlab-reference-permissions-ping' }, {}, () => {});
  assert.equal(stub.openOptionsPageCalls.length, 0);
});
