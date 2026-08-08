(function initializeGitLabReferenceConfig(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GitLabReferenceConfig = api;
})(typeof globalThis === 'undefined' ? this : globalThis, () => {
  'use strict';

  const CONFIG_VERSION = 1;
  const CONFIG_STORAGE_KEY = 'gitlabReferenceConfig';
  const LEGACY_POSITION_STORAGE_KEY = 'gitlabReferenceControlPosition';
  const DEFAULT_POSITION = Object.freeze({ edge: 'top', ratio: 0.5 });
  const DEFAULT_USER = Object.freeze({
    listFilter: 'all',
    rememberSearch: false,
    cacheTtlSeconds: 60,
    maxItemsPerType: 100,
    loadingMode: 'parallel',
    showLastRefresh: true,
    touchDrag: true,
    keyboardStep: 8,
  });
  const PROTECTED_CONFIG = Object.freeze({
    allowRemoteConfig: false,
    maxItemsPerPage: 100,
    maxItemsPerType: 100,
    storeSensitiveData: false,
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

  function normalizePreference(name, value, fallback) {
    if (name === 'listFilter') {
      return value === 'issue' || value === 'merge-request' || value === 'all'
        ? value
        : fallback;
    }
    if (name === 'loadingMode') {
      return value === 'parallel' || value === 'sequential' ? value : fallback;
    }
    if (name === 'cacheTtlSeconds') return normalizeInteger(value, fallback, 5, 300);
    if (name === 'maxItemsPerType') return normalizeInteger(value, fallback, 1, PROTECTED_CONFIG.maxItemsPerType);
    if (name === 'keyboardStep') return normalizeInteger(value, fallback, 1, 50);
    if (name === 'rememberSearch' || name === 'showLastRefresh' || name === 'touchDrag') {
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

  function getDefaultConfig() {
    return {
      version: CONFIG_VERSION,
      user: { ...DEFAULT_USER },
      userOverrides: {},
      sites: {},
      position: { ...DEFAULT_POSITION },
    };
  }

  function normalizeConfig(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
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
      protected: { ...PROTECTED_CONFIG },
    };
  }

  function createConfigStore(storage, options = {}) {
    let config = normalizeConfig(options.initialConfig);
    let loaded = Boolean(options.initialConfig);
    let pendingLoad = null;

    function getEffective(origin) {
      return getEffectiveConfig(config, origin);
    }

    async function persist() {
      if (!storage?.set) return;
      await storage.set({ [CONFIG_STORAGE_KEY]: clone(config) });
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

    async function removeLegacyPosition() {
      if (!storage?.remove) return;
      await storage.remove(LEGACY_POSITION_STORAGE_KEY);
    }

    async function load(origin) {
      if (loaded) return getEffective(origin);
      if (pendingLoad) return pendingLoad.then(() => getEffective(origin));

      pendingLoad = (async () => {
        let stored;
        let legacyPosition;
        if (storage?.get) {
          try {
            const result = await storage.get([CONFIG_STORAGE_KEY, LEGACY_POSITION_STORAGE_KEY]);
            stored = result?.[CONFIG_STORAGE_KEY];
            legacyPosition = result?.[LEGACY_POSITION_STORAGE_KEY];
          } catch {
            stored = undefined;
            legacyPosition = undefined;
          }
        }
        config = normalizeConfig(stored);

        if (stored === undefined && legacyPosition !== undefined) {
          config.position = normalizePosition(legacyPosition);
          try {
            await persist();
            await removeLegacyPosition();
          } catch {
            // Keep the migrated value in memory if the browser rejects storage writes.
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
        for (const name of Object.keys(DEFAULT_USER)) {
          if (!Object.prototype.hasOwnProperty.call(userPatch || {}, name)) continue;
          config.user[name] = normalizePreference(name, userPatch[name], DEFAULT_USER[name]);
          config.userOverrides[name] = true;
        }
        config = normalizeConfig(config);
        await persist();
        return getEffective(origin);
      });
    }

    async function saveSite(siteOrigin, sitePatch, origin = siteOrigin) {
      return enqueueMutation(async () => {
        await ensureLoaded();
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
        config.position = normalizePosition(nextPosition);
        config = normalizeConfig(config);
        await persist();
        return getEffective(origin);
      });
    }

    async function resetPosition(origin) {
      return enqueueMutation(async () => {
        await ensureLoaded();
        config.position = { ...DEFAULT_POSITION };
        config = normalizeConfig(config);
        await persist();
        await removeLegacyPosition();
        return getEffective(origin);
      });
    }

    async function reset(origin) {
      return enqueueMutation(async () => {
        await ensureLoaded();
        config = getDefaultConfig();
        await persist();
        try {
          await removeLegacyPosition();
        } catch {
          // The in-memory reset is still valid when cleanup is rejected.
        }
        return getEffective(origin);
      });
    }

    return {
      getEffective,
      load,
      reset,
      resetPosition,
      save,
      saveSite,
      setPosition,
      getConfig: () => clone(config),
    };
  }

  return {
    CONFIG_VERSION,
    CONFIG_STORAGE_KEY,
    LEGACY_POSITION_STORAGE_KEY,
    DEFAULT_POSITION,
    DEFAULT_USER,
    PROTECTED_CONFIG,
    createConfigStore,
    getDefaultConfig,
    getEffectiveConfig,
    normalizeConfig,
    normalizePosition,
  };
});
