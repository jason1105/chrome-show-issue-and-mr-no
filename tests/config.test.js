const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONFIG_STORAGE_KEY,
  CONFIG_VERSION,
  LEGACY_POSITION_STORAGE_KEY,
  DEFAULT_POSITION,
  createConfigStore,
  getDefaultConfig,
  migrateConfig,
  normalizeConfig,
} = require('../src/config.js');

function createMemoryStorage(initial = {}) {
  const data = { ...initial };
  const calls = { get: [], set: [], remove: [] };
  return {
    data,
    calls,
    get(keys) {
      calls.get.push(keys);
      const names = Array.isArray(keys)
        ? keys
        : typeof keys === 'object' && keys !== null
          ? Object.keys(keys)
          : [keys];
      return Promise.resolve(Object.fromEntries(names.map((key) => [key, data[key]])));
    },
    set(value) {
      calls.set.push(value);
      Object.assign(data, value);
      return Promise.resolve();
    },
    remove(key) {
      calls.remove.push(key);
      delete data[key];
      return Promise.resolve();
    },
  };
}

test('defaults full-repo mode on for new installs while migrations keep legacy configs off (#21)', () => {
  const fresh = getDefaultConfig();
  assert.equal(fresh.user.showOnAllRepoPages, true);
  assert.deepEqual(fresh.userOverrides, {});

  const normalizedEmpty = normalizeConfig(undefined);
  assert.equal(normalizedEmpty.user.showOnAllRepoPages, true);
  assert.deepEqual(normalizedEmpty.userOverrides, {});

  // Legacy configs must not inherit the new default: migration v3 writes an
  // explicit false which counts as a user override in normalizeConfig.
  const legacy = migrateConfig({ user: { listFilter: 'issue' } });
  assert.equal(legacy.user.showOnAllRepoPages, false);
  assert.equal(normalizeConfig(legacy).user.showOnAllRepoPages, false);
});

test('normalizes defaults, bounds, enum values, and ignores protected overrides', () => {
  const defaults = getDefaultConfig();
  const normalized = normalizeConfig({
    version: 99,
    user: {
      listFilter: 'invalid',
      cacheTtlSeconds: 99999,
      maxItemsPerType: -5,
      loadingMode: 'invalid',
      showLastRefresh: false,
      touchDrag: false,
      keyboardStep: 999,
    },
    protected: { storeSensitiveData: true },
  });

  assert.equal(normalized.version, defaults.version);
  assert.equal(normalized.user.listFilter, defaults.user.listFilter);
  assert.equal(normalized.user.cacheTtlSeconds, 300);
  assert.equal(normalized.user.maxItemsPerType, 1);
  assert.equal(normalized.user.loadingMode, defaults.user.loadingMode);
  assert.equal(normalized.user.showLastRefresh, false);
  assert.equal(normalized.user.touchDrag, false);
  assert.equal(normalized.user.keyboardStep, 50);
  assert.equal(normalized.protected, undefined);
  assert.deepEqual(normalized.searchState, { query: '', listFilter: null });
});

test('migrates version 1 search preferences without changing an explicit opt-out', () => {
  const explicitOptOut = migrateConfig({
    version: 1,
    user: { rememberSearch: false },
    userOverrides: { rememberSearch: true },
  });
  const defaultDerivedOptOut = migrateConfig({
    version: 1,
    user: { rememberSearch: false },
    userOverrides: {},
  });

  assert.equal(explicitOptOut.version, CONFIG_VERSION);
  assert.equal(explicitOptOut.user.rememberSearch, false);
  assert.equal(defaultDerivedOptOut.version, CONFIG_VERSION);
  assert.equal(defaultDerivedOptOut.user.rememberSearch, true);
  assert.deepEqual(defaultDerivedOptOut.searchState, { query: '', listFilter: null });
});

test('normalizes persisted search query and type filter', () => {
  assert.deepEqual(normalizeConfig({
    version: 2,
    searchState: { query: '  release blocker  ', listFilter: 'merge-request' },
  }).searchState, {
    query: '  release blocker  ',
    listFilter: 'merge-request',
  });
  assert.deepEqual(normalizeConfig({
    version: 2,
    searchState: { query: 42, listFilter: 'invalid' },
  }).searchState, { query: '', listFilter: null });
});

test('migrates a legacy local configuration into sync on first load (#17)', async () => {
  const syncStorage = createMemoryStorage();
  const legacyLocalStorage = createMemoryStorage({
    [CONFIG_STORAGE_KEY]: {
      version: 1,
      user: { listFilter: 'issue', cacheTtlSeconds: 120 },
      sites: {
        'https://git.example.test': { maxItemsPerType: 20 },
      },
      position: { edge: 'left', ratio: 0.75 },
    },
  });
  const store = createConfigStore(syncStorage, { legacyStorage: legacyLocalStorage });

  const effective = await store.load('https://git.example.test');

  assert.equal(effective.listFilter, 'issue');
  assert.equal(effective.cacheTtlSeconds, 120);
  assert.equal(effective.maxItemsPerType, 20);
  assert.deepEqual(effective.position, { edge: 'left', ratio: 0.75 });
  // The migrated record is persisted (and re-migrated to the current schema)
  // into the sync area, while the legacy local copy is left untouched.
  assert.equal(syncStorage.data[CONFIG_STORAGE_KEY].version, CONFIG_VERSION);
  assert.deepEqual(syncStorage.data[CONFIG_STORAGE_KEY].userOverrides, {
    listFilter: true,
    cacheTtlSeconds: true,
    showOnAllRepoPages: true, // pinned by v6 (#21)
  });
  assert.equal(legacyLocalStorage.data[CONFIG_STORAGE_KEY].version, 1);
});

test('does not overwrite an existing sync configuration from legacy local (#17)', async () => {
  const syncConfig = {
    version: CONFIG_VERSION,
    user: { listFilter: 'merge-request', cacheTtlSeconds: 240 },
    userOverrides: { listFilter: true, cacheTtlSeconds: true },
    sites: {},
    position: { edge: 'right', ratio: 0.25 },
    searchState: { query: '', listFilter: null },
  };
  const syncStorage = createMemoryStorage({ [CONFIG_STORAGE_KEY]: syncConfig });
  const legacyLocalStorage = createMemoryStorage({
    [CONFIG_STORAGE_KEY]: {
      version: 1,
      user: { listFilter: 'issue' },
    },
  });
  const store = createConfigStore(syncStorage, { legacyStorage: legacyLocalStorage });

  const effective = await store.load('https://git.example.test');

  assert.equal(effective.listFilter, 'merge-request');
  assert.equal(effective.cacheTtlSeconds, 240);
  // Sync data wins; the legacy copy is not promoted over it.
  assert.deepEqual(syncStorage.data[CONFIG_STORAGE_KEY], syncConfig);
});

test('migration is skipped when neither area holds a configuration (#17)', async () => {
  const syncStorage = createMemoryStorage();
  const legacyLocalStorage = createMemoryStorage();
  const store = createConfigStore(syncStorage, { legacyStorage: legacyLocalStorage });

  await store.load('https://git.example.test');

  assert.equal(syncStorage.data[CONFIG_STORAGE_KEY], undefined);
  assert.deepEqual(legacyLocalStorage.calls.get, [[CONFIG_STORAGE_KEY]]);
});

test('ignores storage-change events from the legacy local area (#17)', async () => {
  const storage = createMemoryStorage();
  const changes = new Set();
  const onChanged = {
    addListener(listener) {
      changes.add(listener);
    },
    removeListener(listener) {
      changes.delete(listener);
    },
  };
  const store = createConfigStore(storage, { storageChangeEvents: onChanged });
  await store.load('https://git.example.test');

  await Promise.all([...changes].map((listener) => listener({
    [CONFIG_STORAGE_KEY]: { newValue: { version: 1, user: { listFilter: 'issue' } } },
  }, 'local')));
  await Promise.all([...changes].map((listener) => listener({
    [CONFIG_STORAGE_KEY]: { newValue: { version: 1, user: { listFilter: 'merge-request' } } },
  }, 'sync')));

  assert.equal(store.getEffective('https://git.example.test').listFilter, 'merge-request');
});

test('migrates the legacy position key into the versioned configuration', async () => {
  const storage = createMemoryStorage({
    [LEGACY_POSITION_STORAGE_KEY]: { edge: 'right', ratio: 0.25 },
  });
  const store = createConfigStore(storage);

  const effective = await store.load('https://git.example.test');

  assert.deepEqual(effective.position, { edge: 'right', ratio: 0.25 });
  assert.deepEqual(storage.calls.get, [[CONFIG_STORAGE_KEY, LEGACY_POSITION_STORAGE_KEY]]);
  assert.deepEqual(storage.data[CONFIG_STORAGE_KEY].position, { edge: 'right', ratio: 0.25 });
  assert.deepEqual(storage.calls.set, [{
    [CONFIG_STORAGE_KEY]: storage.data[CONFIG_STORAGE_KEY],
  }]);
  assert.deepEqual(storage.calls.remove, [LEGACY_POSITION_STORAGE_KEY]);
});

test('migrates an unversioned configuration and persists the current schema', async () => {
  const unversioned = {
    user: { listFilter: 'issue', cacheTtlSeconds: 120 },
    sites: {
      'https://git.example.test': { maxItemsPerType: 20 },
    },
    position: { edge: 'left', ratio: 0.75 },
  };
  const migrated = migrateConfig(unversioned);
  assert.equal(migrated.version, CONFIG_VERSION);
  assert.deepEqual(migrated.userOverrides, {
    listFilter: true,
    cacheTtlSeconds: true,
    showOnAllRepoPages: true, // pinned by v6 (#21)
  });
  assert.equal(migrated.user.rememberSearch, true);
  assert.equal(migrated.user.showOnAllRepoPages, false);
  assert.equal(migrated.user.itemStateFilter, 'open');
  assert.deepEqual(migrated.searchState, { query: '', listFilter: null });
  // v6 (#21): the migration-written false is pinned as an override so the
  // new on-by-default cannot silently enable full-repo mode for legacy data.
  assert.equal(migrated.userOverrides.showOnAllRepoPages, true);

  const storage = createMemoryStorage({ [CONFIG_STORAGE_KEY]: unversioned });
  const store = createConfigStore(storage);
  const effective = await store.load('https://git.example.test');

  assert.equal(effective.listFilter, 'issue');
  assert.equal(effective.cacheTtlSeconds, 120);
  assert.equal(effective.maxItemsPerType, 20);
  assert.deepEqual(effective.position, { edge: 'left', ratio: 0.75 });
  assert.equal(storage.data[CONFIG_STORAGE_KEY].version, CONFIG_VERSION);
  assert.deepEqual(storage.data[CONFIG_STORAGE_KEY].userOverrides, {
    listFilter: true,
    cacheTtlSeconds: true,
    showOnAllRepoPages: true, // pinned by v6 (#21)
  });
  assert.equal(storage.calls.set.length, 1);
});

test('migrates a v3 configuration to v4 with itemStateFilter normalized', () => {
  const v3Config = {
    version: 3,
    user: { showOnAllRepoPages: true, itemStateFilter: 'all' },
    userOverrides: { showOnAllRepoPages: true },
    sites: {},
    position: { edge: 'top', ratio: 0.5 },
    searchState: { query: '', listFilter: null },
  };
  const migrated = migrateConfig(v3Config);
  assert.equal(migrated.version, CONFIG_VERSION);
  assert.equal(migrated.user.itemStateFilter, 'all');
  assert.equal(migrated.user.showOnAllRepoPages, true);
  assert.equal(migrated.userOverrides.itemStateFilter, true);

  const invalidState = migrateConfig({
    ...v3Config,
    user: { itemStateFilter: 'garbage' },
    userOverrides: {},
  });
  assert.equal(invalidState.user.itemStateFilter, 'open');
});

test('migrates a v4 configuration to v5 with searchScope normalized', () => {
  const v4Config = {
    version: 4,
    user: { searchScope: 'number', itemStateFilter: 'all' },
    userOverrides: { itemStateFilter: true },
    sites: {},
    position: { edge: 'top', ratio: 0.5 },
    searchState: { query: '', listFilter: null },
  };
  const migrated = migrateConfig(v4Config);
  assert.equal(migrated.version, CONFIG_VERSION);
  assert.equal(migrated.user.searchScope, 'number');
  assert.equal(migrated.userOverrides.searchScope, true);

  const invalidState = migrateConfig({
    ...v4Config,
    user: { searchScope: 'garbage' },
    userOverrides: {},
  });
  assert.equal(invalidState.user.searchScope, 'title');
});

test('merges a site profile with user preferences while preserving protected limits', () => {
  const config = normalizeConfig({
    user: { listFilter: 'merge-request', cacheTtlSeconds: 120 },
    sites: {
      'https://git.example.test': {
        listFilter: 'issue',
        cacheTtlSeconds: 5,
        maxItemsPerType: 12,
      },
    },
  });
  const store = createConfigStore(null, { initialConfig: config });

  const effective = store.getEffective('https://git.example.test');

  assert.equal(effective.listFilter, 'merge-request');
  assert.equal(effective.cacheTtlSeconds, 120);
  assert.equal(effective.maxItemsPerType, 12);
  assert.equal(effective.protected.storeSensitiveData, false);
  assert.equal(effective.protected.maxItemsPerType, 100);
});

test('keeps an initial configuration when storage is unavailable', async () => {
  const store = createConfigStore(null, {
    initialConfig: {
      user: { listFilter: 'issue' },
      position: { edge: 'left', ratio: 0.25 },
    },
  });

  await store.save({ cacheTtlSeconds: 120 }, 'https://git.example.test');
  assert.equal(store.getEffective('https://git.example.test').listFilter, 'issue');
  assert.equal(store.getEffective('https://git.example.test').cacheTtlSeconds, 120);
  assert.deepEqual(store.getEffective('https://git.example.test').position, {
    edge: 'left',
    ratio: 0.25,
  });
});

test('keeps in-memory preferences when saving fails and reports the storage error', async () => {
  const storage = createMemoryStorage();
  storage.set = () => Promise.reject(new Error('quota exceeded'));
  const store = createConfigStore(storage);
  await store.load('https://git.example.test');

  await assert.rejects(
    store.save({ listFilter: 'issue' }, 'https://git.example.test'),
    /quota exceeded/,
  );
  assert.equal(store.getEffective('https://git.example.test').listFilter, 'issue');
});

test('merges a fresh stored snapshot before writing a position from another context', async () => {
  const storage = createMemoryStorage();
  const optionsStore = createConfigStore(storage);
  const contentStore = createConfigStore(storage);
  await optionsStore.load('https://git.example.test');
  await contentStore.load('https://git.example.test');

  await optionsStore.save({ listFilter: 'issue', cacheTtlSeconds: 240 }, 'https://git.example.test');
  await contentStore.setPosition({ edge: 'right', ratio: 0.9 }, 'https://git.example.test');

  const stored = storage.data[CONFIG_STORAGE_KEY];
  assert.equal(stored.user.listFilter, 'issue');
  assert.equal(stored.user.cacheTtlSeconds, 240);
  assert.deepEqual(stored.userOverrides, { listFilter: true, cacheTtlSeconds: true });
  assert.deepEqual(stored.position, { edge: 'right', ratio: 0.9 });
});

test('persists and clears search state through the shared configuration record', async () => {
  const storage = createMemoryStorage();
  const store = createConfigStore(storage);
  await store.load('https://git.example.test');

  let effective = await store.setSearchState({
    query: '#123',
    listFilter: 'issue',
  }, 'https://git.example.test');
  assert.deepEqual(effective.searchState, { query: '#123', listFilter: 'issue' });
  assert.deepEqual(storage.data[CONFIG_STORAGE_KEY].searchState, {
    query: '#123',
    listFilter: 'issue',
  });

  effective = await store.setSearchState(null, 'https://git.example.test');
  assert.deepEqual(effective.searchState, { query: '', listFilter: null });
  assert.deepEqual(storage.data[CONFIG_STORAGE_KEY].searchState, {
    query: '',
    listFilter: null,
  });
});

test('clears persisted search state when search memory is disabled', async () => {
  const storage = createMemoryStorage({
    [CONFIG_STORAGE_KEY]: {
      version: 2,
      searchState: { query: 'release', listFilter: 'merge-request' },
    },
  });
  const store = createConfigStore(storage);
  await store.load('https://git.example.test');

  const effective = await store.save({ rememberSearch: false }, 'https://git.example.test');

  assert.equal(effective.rememberSearch, false);
  assert.deepEqual(effective.searchState, { query: '', listFilter: null });
  assert.deepEqual(storage.data[CONFIG_STORAGE_KEY].searchState, {
    query: '',
    listFilter: null,
  });
});

test('ignores a stale search-state write after another context disables search memory', async () => {
  const storage = createMemoryStorage();
  const optionsStore = createConfigStore(storage);
  const contentStore = createConfigStore(storage);
  await optionsStore.load('https://git.example.test');
  await contentStore.load('https://git.example.test');

  await optionsStore.save({ rememberSearch: false }, 'https://git.example.test');
  const effective = await contentStore.setSearchState({
    query: 'release',
    listFilter: 'merge-request',
  }, 'https://git.example.test');

  assert.equal(effective.rememberSearch, false);
  assert.deepEqual(effective.searchState, { query: '', listFilter: null });
  assert.deepEqual(storage.data[CONFIG_STORAGE_KEY].searchState, {
    query: '',
    listFilter: null,
  });
});

test('updates an existing store when another context changes configuration', async () => {
  const storage = createMemoryStorage();
  const changes = new Set();
  const onChanged = {
    addListener(listener) {
      changes.add(listener);
    },
    removeListener(listener) {
      changes.delete(listener);
    },
  };
  const firstStore = createConfigStore(storage, { storageChangeEvents: onChanged });
  const secondStore = createConfigStore(storage, { storageChangeEvents: onChanged });
  await firstStore.load('https://git.example.test');
  await secondStore.load('https://git.example.test');

  await firstStore.save({ listFilter: 'merge-request' }, 'https://git.example.test');
  await Promise.all([...changes].map((listener) => listener({
      [CONFIG_STORAGE_KEY]: { newValue: storage.data[CONFIG_STORAGE_KEY] },
    }, 'sync')));

  assert.equal(secondStore.getEffective('https://git.example.test').listFilter, 'merge-request');
});

test('keeps the previous in-memory configuration when reset persistence fails', async () => {
  const storage = createMemoryStorage({
    [CONFIG_STORAGE_KEY]: {
      version: 1,
      user: { listFilter: 'issue' },
      position: { edge: 'right', ratio: 0.8 },
      sites: { 'https://git.example.test': { loadingMode: 'sequential' } },
    },
  });
  let rejectNextSet = false;
  const originalSet = storage.set;
  storage.set = (value) => {
    if (rejectNextSet) {
      rejectNextSet = false;
      return Promise.reject(new Error('quota exceeded'));
    }
    return originalSet(value);
  };
  const store = createConfigStore(storage);
  await store.load('https://git.example.test');
  rejectNextSet = true;

  await assert.rejects(store.reset('https://git.example.test'), /quota exceeded/);
  assert.equal(store.getEffective('https://git.example.test').listFilter, 'issue');
  assert.equal(store.getEffective('https://git.example.test').loadingMode, 'sequential');
  assert.deepEqual(store.getEffective('https://git.example.test').position, { edge: 'right', ratio: 0.8 });

  await store.reset('https://git.example.test');
  assert.equal(store.getEffective('https://git.example.test').listFilter, 'all');
});

test('reset restores defaults and clears the stored legacy position', async () => {
  const storage = createMemoryStorage({
    [CONFIG_STORAGE_KEY]: {
      version: 1,
      user: { listFilter: 'issue' },
      position: { edge: 'left', ratio: 0.9 },
    },
    [LEGACY_POSITION_STORAGE_KEY]: { edge: 'left', ratio: 0.9 },
  });
  const store = createConfigStore(storage);
  await store.load('https://git.example.test');

  const effective = await store.reset('https://git.example.test');

  assert.equal(effective.listFilter, 'all');
  assert.deepEqual(effective.position, DEFAULT_POSITION);
  assert.deepEqual(storage.data[CONFIG_STORAGE_KEY].position, DEFAULT_POSITION);
  assert.deepEqual(storage.calls.remove, [LEGACY_POSITION_STORAGE_KEY]);
});

test('keeps a reset position when legacy cleanup fails', async () => {
  const storage = createMemoryStorage({
    [CONFIG_STORAGE_KEY]: {
      version: 1,
      position: { edge: 'right', ratio: 0.8 },
    },
    [LEGACY_POSITION_STORAGE_KEY]: { edge: 'right', ratio: 0.8 },
  });
  storage.remove = () => Promise.reject(new Error('cleanup unavailable'));
  const store = createConfigStore(storage);

  const effective = await store.resetPosition('https://git.example.test');

  assert.deepEqual(effective.position, DEFAULT_POSITION);
  assert.deepEqual(storage.data[CONFIG_STORAGE_KEY].position, DEFAULT_POSITION);
});
