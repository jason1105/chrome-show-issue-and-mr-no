const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONFIG_STORAGE_KEY,
  LEGACY_POSITION_STORAGE_KEY,
  DEFAULT_POSITION,
  createConfigStore,
  getDefaultConfig,
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
