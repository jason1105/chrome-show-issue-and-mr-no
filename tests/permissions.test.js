const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONTENT_SCRIPT_FILES,
  NAVIGATION_HOOK_FILES,
  NAVIGATION_HOOK_SCRIPT_ID,
  PENDING_ORIGINS_STORAGE_KEY,
  REGISTERED_SCRIPT_ID,
  buildMatchPatterns,
  normalizeOriginInput,
  createPermissionController,
  migrateLegacyOriginsOnUpdate,
  updatePendingBadge,
} = require('../src/permissions.js');

function createChromeStub(overrides = {}) {
  const state = {
    grantedOrigins: new Set(overrides.grantedOrigins || []),
    stored: { ...(overrides.stored || {}) },
    requestWillGrant: overrides.requestWillGrant !== false,
    registrations: [],
  };

  const chromeStub = {
    permissions: {
      getAll: async () => ({ origins: [...state.grantedOrigins] }),
      contains: async (perm) => (perm.origins || []).every((pattern) => state.grantedOrigins.has(pattern)),
      request: async (perm) => {
        if (!state.requestWillGrant) return false;
        for (const pattern of perm.origins || []) state.grantedOrigins.add(pattern);
        return true;
      },
      remove: async (perm) => {
        if (overrides.removeWillFail) return false;
        for (const pattern of perm.origins || []) state.grantedOrigins.delete(pattern);
        return true;
      },
    },
    scripting: {
      unregisterContentScripts: async () => { state.registrations = []; },
      registerContentScripts: async (scripts) => {
        state.registrations = scripts;
      },
    },
    storage: {
      local: {
        get: async (keys) => {
          const result = {};
          for (const key of keys) result[key] = state.stored[key];
          return result;
        },
        set: async (items) => { Object.assign(state.stored, items); },
      },
    },
    action: {
      setBadgeText: async (details) => { state.badgeText = details.text; },
      setBadgeBackgroundColor: async () => {},
    },
  };
  return { chromeStub, state };
}

test('normalizes user-provided origins', () => {
  assert.equal(normalizeOriginInput('https://gitlab.example.com/group/project'), 'https://gitlab.example.com');
  assert.equal(normalizeOriginInput('http://192.168.1.10:8070/sign_in'), 'http://192.168.1.10:8070');
  assert.equal(normalizeOriginInput('  https://GitLab.com  '), 'https://gitlab.com');
  assert.equal(normalizeOriginInput('ftp://gitlab.com'), null);
  assert.equal(normalizeOriginInput('not a url'), null);
  assert.equal(normalizeOriginInput(42), null);
});

test('builds deduplicated match patterns with explicit ports', () => {
  assert.deepEqual(
    buildMatchPatterns(['https://gitlab.com', 'https://gitlab.com/', 'http://10.0.0.5:8080']),
    ['https://gitlab.com/*', 'http://10.0.0.5:8080/*'],
  );
  assert.deepEqual(buildMatchPatterns(['nope', '', null]), []);
});

test('keeps parser → config → ui → content order at document_start', () => {
  assert.deepEqual(CONTENT_SCRIPT_FILES, ['src/parser.js', 'src/config.js', 'src/ui.js', 'src/content.js']);
});

test('registers the navigation hook in the MAIN world', () => {
  assert.deepEqual(NAVIGATION_HOOK_FILES, ['src/navigation-hook.js']);
});

test('requestOrigin grants, registers scripts, and clears pending origin', async () => {
  const { chromeStub, state } = createChromeStub({
    stored: { [PENDING_ORIGINS_STORAGE_KEY]: ['https://gitlab.com'] },
  });
  const controller = createPermissionController(chromeStub);

  const result = await controller.requestOrigin('https://gitlab.com');

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'granted');
  assert.equal(state.registrations.length, 2);
  const [hookRegistration, registration] = state.registrations;
  assert.equal(hookRegistration.id, NAVIGATION_HOOK_SCRIPT_ID);
  assert.deepEqual(hookRegistration.js, NAVIGATION_HOOK_FILES);
  assert.equal(hookRegistration.world, 'MAIN');
  assert.equal(hookRegistration.runAt, 'document_start');
  assert.equal(registration.id, REGISTERED_SCRIPT_ID);
  assert.deepEqual(registration.js, CONTENT_SCRIPT_FILES);
  assert.deepEqual(registration.matches, ['https://gitlab.com/*']);
  assert.equal(registration.runAt, 'document_start');
  assert.equal(registration.persistAcrossSessions, false);
  assert.deepEqual(state.stored[PENDING_ORIGINS_STORAGE_KEY], []);
});

test('requestOrigin reports denial without registering', async () => {
  const { chromeStub, state } = createChromeStub({ requestWillGrant: false });
  const controller = createPermissionController(chromeStub);

  const result = await controller.requestOrigin('https://gitlab.com');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'denied');
  assert.equal(state.registrations.length, 0);
});

test('requestOrigin rejects invalid input without touching permissions', async () => {
  const { chromeStub } = createChromeStub();
  const controller = createPermissionController(chromeStub);

  const result = await controller.requestOrigin('javascript:alert(1)');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-origin');
  assert.equal(result.origin, null);
});

test('already granted origin refreshes registration without re-prompting', async () => {
  const { chromeStub, state } = createChromeStub({ grantedOrigins: ['https://gitlab.com/*'] });
  const controller = createPermissionController(chromeStub);

  const result = await controller.requestOrigin('https://gitlab.com');

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'already-granted');
  assert.deepEqual(state.registrations[0].matches, ['https://gitlab.com/*']);
});

test('removeOrigin drops permission and unregisters matching host', async () => {
  const { chromeStub, state } = createChromeStub({
    grantedOrigins: ['https://gitlab.com/*', 'https://other.example/*'],
  });
  const controller = createPermissionController(chromeStub);

  const result = await controller.removeOrigin('https://gitlab.com');

  assert.equal(result.ok, true);
  assert.deepEqual(state.registrations[0].matches, ['https://other.example/*']);
});

test('removeOrigin reports failure instead of claiming success', async () => {
  const { chromeStub, state } = createChromeStub({
    grantedOrigins: ['https://gitlab.com/*'],
    removeWillFail: true,
  });
  const controller = createPermissionController(chromeStub);

  const result = await controller.removeOrigin('https://gitlab.com');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'remove-failed');
  assert.equal(result.origin, 'https://gitlab.com');
  // The failed revocation must not alter granted permissions.
  assert.ok(state.grantedOrigins.has('https://gitlab.com/*'));
});

test('updatePendingBadge shows badge while pending origins exist and clears it after grant', async () => {
  const { chromeStub, state } = createChromeStub({
    stored: { [PENDING_ORIGINS_STORAGE_KEY]: ['https://gitlab.com'] },
  });

  await updatePendingBadge(chromeStub);
  assert.equal(state.badgeText, '!');

  const controller = createPermissionController(chromeStub);
  await controller.requestOrigin('https://gitlab.com');
  await updatePendingBadge(chromeStub);
  assert.equal(state.badgeText, '');
});

test('updatePendingBadge is a no-op without chrome.action', async () => {
  const { chromeStub } = createChromeStub();
  delete chromeStub.action;
  await updatePendingBadge(chromeStub); // must not throw
});

test('permission revocation re-syncs registrations to granted hosts', async () => {
  const { chromeStub, state } = createChromeStub({
    grantedOrigins: ['https://gitlab.com/*'],
  });
  const controller = createPermissionController(chromeStub);
  await controller.syncRegisteredScripts();
  assert.equal(state.registrations[0].matches.length, 1);

  state.grantedOrigins.delete('https://gitlab.com/*');
  await controller.handlePermissionRemoved();

  assert.equal(state.registrations.length, 0);
});

test('empty grant list produces no registration', async () => {
  const { chromeStub, state } = createChromeStub();
  const controller = createPermissionController(chromeStub);

  await controller.syncRegisteredScripts();

  assert.equal(state.registrations.length, 0);
});

test('listGrantedOrigins normalizes patterns and ignores duplicates', async () => {
  const { chromeStub } = createChromeStub({
    grantedOrigins: ['https://gitlab.com/*', 'https://gitlab.com/*', 'http://host:8080/*'],
  });
  const controller = createPermissionController(chromeStub);

  const origins = await controller.listGrantedOrigins();

  assert.deepEqual(origins, ['https://gitlab.com', 'http://host:8080']);
});

test('migrateLegacyOriginsOnUpdate merges legacy site origins into pending list', async () => {
  const { chromeStub, state } = createChromeStub({
    stored: {
      gitlabReferenceConfig: {
        sites: {
          'https://gitlab.com': {},
          'http://10.0.0.5:8080': { listFilter: 'issue' },
        },
        searchState: { query: '' },
      },
      [PENDING_ORIGINS_STORAGE_KEY]: ['https://existing.example'],
    },
  });

  const readLegacy = async () => {
    const stored = state.stored.gitlabReferenceConfig;
    return [...Object.keys(stored.sites || {}), stored.searchState?.query || ''];
  };

  const migrated = await migrateLegacyOriginsOnUpdate(chromeStub, readLegacy);

  assert.deepEqual(migrated.sort(), [
    'http://10.0.0.5:8080',
    'https://existing.example',
    'https://gitlab.com',
  ]);
  assert.deepEqual(
    state.stored[PENDING_ORIGINS_STORAGE_KEY].sort(),
    migrated.sort(),
  );
});

test('migrateLegacyOriginsOnUpdate tolerates storage failures', async () => {
  const brokenChrome = {
    storage: {
      local: {
        get: async () => { throw new Error('boom'); },
      },
    },
  };
  const migrated = await migrateLegacyOriginsOnUpdate(brokenChrome, async () => ['https://gitlab.com']);
  assert.deepEqual(migrated, []);
});
