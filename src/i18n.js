(function initializeGitLabReferenceI18n(root, factory) {
  'use strict';

  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GitLabReferenceI18n = api;
})(typeof globalThis === 'undefined' ? this : globalThis, (root) => {
  'use strict';

  // English fallback for non-extension contexts (tests, standalone loads).
  // Mirrors `_locales/en/messages.json` so the extension never renders raw
  // message keys when `chrome.i18n` is unavailable or a key is missing.
  const MESSAGES = Object.freeze({
    // Manifest
    extName: 'GitLab Issue/MR Number Pin',
    extDescription: 'Keep the current GitLab Issue or Merge Request number visible while scrolling.',
    // Options page (static)
    optionsTitle: 'GitLab Issue/MR Number Pin Settings',
    settingsEyebrow: 'GitLab Issue/MR Number Pin',
    settingsHeading: 'Settings',
    settingsDescription: 'Adjust list, cache, and control interaction preferences.',
    sectionList: 'List',
    defaultListFilter: 'Default list filter',
    listFilterAll: 'Issues and merge requests',
    listFilterIssue: 'Issues only',
    listFilterMergeRequest: 'Merge requests only',
    stateFilterMovedHint: 'The issue/MR state filter (Open only / All states) has moved into the panel; switch it there directly.',
    rememberSearch: 'Remember list search',
    searchScope: 'Search scope',
    searchScopeTitle: 'Title and number',
    searchScopeNumber: 'Number only',
    searchScopeHint: 'For a bare number: by default it matches both titles containing that number and items with that exact number; choosing "Number only" matches the exact number only.',
    language: 'Language',
    languageZhCn: '简体中文',
    languageEn: 'English',
    cacheTtl: 'Cache lifetime (seconds)',
    maxItemsPerType: 'Max items per type',
    loadingMode: 'Loading mode',
    loadingModeParallel: 'Parallel',
    loadingModeSequential: 'Sequential',
    loadingModePaginated: 'Paginated (first batch + load more)',
    maxItemsPerBatch: 'Paginated batch size',
    requestTimeout: 'Request timeout (milliseconds)',
    sectionDisplay: 'Display & interaction',
    showOnAllRepoPages: 'Show on all repository pages (full-repo mode)',
    showLastRefresh: 'Show last refresh time',
    touchDrag: 'Enable touch drag',
    keyboardStep: 'Keyboard step (pixels)',
    sectionAuth: 'Instance authorization',
    authHint: 'Authorize the GitLab instances where issue/MR numbers should be shown. Permissions are granted per instance and can be revoked at any time.',
    grantedOriginsLabel: 'Authorized GitLab instances',
    originAddress: 'GitLab instance URL',
    grantInstance: 'Authorize instance',
    resetDefaults: 'Restore defaults',
    saveSettings: 'Save settings',

    // Options page (dynamic)
    revoke: 'Revoke',
    revokeAriaLabel: 'Revoke authorization for $1',
    revokeFailed: 'Failed to revoke authorization for $1, please retry',
    revoked: 'Revoked authorization for $1',
    noOriginGranted: 'No instances authorized yet',
    pendingReauth: '$1 (re-authorization pending)',
    originInvalid: 'Invalid instance URL, please enter a full http(s) URL',
    originDenied: 'Authorization denied, you can retry in the instance list later',
    originUnsupported: 'Runtime authorization is not supported in this browser',
    originGranted: 'Authorized $1',
    settingsSaved: 'Settings saved',
    settingsSaveFailed: 'Save failed, please check browser storage',
    settingsReset: 'Default settings restored',
    settingsResetFailed: 'Failed to restore default settings',

    // Panel and badge
    copyDefault: 'Copy $1',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    current: 'Current',
    groupIssues: 'Issues',
    groupMergeRequests: 'Merge requests',
    loadFailed: 'Failed to load',
    loading: 'Loading',
    emptyOpenIssue: 'No open issues',
    emptyOpenMr: 'No open MRs',
    emptyIssue: 'No issues',
    emptyMr: 'No MRs',
    loadingMore: 'Loading more…',
    loadMore: 'Load more ($1 loaded)',
    reachedLimit: 'Reached the limit of $1',
    loadedAll: 'All $1 loaded',
    justUpdated: 'Just now',
    minutesAgo: '$1 min ago',
    summaryNoMatch: 'No matching open items',
    summaryFound: 'Found $1 open items',
    emptyNoMatchOpen: 'No matching open items',
    emptyNoMatchAll: 'No matching items',
    emptyHintSearch: 'Try a different number or keyword.',
    emptyHintNoOpen: 'This project has no items to show yet.',
    emptyClearSearch: 'Clear search',
    emptyShowAllTypes: 'Show all types',
    panelHeading: 'Open items',
    refreshAriaLabel: 'Refresh open items list',
    refreshList: 'Refresh',
    openSettingsAriaLabel: 'Open settings page',
    settingsTitle: 'Settings',
    searchAriaLabel: 'Search open items',
    searchPlaceholder: 'Search number or title',
    filterTypeAriaLabel: 'Filter open items by type',
    filterAll: 'All',
    filterIssue: 'Issue',
    filterMr: 'MR',
    stateLabel: 'State',
    filterStateAriaLabel: 'Filter items by state',
    stateOpenOnly: 'Open only',
    stateAll: 'All states',
    lastRefreshPrefix: 'Updated $1',
    loadFailedRetry: 'Failed to load, please retry',
    issueUpdateFailed: 'Issue update failed, MR updated',
    mrUpdateFailed: 'MR update failed, Issue updated',
    refreshFailedShowLast: 'Refresh failed, showing last results',
    loadMoreFailed: 'Failed to load more, please retry',
    dragAriaLabel: 'Drag to reposition, double-click to reset. Use arrow keys to fine-tune when focused, Home to reset.',
    dragTooltip: 'Drag to reposition',
    triggerAriaLabel: 'Open the open issues and MRs list for the current project',
    triggerAriaLabelProject: 'Open the open issues and MRs list for the $1 project',
  });

  function interpolate(template, substitutions) {
    if (typeof template !== 'string' || !substitutions || substitutions.length === 0) {
      return template;
    }
    return template.replace(/\$(\d+)/g, (match, index) => {
      const value = substitutions[Number(index) - 1];
      return value === undefined ? match : String(value);
    });
  }

  // zh_CN mirror of _locales/zh_CN/messages.json so manual language switching
  // works without reloading the extension. Kept in sync by tests/i18n.test.js.
  const ZH_MESSAGES = Object.freeze({
    extName: 'GitLab Issue/MR 编号图钉',
    extDescription: '滚动页面时保持当前 GitLab Issue 或 Merge Request 编号始终可见。',
    optionsTitle: 'GitLab Issue/MR 编号图钉设置',
    settingsEyebrow: 'GitLab Issue/MR 编号图钉',
    settingsHeading: '设置',
    settingsDescription: '调整列表、缓存与交互控制偏好。',
    sectionList: '列表',
    defaultListFilter: '默认列表筛选',
    listFilterAll: 'Issue 与合并请求',
    listFilterIssue: '仅 Issue',
    listFilterMergeRequest: '仅合并请求',
    stateFilterMovedHint: 'Issue/MR 状态筛选（仅 Open / 全部状态）已移动到面板中，请在面板内直接切换。',
    rememberSearch: '记住列表搜索',
    searchScope: '搜索范围',
    searchScopeTitle: '标题与编号',
    searchScopeNumber: '仅编号',
    searchScopeHint: '对于纯数字：默认同时匹配标题包含该数字的条目与编号精确等于该数字的条目；选择「仅编号」则只做精确匹配。',
    language: '语言',
    languageZhCn: '简体中文',
    languageEn: 'English',
    cacheTtl: '缓存时长（秒）',
    maxItemsPerType: '每类最大条目数',
    loadingMode: '加载模式',
    loadingModeParallel: '并行',
    loadingModeSequential: '顺序',
    loadingModePaginated: '分页（首批 + 加载更多）',
    maxItemsPerBatch: '分页批次大小',
    requestTimeout: '请求超时（毫秒）',
    sectionDisplay: '显示与交互',
    showOnAllRepoPages: '在所有仓库页面显示（全仓库模式）',
    showLastRefresh: '显示上次刷新时间',
    touchDrag: '启用触屏拖拽',
    keyboardStep: '键盘步长（像素）',
    sectionAuth: '实例授权',
    authHint: '授权需要显示 Issue/MR 编号的 GitLab 实例。权限按实例单独授予，可随时撤销。',
    grantedOriginsLabel: '已授权的 GitLab 实例',
    originAddress: 'GitLab 实例 URL',
    grantInstance: '授权实例',
    resetDefaults: '恢复默认设置',
    saveSettings: '保存设置',
    revoke: '撤销',
    revokeAriaLabel: '撤销对 $1 的授权',
    revokeFailed: '撤销 $1 授权失败，请重试',
    revoked: '已撤销 $1 的授权',
    noOriginGranted: '尚未授权任何实例',
    pendingReauth: '$1（待重新授权）',
    originInvalid: '实例 URL 无效，请输入完整的 http(s) URL',
    originDenied: '授权被拒绝，稍后可在实例列表中重试',
    originUnsupported: '当前浏览器不支持运行时授权',
    originGranted: '已授权 $1',
    settingsSaved: '设置已保存',
    settingsSaveFailed: '保存失败，请检查浏览器存储',
    settingsReset: '已恢复默认设置',
    settingsResetFailed: '恢复默认设置失败',
    copyDefault: '复制 $1',
    copied: '已复制',
    copyFailed: '复制失败',
    current: '当前',
    groupIssues: 'Issue',
    groupMergeRequests: '合并请求',
    loadFailed: '无法加载',
    loading: '正在加载',
    emptyOpenIssue: '暂无 Open Issue',
    emptyOpenMr: '暂无 Open MR',
    emptyIssue: '暂无 Issue',
    emptyMr: '暂无 MR',
    loadingMore: '正在加载更多…',
    loadMore: '加载更多（已加载 $1 条）',
    reachedLimit: '已达到上限 $1 条',
    loadedAll: '已加载全部 $1 条',
    justUpdated: '刚刚更新',
    minutesAgo: '$1 分钟前更新',
    summaryNoMatch: '没有匹配的 Open items',
    summaryFound: '找到 $1 个 Open items',
    emptyNoMatchOpen: '没有匹配的 Open items',
    emptyNoMatchAll: '没有匹配的 items',
    emptyHintSearch: '换一个编号或关键词试试。',
    emptyHintNoOpen: '该项目暂无可显示的条目。',
    emptyClearSearch: '清空搜索',
    emptyShowAllTypes: '显示全部类型',
    panelHeading: 'Open items',
    refreshAriaLabel: '刷新 Open items 列表',
    refreshList: '刷新列表',
    openSettingsAriaLabel: '打开设置页',
    settingsTitle: '设置',
    searchAriaLabel: '搜索 Open items',
    searchPlaceholder: '搜索编号或标题',
    filterTypeAriaLabel: '筛选 Open items 类型',
    filterAll: '全部',
    filterIssue: 'Issue',
    filterMr: 'MR',
    stateLabel: '状态',
    filterStateAriaLabel: '筛选 items 状态',
    stateOpenOnly: '仅 Open',
    stateAll: '全部状态',
    lastRefreshPrefix: '更新于 $1',
    loadFailedRetry: '加载失败，请重试',
    issueUpdateFailed: 'Issue 更新失败，MR 已更新',
    mrUpdateFailed: 'MR 更新失败，Issue 已更新',
    refreshFailedShowLast: '刷新失败，显示上次结果',
    loadMoreFailed: '加载更多失败，请重试',
    dragAriaLabel: '拖动调整位置，双击恢复默认位置。焦点下可用方向键微调，Home 键恢复默认位置。',
    dragTooltip: '拖动调整位置',
    triggerAriaLabel: '打开当前项目的 Open Issue 和 MR 列表',
    triggerAriaLabelProject: '打开 $1 项目的 Open Issue 和 MR 列表',
  });

  // Manual language override, persisted as chrome.storage.sync.language.
  // null means "follow the browser UI language" (default).
  let languageOverride = null;

  function getUILanguage() {
    return root?.chrome?.i18n?.getUILanguage?.() || 'en';
  }

  function setLanguage(locale) {
    languageOverride = locale === 'zh_CN' || locale === 'en' ? locale : null;
    return languageOverride;
  }

  function getLanguage() {
    if (languageOverride) return languageOverride;
    const ui = getUILanguage();
    return /^zh/i.test(ui) ? 'zh_CN' : 'en';
  }

  function getMessage(key, substitutions) {
    // 1. Manual language override: serve the zh_CN mirror or the embedded
    //    English messages directly. When the override is "en" we must NOT fall
    //    through to chrome.i18n (it always follows the browser UI language and
    //    would return Chinese on a zh browser), so resolve it explicitly.
    if (languageOverride === 'zh_CN') {
      const zh = ZH_MESSAGES[key];
      if (zh !== undefined) return interpolate(zh, substitutions);
    } else if (languageOverride === 'en') {
      const en = MESSAGES[key];
      if (en !== undefined) return interpolate(en, substitutions);
    }
    // 2. chrome.i18n follows the browser UI language (default).
    const i18n = root?.chrome?.i18n;
    if (typeof i18n?.getMessage === 'function') {
      const localized = i18n.getMessage(key, substitutions);
      if (localized) return localized;
    }
    // 3. English fallback.
    const fallback = MESSAGES[key];
    if (fallback === undefined) return key;
    return interpolate(fallback, substitutions);
  }

  return { MESSAGES, ZH_MESSAGES, getMessage, getUILanguage, setLanguage, getLanguage, interpolate };
});
