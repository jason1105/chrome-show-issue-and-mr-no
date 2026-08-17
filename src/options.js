(function initializeGitLabReferenceOptions(root, factory) {
  'use strict';

  const api = factory(root.GitLabReferenceConfig);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GitLabReferenceOptions = api;
  if (!root.document || !root.GitLabReferenceConfig) return;

  const storage = root.chrome?.storage?.local;
  const store = root.GitLabReferenceConfig.createConfigStore(storage, {
    storageChangeEvents: root.chrome?.storage?.onChanged,
  });
  const controller = api.createOptionsController(
    root.document,
    store,
    root.location?.origin || '',
  );
  controller.init();
})(typeof globalThis === 'undefined' ? this : globalThis, () => {
  'use strict';

  const FIELD_IDS = {
    listFilter: 'list-filter',
    rememberSearch: 'remember-search',
    cacheTtlSeconds: 'cache-ttl',
    maxItemsPerType: 'max-items',
    maxItemsPerBatch: 'max-items-batch',
    requestTimeoutMs: 'request-timeout',
    loadingMode: 'loading-mode',
    showLastRefresh: 'show-last-refresh',
    touchDrag: 'touch-drag',
    keyboardStep: 'keyboard-step',
  };

  function buildUserPatch(fields) {
    const patch = {
      listFilter: fields.listFilter.value,
      rememberSearch: Boolean(fields.rememberSearch.checked),
      loadingMode: fields.loadingMode.value,
      showLastRefresh: Boolean(fields.showLastRefresh.checked),
      touchDrag: Boolean(fields.touchDrag.checked),
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
    fields.rememberSearch.checked = effective.rememberSearch;
    fields.cacheTtlSeconds.value = String(effective.cacheTtlSeconds);
    fields.maxItemsPerType.value = String(effective.maxItemsPerType);
    fields.maxItemsPerBatch.value = String(effective.maxItemsPerBatch);
    fields.requestTimeoutMs.value = String(effective.requestTimeoutMs);
    fields.loadingMode.value = effective.loadingMode;
    fields.showLastRefresh.checked = effective.showLastRefresh;
    fields.touchDrag.checked = effective.touchDrag;
    fields.keyboardStep.value = String(effective.keyboardStep);
  }

  function createOptionsController(document, store, origin) {
    const fields = getFields(document);
    const status = document.getElementById('status');
    const form = document.getElementById('settings-form');
    const resetButton = document.getElementById('reset-settings');
    let pending = Promise.resolve();

    function setStatus(message, isError = false) {
      if (!status) return;
      status.textContent = message;
      status.setAttribute('data-status-kind', isError ? 'error' : 'success');
    }

    async function init() {
      const effective = await store.load(origin);
      applyEffectiveConfig(fields, effective);
      setStatus('');
      return effective;
    }

    function submit(event) {
      event.preventDefault();
      const patch = buildUserPatch(fields);
      pending = store.save(patch, origin)
        .then((effective) => {
          applyEffectiveConfig(fields, effective);
          setStatus('设置已保存');
        })
        .catch(() => {
          setStatus('保存失败，请检查浏览器存储空间', true);
        });
    }

    function reset(event) {
      event.preventDefault();
      pending = store.reset(origin)
        .then((effective) => {
          applyEffectiveConfig(fields, effective);
          setStatus('已恢复默认设置');
        })
        .catch(() => {
          setStatus('恢复默认设置失败', true);
        });
    }

    form?.addEventListener('submit', submit);
    resetButton?.addEventListener('click', reset);

    return {
      init,
      flush: () => pending,
      submit,
      reset,
    };
  }

  return { FIELD_IDS, buildUserPatch, createOptionsController };
});
