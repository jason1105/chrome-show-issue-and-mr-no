(function initializeGitLabReferencePermissions(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GitLabReferencePermissions = api;
})(typeof globalThis === 'undefined' ? this : globalThis, () => {
  'use strict';

  const PENDING_ORIGINS_STORAGE_KEY = 'gitlabReferencePendingOrigins';
  const REGISTERED_SCRIPT_ID = 'gitlab-reference-content-scripts';
  const NAVIGATION_HOOK_SCRIPT_ID = 'gitlab-reference-navigation-hook';
  const NAVIGATION_HOOK_FILES = Object.freeze(['src/navigation-hook.js']);
  const CONTENT_SCRIPT_FILES = Object.freeze([
    'src/parser.js',
    'src/config.js',
    'src/i18n.js',
    'src/ui.js',
    'src/content.js',
  ]);

  function normalizeOriginInput(value) {
    if (typeof value !== 'string') return null;
    let url;
    try {
      url = new URL(value.trim());
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.protocol}//${url.host}`;
  }

  function buildMatchPatterns(origins) {
    const patterns = [];
    const seen = new Set();
    for (const origin of origins) {
      const normalized = normalizeOriginInput(origin);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      patterns.push(`${normalized}/*`);
    }
    return patterns;
  }

  const PENDING_BADGE_TEXT = '!';

  // Reflect pending re-authorization origins on the action badge so users
  // notice the extension lost host access (e.g. after an upgrade removed
  // static content_scripts) and are guided to the options page.
  function updatePendingBadge(chromeLike) {
    const actionApi = chromeLike?.action;
    if (!actionApi?.setBadgeText) return Promise.resolve();
    return createPermissionController(chromeLike).readPendingOrigins().then((pending) => {
      const hasPending = pending.length > 0;
      const badgeOps = [
        hasPending
          ? actionApi.setBadgeText({ text: PENDING_BADGE_TEXT })
          : actionApi.setBadgeText({ text: '' }),
      ];
      if (actionApi.setBadgeBackgroundColor) {
        badgeOps.push(actionApi.setBadgeBackgroundColor({ color: '#c62828' }));
      }
      return Promise.all(badgeOps).catch(() => {});
    });
  }

  function createPermissionController(chromeLike, options = {}) {
    const permissionsApi = chromeLike?.permissions;
    const scriptingApi = chromeLike?.scripting;
    const storageArea = chromeLike?.storage?.local;

    function readPendingOrigins() {
      if (!storageArea?.get) return Promise.resolve([]);
      return storageArea
        .get([PENDING_ORIGINS_STORAGE_KEY])
        .then((result) => {
          const value = result?.[PENDING_ORIGINS_STORAGE_KEY];
          return Array.isArray(value)
            ? value.filter((origin) => typeof origin === 'string')
            : [];
        })
        .catch(() => []);
    }

    function writePendingOrigins(origins) {
      if (!storageArea?.set) return Promise.resolve();
      return storageArea
        .set({ [PENDING_ORIGINS_STORAGE_KEY]: [...origins] })
        .catch(() => {});
    }

    function getAllOrigins() {
      if (!permissionsApi?.getAll) return Promise.resolve({ origins: [] });
      return permissionsApi.getAll().then(
        (granted) => ({ origins: Array.isArray(granted?.origins) ? granted.origins : [] }),
        () => ({ origins: [] }),
      );
    }

    function syncRegisteredScripts() {
      console.log('[permissions] syncRegisteredScripts called');
      return getAllOrigins()
        .then(({ origins }) => {
          const patterns = buildMatchPatterns(origins);
          if (!scriptingApi?.registerContentScripts) return { patterns, registered: false };
          const contentRegistration = {
            id: REGISTERED_SCRIPT_ID,
            js: [...CONTENT_SCRIPT_FILES],
            matches: patterns,
            runAt: options.runAt || 'document_start',
            // #14: persist so registrations survive browser restarts.
            persistAcrossSessions: true,
          };
          const navigationHookRegistration = {
            id: NAVIGATION_HOOK_SCRIPT_ID,
            js: [...NAVIGATION_HOOK_FILES],
            matches: patterns,
            runAt: options.runAt || 'document_start',
            world: 'MAIN',
            // #14: persist so registrations survive browser restarts.
            persistAcrossSessions: true,
          };
          return scriptingApi.unregisterContentScripts({
            ids: [REGISTERED_SCRIPT_ID, NAVIGATION_HOOK_SCRIPT_ID],
          })
            .catch(() => {})
            .then(() => {
              if (!patterns.length) return { patterns, registered: false };
              return scriptingApi.registerContentScripts([navigationHookRegistration, contentRegistration])
                .then(() => { console.log('[permissions] syncRegisteredScripts: registered=2, patterns=', patterns.length); return { patterns, registered: true }; }, (err) => { console.log('[permissions] registerContentScripts failed:', err && err.message); return { patterns, registered: false }; });
            });
        });
    }

    function requestOrigin(origin) {
      const normalized = normalizeOriginInput(origin);
      if (!normalized) return Promise.resolve({ ok: false, reason: 'invalid-origin', origin: null });
      if (!permissionsApi?.contains || !permissionsApi?.request) {
        return Promise.resolve({ ok: false, reason: 'unsupported', origin: normalized });
      }
      const requested = { origins: [`${normalized}/*`] };
      return permissionsApi.contains(requested).then(
        (already) => {
          if (already) {
            return syncRegisteredScripts().then(() => ({ ok: true, reason: 'already-granted', origin: normalized }));
          }
          return permissionsApi.request(requested).then(
            (granted) => syncRegisteredScripts().then(() => {
              if (granted) {
                return readPendingOrigins().then((pending) => writePendingOrigins(
                  pending.filter((item) => item !== normalized),
                )).then(() => {
                  updatePendingBadge(chromeLike);
                  return { ok: true, reason: 'granted', origin: normalized };
                });
              }
              return { ok: false, reason: 'denied', origin: normalized };
            }),
            () => ({ ok: false, reason: 'denied', origin: normalized }),
          );
        },
        () => ({ ok: false, reason: 'unsupported', origin: normalized }),
      );
    }

    function removeOrigin(origin) {
      const normalized = normalizeOriginInput(origin);
      if (!normalized) return Promise.resolve({ ok: false, reason: 'invalid-origin', origin: null });
      const removal = { origins: [`${normalized}/*`] };
      const dropPermission = permissionsApi?.remove
        ? permissionsApi.remove(removal).then(
          (removed) => removed !== false,
          () => false,
        )
        : Promise.resolve(false);
      return dropPermission.then((removed) => {
        if (!removed) {
          return { ok: false, reason: 'remove-failed', origin: normalized };
        }
        return syncRegisteredScripts().then(() => {
          updatePendingBadge(chromeLike);
          return { ok: true, reason: 'removed', origin: normalized };
        });
      });
    }

    function listGrantedOrigins() {
      return getAllOrigins().then(({ origins }) => {
        const normalized = [];
        const seen = new Set();
        for (const pattern of origins) {
          const origin = normalizeOriginInput(pattern);
          if (!origin || seen.has(origin)) continue;
          seen.add(origin);
          normalized.push(origin);
        }
        return normalized;
      });
    }

    function handlePermissionRemoved() {
      return syncRegisteredScripts();
    }

    return {
      requestOrigin,
      removeOrigin,
      listGrantedOrigins,
      readPendingOrigins,
      syncRegisteredScripts,
      handlePermissionRemoved,
    };
  }

  function migrateLegacyOriginsOnUpdate(chromeLike, readLegacyConfig) {
    if (!chromeLike?.storage?.local?.get) return Promise.resolve([]);
    return readLegacyConfig()
      .then((origins) => {
        const unique = [];
        const seen = new Set();
        for (const origin of origins) {
          const normalized = normalizeOriginInput(origin);
          if (!normalized || seen.has(normalized)) continue;
          seen.add(normalized);
          unique.push(normalized);
        }
        if (!unique.length) return [];
        return chromeLike.storage.local
          .get([PENDING_ORIGINS_STORAGE_KEY])
          .then((result) => {
            const existing = result?.[PENDING_ORIGINS_STORAGE_KEY];
            const merged = Array.isArray(existing) ? [...existing] : [];
            for (const origin of unique) {
              if (!merged.includes(origin)) merged.push(origin);
            }
            return chromeLike.storage.local
              .set({ [PENDING_ORIGINS_STORAGE_KEY]: merged })
              .then(() => merged);
          })
          .catch(() => []);
      })
      .catch(() => []);
  }

  return {
    CONTENT_SCRIPT_FILES,
    NAVIGATION_HOOK_FILES,
    PENDING_ORIGINS_STORAGE_KEY,
    REGISTERED_SCRIPT_ID,
    NAVIGATION_HOOK_SCRIPT_ID,
    buildMatchPatterns,
    normalizeOriginInput,
    createPermissionController,
    migrateLegacyOriginsOnUpdate,
    updatePendingBadge,
  };
});
