(function initializeGitLabReferenceConfig(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GitLabReferenceConfig = api;
})(typeof globalThis === 'undefined' ? this : globalThis, () => {
  'use strict';

  const CONFIG_VERSION = 6;
  const CONFIG_STORAGE_KEY = 'gitlabReferenceConfig';
  const LEGACY_POSITION_STORAGE_KEY = 'gitlabReferenceControlPosition';
  const DEFAULT_POSITION = Object.freeze({ edge: 'top', ratio: 0.5 });
  const DEFAULT_SEARCH_STATE = Object.freeze({ query: '', listFilter: null });
  const DEFAULT_USER = Object.freeze({
    listFilter: 'all',
    rememberSearch: true,
    cacheTtlSeconds: 60,
    maxItemsPerType: 100,
    maxItemsPerBatch: 50,
    requestTimeoutMs: 10000,
    loadingMode: 'parallel',
    showLastRefresh: true,
    touchDrag: true,
    keyboardStep: 8,
    // #21: full-repo mode is on by default for new installs. Existing
    // configs are unaffected: migration v3 writes an explicit `false` for
    // legacy data, which normalizeConfig treats as a user override.
    showOnAllRepoPages: true,
    itemStateFilter: 'open',
    searchScope: 'title',
  });
  const PROTECTED_CONFIG = Object.freeze({
    allowRemoteConfig: false,
    maxItemsPerPage: 100,
    maxItemsPerType: 100,
    storeSensitiveData: false,
  });

  const CONFIG_MIGRATIONS = Object.freeze({
    0(input) {
      const user = input.user && typeof input.user === 'object' ? input.user : {};
      const userOverrides = input.userOverrides && typeof input.userOverrides === 'object'
        ? input.userOverrides
        : Object.fromEntries(Object.keys(DEFAULT_USER)
          .filter((name) => Object.prototype.hasOwnProperty.call(user, name))
          .map((name) => [name, true]));
      return {
        ...input,
        version: 1,
        user,
        userOverrides,
      };
    },
    1(input) {
      const user = input.user && typeof input.user === 'object' ? { ...input.user } : {};
      const userOverrides = input.userOverrides && typeof input.userOverrides === 'object'
        ? { ...input.userOverrides }
        : Object.fromEntries(Object.keys(DEFAULT_USER)
          .filter((name) => Object.prototype.hasOwnProperty.call(user, name))
          .map((name) => [name, true]));
      const explicitlyDisabled = userOverrides.rememberSearch === true
        && user.rememberSearch === false;
      user.rememberSearch = explicitlyDisabled ? false : true;
      return {
        ...input,
        version: 2,
        user,
        userOverrides,
        searchState: { ...DEFAULT_SEARCH_STATE },
      };
    },
    2(input) {
      const user = input.user && typeof input.user === 'object' ? { ...input.user } : {};
      const userOverrides = input.userOverrides && typeof input.userOverrides === 'object'
        ? { ...input.userOverrides }
        : Object.fromEntries(Object.keys(DEFAULT_USER)
          .filter((name) => Object.prototype.hasOwnProperty.call(user, name))
          .map((name) => [name, true]));
      // New in v3: full-repo display mode. Older configs must keep the
      // historical behavior (detail pages only), so the default is false and
      // never promoted to a user override.
      user.showOnAllRepoPages = typeof user.showOnAllRepoPages === 'boolean'
        ? user.showOnAllRepoPages
        : false;
      return {
        ...input,
        version: 3,
        user,
        userOverrides,
      };
    },
    3(input) {
      const user = input.user && typeof input.user === 'object' ? { ...input.user } : {};
      const userOverrides = input.userOverrides && typeof input.userOverrides === 'object'
        ? { ...input.userOverrides }
        : Object.fromEntries(Object.keys(DEFAULT_USER)
          .filter((name) => Object.prototype.hasOwnProperty.call(user, name))
          .map((name) => [name, true]));
      // New in v4: item state filter (open/all). Older configs keep the
      // historical open-only behavior. A v3 config that already carries an
      // explicit itemStateFilter (e.g. written by later builds) counts as a
      // user-set preference and is recorded in userOverrides accordingly.
      const hadExplicitItemStateFilter = Object.prototype.hasOwnProperty.call(
        user,
        'itemStateFilter',
      );
      user.itemStateFilter = user.itemStateFilter === 'all' ? 'all' : 'open';
      if (hadExplicitItemStateFilter) {
        userOverrides.itemStateFilter = true;
      }
      return {
        ...input,
        version: 4,
        user,
        userOverrides,
      };
    },
    4(input) {
      const user = input.user && typeof input.user === 'object' ? { ...input.user } : {};
      const userOverrides = input.userOverrides && typeof input.userOverrides === 'object'
        ? { ...input.userOverrides }
        : Object.fromEntries(Object.keys(DEFAULT_USER)
          .filter((name) => Object.prototype.hasOwnProperty.call(user, name))
          .map((name) => [name, true]));
      // New in v5: search scope (title/number). Older configs default to the
      // new title-matching behavior. A v4 config that already carries an
      // explicit searchScope (e.g. written by later builds) counts as a
      // user-set preference and is recorded in userOverrides accordingly.
      const hadExplicitSearchScope = Object.prototype.hasOwnProperty.call(
        user,
        'searchScope',
      );
      user.searchScope = user.searchScope === 'number' ? 'number' : 'title';
      if (hadExplicitSearchScope) {
        userOverrides.searchScope = true;
      }
      return {
        ...input,
        version: 5,
        user,
        userOverrides,
      };
    },
    5(input) {
      const user = input.user && typeof input.user === 'object' ? { ...input.user } : {};
      const userOverrides = input.userOverrides && typeof input.userOverrides === 'object'
        ? { ...input.userOverrides }
        : Object.fromEntries(Object.keys(DEFAULT_USER)
          .filter((name) => Object.prototype.hasOwnProperty.call(user, name))
          .map((name) => [name, true]));
      // New in v6 (#21): full-repo mode now defaults to ON for fresh
      // installs. Every config stored before this flip carries an explicit
      // user.showOnAllRepoPages value written by the old default; pin it as
      // an override so existing installs keep their historical (off, unless
      // explicitly enabled) behavior instead of being silently switched.
      if (Object.prototype.hasOwnProperty.call(user, 'showOnAllRepoPages')) {
        userOverrides.showOnAllRepoPages = true;
      }
      return {
        ...input,
        version: 6,
        user,
        userOverrides,
      };
    },
  });

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function normalizeInteger(value, fallback, minimum, maximum) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return clamp(Math.round(value), minimum, maximum);
  }

  function normalizePosition(value) {
    if (!value || typeof value !== 'object') return { ...DEFAULT_POSITION };
    if (
      (value.edge !== 'left' && value.edge !== 'right' && value.edge !== 'top')
      || typeof value.ratio !== 'number'
      || !Number.isFinite(value.ratio)
      || value.ratio < 0
      || value.ratio > 1
    ) return { ...DEFAULT_POSITION };
    const edge = value.edge;
    const ratio = value.ratio;
    return { edge, ratio };
  }

  function normalizeSearchState(value) {
    if (!value || typeof value !== 'object') return { ...DEFAULT_SEARCH_STATE };
    const query = typeof value.query === 'string' ? value.query : DEFAULT_SEARCH_STATE.query;
    const listFilter = value.listFilter === 'issue'
      || value.listFilter === 'merge-request'
      || value.listFilter === 'all'
      ? value.listFilter
      : DEFAULT_SEARCH_STATE.listFilter;
    return { query, listFilter };
  }

  function normalizePreference(name, value, fallback) {
    if (name === 'listFilter') {
      return value === 'issue' || value === 'merge-request' || value === 'all'
        ? value
        : fallback;
    }
    if (name === 'itemStateFilter') {
      return value === 'open' || value === 'all' ? value : fallback;
    }
    if (name === 'searchScope') {
      return value === 'title' || value === 'number' ? value : fallback;
    }
    if (name === 'loadingMode') {
      return value === 'parallel' || value === 'sequential' || value === 'paginated'
        ? value
        : fallback;
    }
    if (name === 'cacheTtlSeconds') return normalizeInteger(value, fallback, 5, 300);
    if (name === 'maxItemsPerType') return normalizeInteger(value, fallback, 1, PROTECTED_CONFIG.maxItemsPerType);
    if (name === 'maxItemsPerBatch') return normalizeInteger(value, fallback, 1, PROTECTED_CONFIG.maxItemsPerPage);
    if (name === 'requestTimeoutMs') return normalizeInteger(value, fallback, 1000, 60000);
    if (name === 'keyboardStep') return normalizeInteger(value, fallback, 1, 50);
    if (name === 'rememberSearch' || name === 'showLastRefresh' || name === 'touchDrag'
      || name === 'showOnAllRepoPages') {
      return typeof value === 'boolean' ? value : fallback;
    }
    return fallback;
  }

  function normalizeProfile(profile) {
    if (!profile || typeof profile !== 'object') return {};
    const normalized = {};
    for (const name of Object.keys(DEFAULT_USER)) {
      if (Object.prototype.hasOwnProperty.call(profile, name)) {
        normalized[name] = normalizePreference(name, profile[name], DEFAULT_USER[name]);
      }
    }
    return normalized;
  }

  function getStoredVersion(raw) {
    return Number.isInteger(raw?.version) && raw.version >= 0 ? raw.version : 0;
  }

  function migrateConfig(raw) {
    // A missing record means a fresh install (#21): skip the migration chain
    // entirely so current defaults apply. Any stored object, however sparse,
    // is treated as legacy data and goes through the migrations.
    if (!raw || typeof raw !== 'object') return getDefaultConfig();
    let migrated = clone(raw);
    let version = getStoredVersion(migrated);

    while (version < CONFIG_VERSION) {
      const migrate = CONFIG_MIGRATIONS[version];
      if (!migrate) return {};
      migrated = migrate(migrated);
      const nextVersion = getStoredVersion(migrated);
      if (nextVersion <= version) return {};
      version = nextVersion;
    }

    return migrated;
  }

  function getDefaultConfig() {
    return {
      version: CONFIG_VERSION,
      user: { ...DEFAULT_USER },
      userOverrides: {},
      sites: {},
      position: { ...DEFAULT_POSITION },
      searchState: { ...DEFAULT_SEARCH_STATE },
    };
  }

  function normalizeConfig(raw) {
    const input = migrateConfig(raw);
    const rawUser = input.user && typeof input.user === 'object' ? input.user : {};
    const user = {};
    for (const name of Object.keys(DEFAULT_USER)) {
      user[name] = normalizePreference(name, rawUser[name], DEFAULT_USER[name]);
    }
    const rawOverrides = input.userOverrides && typeof input.userOverrides === 'object'
      ? input.userOverrides
      : null;
    const userOverrides = {};
    for (const name of Object.keys(DEFAULT_USER)) {
      const explicitlySet = rawOverrides
        ? rawOverrides[name] === true
        : Object.prototype.hasOwnProperty.call(rawUser, name);
      if (explicitlySet) userOverrides[name] = true;
    }

    const sites = {};
    if (input.sites && typeof input.sites === 'object') {
      for (const [origin, profile] of Object.entries(input.sites)) {
        if (/^https?:\/\/[^\s/]+(?::\d+)?$/i.test(origin)) {
          sites[origin] = normalizeProfile(profile);
        }
      }
    }

    return {
      version: CONFIG_VERSION,
      user,
      userOverrides,
      sites,
      position: normalizePosition(input.position),
      searchState: normalizeSearchState(input.searchState),
    };
  }

  function getEffectiveConfig(config, origin) {
    const normalized = normalizeConfig(config);
    const site = normalized.sites[origin] || {};
    const preferences = { ...DEFAULT_USER, ...site };
    for (const name of Object.keys(normalized.userOverrides)) {
      preferences[name] = normalized.user[name];
    }
    preferences.maxItemsPerType = Math.min(
      preferences.maxItemsPerType,
      PROTECTED_CONFIG.maxItemsPerType,
    );
    return {
      ...preferences,
      position: { ...normalized.position },
      searchState: { ...normalized.searchState },
      protected: { ...PROTECTED_CONFIG },
    };
  }

  function createConfigStore(storage, options = {}) {
    let config = normalizeConfig(options.initialConfig);
    let loaded = Boolean(options.initialConfig);
    let pendingLoad = null;
    let disposed = false;
    let storedConfigPresent = Boolean(options.initialConfig);
    const legacyStorage = options.legacyStorage;

    function getEffective(origin) {
      return getEffectiveConfig(config, origin);
    }

    // One-time, idempotent migration (#17): the primary storage area is now
    // sync (so uninstall/reinstall restores configuration from the signed-in
    // Chrome account). Older builds persisted to storage.local. On first load
    // after upgrade, copy the local record into sync when sync has none. The
    // local copy is intentionally kept — background.js reads it during its
    // legacy origin migration on update, and keeping it makes the migration
    // re-runnable after a transient failure.
    async function migrateFromLegacyStorage() {
      if (!legacyStorage?.get || !storage?.set) return;
      const primary = await storage.get([CONFIG_STORAGE_KEY]);
      if (primary?.[CONFIG_STORAGE_KEY] !== undefined) return;
      const legacy = await legacyStorage.get([CONFIG_STORAGE_KEY]);
      if (legacy?.[CONFIG_STORAGE_KEY] === undefined) return;
      await storage.set({ [CONFIG_STORAGE_KEY]: legacy[CONFIG_STORAGE_KEY] });
    }

    async function persist(nextConfig = config) {
      if (!storage?.set) return;
      await storage.set({ [CONFIG_STORAGE_KEY]: clone(nextConfig) });
    }

    let mutationQueue = Promise.resolve();

    function enqueueMutation(operation) {
      const result = mutationQueue.then(operation);
      mutationQueue = result.catch(() => {});
      return result;
    }

    async function ensureLoaded() {
      if (!loaded) await load();
    }

    async function readStoredSnapshot() {
      if (!storage?.get) return { stored: undefined, legacyPosition: undefined };
      const result = await storage.get([CONFIG_STORAGE_KEY, LEGACY_POSITION_STORAGE_KEY]);
      return {
        stored: result?.[CONFIG_STORAGE_KEY],
        legacyPosition: result?.[LEGACY_POSITION_STORAGE_KEY],
      };
    }

    function applyStoredSnapshot(stored, legacyPosition) {
      storedConfigPresent = stored !== undefined;
      config = normalizeConfig(stored);
      const needsPositionMigration = legacyPosition !== undefined && (
        !stored
        || typeof stored !== 'object'
        || !Object.prototype.hasOwnProperty.call(stored, 'position')
      );
      if (needsPositionMigration) config.position = normalizePosition(legacyPosition);
      return {
        needsVersionMigration: stored !== undefined && getStoredVersion(stored) < CONFIG_VERSION,
        needsPositionMigration,
      };
    }

    async function refreshFromStorage() {
      if (!storage?.get) {
        return {
          needsVersionMigration: false,
          needsPositionMigration: false,
        };
      }
      const { stored, legacyPosition } = await readStoredSnapshot();
      return applyStoredSnapshot(stored, legacyPosition);
    }

    async function removeLegacyPosition() {
      if (!storage?.remove) return;
      await storage.remove(LEGACY_POSITION_STORAGE_KEY);
    }

    async function load(origin) {
      if (loaded) return getEffective(origin);
      if (pendingLoad) return pendingLoad.then(() => getEffective(origin));

      pendingLoad = (async () => {
        let migration;
        try {
          await migrateFromLegacyStorage();
          migration = await refreshFromStorage();
        } catch {
          config = getDefaultConfig();
          loaded = true;
          return;
        }

        const needsPersistence = migration.needsVersionMigration || migration.needsPositionMigration;
        let migrationPersisted = !needsPersistence;
        if (needsPersistence) {
          try {
            await persist();
            migrationPersisted = true;
          } catch {
            // Keep the migrated value in memory if the browser rejects storage writes.
          }
        }
        if (migration.needsPositionMigration && migrationPersisted) {
          try {
            await removeLegacyPosition();
          } catch {
            // The versioned position is already durable; stale legacy data is harmless.
          }
        }
        loaded = true;
      })().catch(() => {
        config = getDefaultConfig();
        loaded = true;
      });

      await pendingLoad;
      pendingLoad = null;
      return getEffective(origin);
    }

    async function save(userPatch, origin) {
      return enqueueMutation(async () => {
        await ensureLoaded();
        await refreshFromStorage();
        for (const name of Object.keys(DEFAULT_USER)) {
          if (!Object.prototype.hasOwnProperty.call(userPatch || {}, name)) continue;
          config.user[name] = normalizePreference(name, userPatch[name], DEFAULT_USER[name]);
          config.userOverrides[name] = true;
        }
        if (userPatch?.rememberSearch === false) {
          config.searchState = { ...DEFAULT_SEARCH_STATE };
        }
        config = normalizeConfig(config);
        await persist();
        return getEffective(origin);
      });
    }

    async function saveSite(siteOrigin, sitePatch, origin = siteOrigin) {
      return enqueueMutation(async () => {
        await ensureLoaded();
        await refreshFromStorage();
        if (typeof siteOrigin !== 'string' || !siteOrigin) return getEffective(origin);
        config.sites[siteOrigin] = normalizeProfile(sitePatch);
        config = normalizeConfig(config);
        await persist();
        return getEffective(origin);
      });
    }

    async function setPosition(nextPosition, origin) {
      return enqueueMutation(async () => {
        await ensureLoaded();
        await refreshFromStorage();
        config.position = normalizePosition(nextPosition);
        config = normalizeConfig(config);
        await persist();
        return getEffective(origin);
      });
    }

    async function setSearchState(nextSearchState, origin) {
      return enqueueMutation(async () => {
        await ensureLoaded();
        await refreshFromStorage();
        config.searchState = getEffective(origin).rememberSearch
          ? normalizeSearchState(nextSearchState)
          : { ...DEFAULT_SEARCH_STATE };
        config = normalizeConfig(config);
        await persist();
        return getEffective(origin);
      });
    }

    async function resetPosition(origin) {
      return enqueueMutation(async () => {
        await ensureLoaded();
        await refreshFromStorage();
        config.position = { ...DEFAULT_POSITION };
        config = normalizeConfig(config);
        await persist();
        try {
          await removeLegacyPosition();
        } catch {
          // The versioned position is already durable; stale legacy data is harmless.
        }
        return getEffective(origin);
      });
    }

    async function reset(origin) {
      return enqueueMutation(async () => {
        await ensureLoaded();
        await refreshFromStorage();
        const nextConfig = getDefaultConfig();
        await persist(nextConfig);
        config = nextConfig;
        try {
          await removeLegacyPosition();
        } catch {
          // The in-memory reset is still valid when cleanup is rejected.
        }
        return getEffective(origin);
      });
    }

    async function handleStorageChanged(changes, areaName) {
      if (disposed || (areaName && areaName !== 'sync')) return;
      if (!changes?.[CONFIG_STORAGE_KEY] && !changes?.[LEGACY_POSITION_STORAGE_KEY]) return;

      try {
        let changed = false;
        await enqueueMutation(async () => {
          await ensureLoaded();
          const previous = config;
          const configChange = changes[CONFIG_STORAGE_KEY];
          const legacyPositionChange = changes[LEGACY_POSITION_STORAGE_KEY];
          if (configChange) {
            applyStoredSnapshot(configChange.newValue, legacyPositionChange?.newValue);
          } else if (legacyPositionChange && !storedConfigPresent) {
            config = normalizeConfig({
              ...config,
              position: normalizePosition(legacyPositionChange.newValue),
            });
          }
          changed = JSON.stringify(previous) !== JSON.stringify(config);
        });
        if (changed && !disposed && typeof options.onConfigChanged === 'function') {
          options.onConfigChanged(changes, areaName);
        }
      } catch {
        // The next explicit read or write can recover from a transient storage failure.
      }
    }

    const storageChangeEvents = options.storageChangeEvents;
    storageChangeEvents?.addListener?.(handleStorageChanged);

    function dispose() {
      disposed = true;
      storageChangeEvents?.removeListener?.(handleStorageChanged);
    }

    return {
      getEffective,
      load,
      reset,
      resetPosition,
      save,
      saveSite,
      setPosition,
      setSearchState,
      getConfig: () => clone(config),
      dispose,
    };
  }

  return {
    CONFIG_VERSION,
    CONFIG_STORAGE_KEY,
    LEGACY_POSITION_STORAGE_KEY,
    DEFAULT_POSITION,
    DEFAULT_SEARCH_STATE,
    DEFAULT_USER,
    PROTECTED_CONFIG,
    createConfigStore,
    getDefaultConfig,
    getEffectiveConfig,
    migrateConfig,
    normalizeConfig,
    normalizePosition,
    normalizeSearchState,
  };
});
