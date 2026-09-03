(function initializeGitLabReferenceBackground(root) {
  'use strict';

  // The service worker script lives at src/background.js, so importScripts
  // resolves relative URLs against src/ — use the sibling file name directly.
  if (typeof importScripts === 'function' && !root.GitLabReferencePermissions) {
    importScripts('permissions.js');
  }

  const chromeApi = root?.chrome;
  if (!chromeApi?.runtime?.onInstalled) return;

  const permissions = root.GitLabReferencePermissions;
  const permissionController = permissions?.createPermissionController
    ? permissions.createPermissionController(chromeApi)
    : permissions;
  const config = root.GitLabReferenceConfig;
  const CONFIG_STORAGE_KEY = 'gitlabReferenceConfig';

  console.log('[SW] boot: service worker started');

  // Cold-boot self-healing (#15 path D): dynamic content script registrations
  // do not survive browser restarts, extension reload, or SW idle eviction.
  // On every SW start, if nothing is registered (but permissions were granted
  // previously), re-sync unconditionally — syncRegisteredScripts is idempotent.
  chromeApi.scripting.getRegisteredContentScripts().then((scripts) => {
    if (scripts.length > 0) {
      return;
    }
    console.log('[SW] boot: no registered scripts found, syncing...');
    return permissionController.syncRegisteredScripts()
      .then(() => console.log('[SW] boot: sync done'))
      .catch((error) => console.log('[SW] boot: sync failed', error));
  }).catch((error) => {
    console.log('[SW] boot: getRegisteredContentScripts failed', error);
  });

  // Boot badge re-derivation (follow-up issue): the action badge is a
  // per-process provisional UI state that Chrome/Edge do not guarantee to
  // survive a full browser restart — the durable source of truth is
  // storage.local.pending (PENDING_ORIGINS_STORAGE_KEY). Rerun the idempotent
  // updatePendingBadge on every SW start so a real pending set is re-lit as
  // "!" after any restart shape that cleared the badge, without a user action.
  // This is intentionally decoupled from the script-registration state above:
  // even when registrations already exist, the badge may still need re-deriving.
  if (permissions?.updatePendingBadge) {
    permissions.updatePendingBadge(chromeApi)
      .catch((error) => console.log('[SW] boot: badge re-derivation failed', error));
  }

  function readLegacyConfig() {
    return chromeApi.storage.local.get([CONFIG_STORAGE_KEY]).then((result) => {
      const stored = result?.[CONFIG_STORAGE_KEY];
      const sites = stored?.sites && typeof stored.sites === 'object' ? stored.sites : {};
      const searchStateQuery = typeof stored?.searchState?.query === 'string'
        ? stored.searchState.query
        : '';
      return Promise.resolve([
        ...Object.keys(sites),
        searchStateQuery,
      ]);
    });
  }

  chromeApi.runtime.onInstalled.addListener((details) => {
    if (details?.reason === 'update' || details?.reason === 'chrome_update') {
      // Re-register dynamic content scripts after extension reload or Chrome
      // upgrade — registrations do not survive these restarts (issue #15).
      console.log(`[SW] onInstalled: ${details.reason}`);
      permissionController.syncRegisteredScripts().catch((error) => {
        console.log('[SW] onInstalled sync failed', error);
      });
    }
    if (details?.reason !== 'update') {
      // Fresh installs start with no static injection; users authorize from options.
      return;
    }
    permissions.migrateLegacyOriginsOnUpdate(chromeApi, readLegacyConfig).then((migrated) => {
      if (!migrated.length) return;
      permissions.updatePendingBadge(chromeApi);
      permissionController.syncRegisteredScripts();
    });
  });

  if (chromeApi.permissions?.onRemoved) {
    chromeApi.permissions.onRemoved.addListener(() => {
      permissionController.handlePermissionRemoved();
    });
  }

  // onStartup listener intentionally removed (#15 path D): cold-boot self-heal
  // above covers all restart shapes (relaunch/reload/idle-revive/restart).

  // Test/observability hook: replying proves this service worker executed
  // and importScripts('permissions.js') resolved in the real SW environment.
  if (chromeApi.runtime?.onMessage) {
    chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type === 'gitlab-reference-permissions-ping') {
        sendResponse({ permissionsModuleLoaded: Boolean(root.GitLabReferencePermissions) });
      } else if (message?.type === 'gitlab-reference-open-options') {
        // #20 (final): opening the options page from a content-script context via
        // getURL + window.open is blocked by the browser (ERR_BLOCKED_BY_CLIENT).
        // Route through the service worker using the official openOptionsPage API,
        // which opens from the extension backend and is not subject to that block.
        chromeApi.runtime.openOptionsPage?.();
        sendResponse({ opened: true });
      }
      return false;
    });
  }
})(typeof globalThis === 'undefined' ? this : globalThis);
