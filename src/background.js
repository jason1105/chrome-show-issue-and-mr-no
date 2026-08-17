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
  const config = root.GitLabReferenceConfig;
  const CONFIG_STORAGE_KEY = 'gitlabReferenceConfig';

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
    if (details?.reason !== 'update') {
      // Fresh installs start with no static injection; users authorize from options.
      return;
    }
    permissions.migrateLegacyOriginsOnUpdate(chromeApi, readLegacyConfig).then((migrated) => {
      if (!migrated.length) return;
      permissions.updatePendingBadge(chromeApi);
      permissions.syncRegisteredScripts();
    });
  });

  if (chromeApi.permissions?.onRemoved) {
    chromeApi.permissions.onRemoved.addListener(() => {
      permissions.handlePermissionRemoved();
    });
  }

  if (chromeApi.runtime?.onStartup) {
    chromeApi.runtime.onStartup.addListener(() => {
      permissions.syncRegisteredScripts();
    });
  }
})(typeof globalThis === 'undefined' ? this : globalThis);
