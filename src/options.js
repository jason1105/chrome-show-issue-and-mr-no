(function initializeGitLabReferenceOptions(root, factory) {
  'use strict';

  const api = factory(root.GitLabReferenceConfig, root.GitLabReferenceI18n);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GitLabReferenceOptions = api;
  if (!root.document || !root.GitLabReferenceConfig) return;

  const storage = root.chrome?.storage?.sync;
  const store = root.GitLabReferenceConfig.createConfigStore(storage, {
    legacyStorage: root.chrome?.storage?.local,
    storageChangeEvents: root.chrome?.storage?.onChanged,
  });
  const permissionsApi = root.GitLabReferencePermissions
    ? root.GitLabReferencePermissions.createPermissionController(root.chrome)
    : null;
  const controller = api.createOptionsController(
    root.document,
    store,
    root.location?.origin || '',
    permissionsApi,
  );
  controller.init();
})(typeof globalThis === 'undefined' ? this : globalThis, (configApi, i18nApi) => {
  'use strict';

  const t = (key, substitutions) => (
    i18nApi && typeof i18nApi.getMessage === 'function'
      ? i18nApi.getMessage(key, substitutions)
      : key
  );

  const FIELD_IDS = {
    listFilter: 'list-filter',
    // #16: itemStateFilter moved to the in-page panel; the options select was
    // removed. Kept as a known (nullable) field so the config plumbing stays
    // intact while the panel owns the value.
    itemStateFilter: 'item-state-filter',
    searchScope: 'search-scope',
    rememberSearch: 'remember-search',
    cacheTtlSeconds: 'cache-ttl',
    maxItemsPerType: 'max-items',
    maxItemsPerBatch: 'max-items-batch',
    requestTimeoutMs: 'request-timeout',
    loadingMode: 'loading-mode',
    showLastRefresh: 'show-last-refresh',
    touchDrag: 'touch-drag',
    keyboardStep: 'keyboard-step',
    showOnAllRepoPages: 'show-all-repo-pages',
  };

  function buildUserPatch(fields) {
    const patch = {
      listFilter: fields.listFilter.value,
      searchScope: fields.searchScope.value,
      rememberSearch: Boolean(fields.rememberSearch.checked),
      loadingMode: fields.loadingMode.value,
      showLastRefresh: Boolean(fields.showLastRefresh.checked),
      touchDrag: Boolean(fields.touchDrag.checked),
      showOnAllRepoPages: Boolean(fields.showOnAllRepoPages.checked),
    };
    for (const [name, field] of [
      ['cacheTtlSeconds', fields.cacheTtlSeconds],
      ['maxItemsPerType', fields.maxItemsPerType],
      ['maxItemsPerBatch', fields.maxItemsPerBatch],
      ['requestTimeoutMs', fields.requestTimeoutMs],
      ['keyboardStep', fields.keyboardStep],
    ]) {
      const rawValue = String(field?.value ?? '').trim();
      if (!rawValue) continue;
      const value = Number(rawValue);
      if (Number.isFinite(value)) patch[name] = value;
    }
    return patch;
  }

  function getFields(document) {
    return Object.fromEntries(
      Object.entries(FIELD_IDS).map(([name, id]) => [name, document.getElementById(id)]),
    );
  }

  function applyEffectiveConfig(fields, effective) {
    fields.listFilter.value = effective.listFilter;
    if (fields.itemStateFilter) fields.itemStateFilter.value = effective.itemStateFilter;
    fields.searchScope.value = effective.searchScope;
    fields.rememberSearch.checked = effective.rememberSearch;
    fields.cacheTtlSeconds.value = String(effective.cacheTtlSeconds);
    fields.maxItemsPerType.value = String(effective.maxItemsPerType);
    fields.maxItemsPerBatch.value = String(effective.maxItemsPerBatch);
    fields.requestTimeoutMs.value = String(effective.requestTimeoutMs);
    fields.loadingMode.value = effective.loadingMode;
    fields.showLastRefresh.checked = effective.showLastRefresh;
    fields.touchDrag.checked = effective.touchDrag;
    fields.showOnAllRepoPages.checked = effective.showOnAllRepoPages;
    fields.keyboardStep.value = String(effective.keyboardStep);
  }

  function createOptionsController(document, store, origin, permissionController = null) {
    const fields = getFields(document);
    const status = document.getElementById('status');
    const form = document.getElementById('settings-form');
    const resetButton = document.getElementById('reset-settings');
    let pending = Promise.resolve();

    const grantedList = document.getElementById('granted-origins');
    const originInput = document.getElementById('origin-input');
    const originStatus = document.getElementById('origin-status');
    const grantButton = document.getElementById('grant-origin');

    function setOriginStatus(message, isError = false) {
      if (!originStatus) return;
      originStatus.textContent = message;
      originStatus.setAttribute('data-status-kind', isError ? 'error' : 'success');
    }

    function renderGrantedOrigins(origins, pendingOrigins = []) {
      if (!grantedList) return;
      grantedList.textContent = '';
      for (const item of origins) {
        const li = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = item;
        li.appendChild(label);
        if (permissionController) {
          const revoke = document.createElement('button');
          revoke.type = 'button';
          revoke.className = 'secondary origin-revoke';
          revoke.textContent = t('revoke');
          revoke.setAttribute('aria-label', t('revokeAriaLabel', [item]));
          revoke.addEventListener('click', () => {
            setOriginStatus('');
            permissionController.removeOrigin(item).then((result) => {
              if (!result.ok) {
                setOriginStatus(t('revokeFailed', [item]), true);
                refreshOrigins();
                return;
              }
              setOriginStatus(t('revoked', [item]));
              refreshOrigins();
            });
          });
          li.appendChild(revoke);
        }
        grantedList.appendChild(li);
      }
      if (!origins.length) {
        const li = document.createElement('li');
        li.className = 'origin-empty';
        li.textContent = t('noOriginGranted');
        grantedList.appendChild(li);
      }
      for (const item of pendingOrigins) {
        if (origins.includes(item)) continue;
        const li = document.createElement('li');
        li.className = 'origin-pending';
        li.textContent = t('pendingReauth', [item]);
        grantedList.appendChild(li);
      }
    }

    function refreshOrigins() {
      if (!permissionController) return Promise.resolve();
      return Promise.all([
        permissionController.listGrantedOrigins(),
        permissionController.readPendingOrigins(),
      ]).then(([origins, pendingOrigins]) => {
        renderGrantedOrigins(origins, pendingOrigins);
        return origins;
      });
    }

    function grantOrigin() {
      if (!permissionController || !originInput) return;
      setOriginStatus('');
      permissionController.requestOrigin(originInput.value).then((result) => {
        if (!result.ok) {
          if (result.reason === 'invalid-origin') {
            setOriginStatus(t('originInvalid'), true);
          } else if (result.reason === 'denied') {
            setOriginStatus(t('originDenied'), true);
          } else {
            setOriginStatus(t('originUnsupported'), true);
          }
          return;
        }
        originInput.value = '';
        setOriginStatus(t('originGranted', [result.origin]));
        refreshOrigins();
      });
    }

    grantButton?.addEventListener('click', grantOrigin);

    function setStatus(message, isError = false) {
      if (!status) return;
      status.textContent = message;
      status.setAttribute('data-status-kind', isError ? 'error' : 'success');
    }

    async function init() {
      const effective = await store.load(origin);
      applyEffectiveConfig(fields, effective);
      setStatus('');
      refreshOrigins();
      return effective;
    }

    function submit(event) {
      event.preventDefault();
      const patch = buildUserPatch(fields);
      pending = store.save(patch, origin)
        .then((effective) => {
          applyEffectiveConfig(fields, effective);
          setStatus(t('settingsSaved'));
        })
        .catch(() => {
          setStatus(t('settingsSaveFailed'), true);
        });
    }

    function reset(event) {
      event.preventDefault();
      pending = store.reset(origin)
        .then((effective) => {
          applyEffectiveConfig(fields, effective);
          setStatus(t('settingsReset'));
        })
        .catch(() => {
          setStatus(t('settingsResetFailed'), true);
        });
    }

    form?.addEventListener('submit', submit);
    resetButton?.addEventListener('click', reset);

    return {
      init,
      flush: () => pending,
      submit,
      reset,
      refreshOrigins,
    };
  }

  return { FIELD_IDS, buildUserPatch, createOptionsController };
});
