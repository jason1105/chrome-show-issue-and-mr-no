(function initializeGitLabReferenceBadge(root) {
  'use strict';

  const HOST_ID = 'gitlab-reference-badge-host';
  const PANEL_ID = 'gitlab-open-items-panel';
  const FEEDBACK_DURATION_MS = 1500;
  const CACHE_DURATION_MS = 60000;
  const HOVER_OPEN_DELAY_MS = 150;
  const HOVER_CLOSE_DELAY_MS = 250;
  const COPY_ICON_PATHS = [
    'M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z',
    'M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z',
  ];
  const SUCCESS_ICON_PATHS = [
    'M13.78 4.22a.75.75 0 0 1 0 1.06l-6.25 6.25a.75.75 0 0 1-1.06 0L3.22 8.28a.75.75 0 0 1 1.06-1.06L7 9.94l5.72-5.72a.75.75 0 0 1 1.06 0Z',
  ];
  const NAVIGATION_EVENTS = [
    'popstate',
    'hashchange',
    'turbo:load',
    'turbolinks:load',
    'gl:page:load',
  ];
  const parseGitLabReference = root.GitLabReferenceParser?.parseGitLabReference;

  if (typeof parseGitLabReference !== 'function') {
    return;
  }

  let lastUrl = root.location.href;
  let frameId = null;
  let feedbackTimerId = null;
  let navigationOpenTimerId = null;
  let navigationCloseTimerId = null;
  let copyGeneration = 0;
  let observer = null;
  let destroyed = false;
  let suppressNextFocusOpen = false;
  let suppressTouchFocusOpen = false;
  const navigation = {
    reference: null,
    projectKey: null,
    open: false,
    loading: false,
    issues: null,
    mergeRequests: null,
    errors: { issues: false, mergeRequests: false },
    message: '',
    cache: null,
    requestGeneration: 0,
    pending: null,
  };

  function formatReference(reference) {
    return reference.kind === 'issue'
      ? `Issue #${reference.iid}`
      : `MR !${reference.iid}`;
  }

  function formatCopyText(reference) {
    return reference.kind === 'issue'
      ? `#${reference.iid}`
      : `!${reference.iid}`;
  }

  function getProjectKey(reference) {
    return `${reference.origin}/${reference.projectPath}`;
  }

  function buildItemsApiUrl(reference, resource, page) {
    const encodedProject = encodeURIComponent(reference.projectPath);
    return `${reference.origin}/api/v4/projects/${encodedProject}/${resource}`
      + '?state=opened&scope=all&order_by=updated_at&sort=desc&per_page=100'
      + `&page=${page}`;
  }

  function buildFallbackWebUrl(reference, kind, iid) {
    const projectPath = reference.projectPath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const resource = kind === 'issue' ? 'issues' : 'merge_requests';
    return `${reference.origin}/${projectPath}/-/${resource}/${iid}`;
  }

  async function fetchAllItems(reference, kind) {
    const resource = kind === 'issue' ? 'issues' : 'merge_requests';
    const items = [];
    const visitedPages = new Set();
    let page = '1';

    while (page) {
      if (visitedPages.has(page)) throw new Error('Invalid GitLab pagination');
      visitedPages.add(page);

      const response = await root.fetch(buildItemsApiUrl(reference, resource, page), {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (!response?.ok) throw new Error(`GitLab API returned ${response?.status || 'an error'}`);

      const body = await response.json();
      if (!Array.isArray(body)) throw new Error('GitLab API response is not an array');

      for (const item of body) {
        const iid = String(item?.iid ?? '');
        if (!/^[1-9][0-9]*$/.test(iid)) throw new Error('GitLab API returned an invalid IID');
        items.push({
          kind,
          iid,
          title: typeof item.title === 'string' ? item.title : '',
          webUrl: typeof item.web_url === 'string' && item.web_url
            ? item.web_url
            : buildFallbackWebUrl(reference, kind, iid),
        });
      }

      const nextPage = response.headers?.get('X-Next-Page') || '';
      if (nextPage && !/^[1-9][0-9]*$/.test(nextPage)) {
        throw new Error('GitLab API returned an invalid next page');
      }
      page = nextPage;
    }

    return items;
  }

  function clearFeedbackTimer() {
    if (feedbackTimerId === null) return;
    root.clearTimeout(feedbackTimerId);
    feedbackTimerId = null;
  }

  function invalidateCopyOperations() {
    copyGeneration += 1;
    clearFeedbackTimer();
  }

  function clearNavigationOpenTimer() {
    if (navigationOpenTimerId === null) return;
    root.clearTimeout(navigationOpenTimerId);
    navigationOpenTimerId = null;
  }

  function clearNavigationCloseTimer() {
    if (navigationCloseTimerId === null) return;
    root.clearTimeout(navigationCloseTimerId);
    navigationCloseTimerId = null;
  }

  function clearNavigationTimers() {
    clearNavigationOpenTimer();
    clearNavigationCloseTimer();
  }

  function resetNavigation({ clearCache = true } = {}) {
    clearNavigationTimers();
    navigation.requestGeneration += 1;
    navigation.reference = null;
    navigation.projectKey = null;
    navigation.open = false;
    navigation.loading = false;
    navigation.issues = null;
    navigation.mergeRequests = null;
    navigation.errors = { issues: false, mergeRequests: false };
    navigation.message = '';
    navigation.pending = null;
    if (clearCache) navigation.cache = null;
  }

  function removeBadge() {
    invalidateCopyOperations();
    clearNavigationTimers();
    root.document.getElementById(HOST_ID)?.remove();
  }

  function setIcon(icon, name, pathDataList) {
    const namespace = 'http://www.w3.org/2000/svg';
    icon.setAttribute('data-copy-icon', name);

    while (icon.children.length > 0) {
      icon.children[0].remove();
    }
    for (const pathData of pathDataList) {
      const path = root.document.createElementNS(namespace, 'path');
      path.setAttribute('d', pathData);
      icon.append(path);
    }
  }

  function createIcon() {
    const namespace = 'http://www.w3.org/2000/svg';
    const icon = root.document.createElementNS(namespace, 'svg');
    icon.setAttribute('viewBox', '0 0 16 16');
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.setAttribute('fill', 'currentColor');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    setIcon(icon, 'copy', COPY_ICON_PATHS);
    return icon;
  }

  function getBadgeParts(host) {
    const shadow = host?.shadowRoot;
    return {
      badge: shadow?.querySelector('[data-reference-badge]'),
      trigger: shadow?.querySelector('[data-reference-trigger]'),
      label: shadow?.querySelector('[data-reference-label]'),
      button: shadow?.querySelector('[data-copy-reference]'),
      tooltip: shadow?.querySelector('[data-copy-tooltip]'),
      icon: shadow?.querySelector('[data-copy-icon]'),
      announcement: shadow?.querySelector('[data-copy-announcement]'),
      panel: shadow?.querySelector('[data-open-items-panel]'),
      refresh: shadow?.querySelector('[data-refresh-open-items]'),
    };
  }

  function setDefaultFeedback(host, copyText) {
    const { button, tooltip, icon, announcement } = getBadgeParts(host);
    if (!button) return;

    button.setAttribute('data-copy-state', 'default');
    tooltip.textContent = `复制 ${copyText}`;
    setIcon(icon, 'copy', COPY_ICON_PATHS);
    announcement.textContent = '';
  }

  function setFeedback(host, state, copyText, generation) {
    const { button, tooltip, icon, announcement } = getBadgeParts(host);
    if (!button) return;

    const succeeded = state === 'success';
    button.setAttribute('data-copy-state', state);
    tooltip.textContent = succeeded ? '已复制' : '复制失败';
    setIcon(icon, succeeded ? 'success' : 'copy', succeeded ? SUCCESS_ICON_PATHS : COPY_ICON_PATHS);
    announcement.textContent = succeeded ? '已复制' : '复制失败';

    clearFeedbackTimer();
    feedbackTimerId = root.setTimeout(() => {
      feedbackTimerId = null;
      if (
        destroyed
        || generation !== copyGeneration
        || host !== root.document.getElementById(HOST_ID)
      ) {
        return;
      }
      setDefaultFeedback(host, copyText);
    }, FEEDBACK_DURATION_MS);
  }

  function fallbackCopy(text) {
    const field = root.document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.setAttribute('aria-hidden', 'true');
    field.style.position = 'fixed';
    field.style.top = '-1000px';
    field.style.left = '-1000px';
    field.style.opacity = '0';
    root.document.documentElement.append(field);

    try {
      field.select();
      return root.document.execCommand('copy') === true;
    } catch {
      return false;
    } finally {
      field.remove();
    }
  }

  async function copyText(text, isCurrent) {
    try {
      if (typeof root.navigator?.clipboard?.writeText === 'function') {
        await root.navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      if (!isCurrent()) return false;
    }

    if (!isCurrent()) return false;
    return fallbackCopy(text);
  }

  async function handleCopy(event) {
    const button = event.currentTarget;
    const host = root.document.getElementById(HOST_ID);
    if (destroyed || !host) return;

    const text = button.getAttribute('data-copy-text');
    const generation = copyGeneration + 1;
    copyGeneration = generation;
    clearFeedbackTimer();
    setDefaultFeedback(host, text);

    const isCurrent = () => (
      !destroyed
      && generation === copyGeneration
      && host === root.document.getElementById(HOST_ID)
    );
    const copied = await copyText(text, isCurrent);
    if (!isCurrent()) return;
    setFeedback(host, copied ? 'success' : 'error', text, generation);
  }

  function createRefreshIcon() {
    const namespace = 'http://www.w3.org/2000/svg';
    const icon = root.document.createElementNS(namespace, 'svg');
    icon.setAttribute('viewBox', '0 0 16 16');
    icon.setAttribute('width', '14');
    icon.setAttribute('height', '14');
    icon.setAttribute('fill', 'currentColor');
    icon.setAttribute('aria-hidden', 'true');
    const path = root.document.createElementNS(namespace, 'path');
    path.setAttribute(
      'd',
      'M8 2.5a5.5 5.5 0 1 0 5.24 7.18.75.75 0 0 1 1.43.46A7 7 0 1 1 12.9 3.2V1.75a.75.75 0 0 1 1.5 0V5a.75.75 0 0 1-.75.75H10.4a.75.75 0 0 1 0-1.5h1.43A5.48 5.48 0 0 0 8 2.5Z',
    );
    icon.append(path);
    return icon;
  }

  function createOpenItemRow(item) {
    const reference = navigation.reference;
    const current = reference
      && item.kind === reference.kind
      && item.iid === reference.iid;
    const row = root.document.createElement(current ? 'span' : 'a');
    row.setAttribute('data-open-item', '');
    row.setAttribute('data-kind', item.kind);
    row.setAttribute('data-iid', item.iid);

    if (current) {
      row.setAttribute('data-current-open-item', '');
      row.setAttribute('aria-current', 'page');
    } else {
      row.setAttribute('href', item.webUrl);
    }

    const iid = root.document.createElement('span');
    iid.setAttribute('data-open-item-iid', '');
    iid.textContent = item.kind === 'issue' ? `#${item.iid}` : `!${item.iid}`;

    const title = root.document.createElement('span');
    title.setAttribute('data-open-item-title', '');
    title.textContent = item.title;
    row.append(iid, title);

    if (current) {
      const marker = root.document.createElement('span');
      marker.setAttribute('data-current-marker', '');
      marker.textContent = '当前';
      row.append(marker);
    }
    return row;
  }

  function createOpenItemsGroup(name, items, failed) {
    const kind = name === 'issues' ? 'issue' : 'merge-request';
    const group = root.document.createElement('section');
    group.setAttribute('data-open-items-group', name);

    const heading = root.document.createElement('div');
    heading.setAttribute('data-open-items-group-heading', '');
    const headingLabel = root.document.createElement('span');
    headingLabel.textContent = name === 'issues' ? 'Issues' : 'Merge requests';
    const count = root.document.createElement('span');
    count.setAttribute('data-open-items-group-count', '');
    count.textContent = String(items?.length || 0);
    heading.append(headingLabel, count);
    group.append(heading);

    if (failed) {
      group.setAttribute('data-open-items-state', 'error');
      const status = root.document.createElement('div');
      status.setAttribute('data-open-items-status', '');
      status.textContent = '无法加载';
      group.append(status);
      return group;
    }

    if (items === null) {
      group.setAttribute('data-open-items-state', 'loading');
      const status = root.document.createElement('div');
      status.setAttribute('data-open-items-status', '');
      status.textContent = '正在加载';
      group.append(status);
      return group;
    }

    group.setAttribute('data-open-items-state', 'ready');
    if (items.length === 0) {
      const status = root.document.createElement('div');
      status.setAttribute('data-open-items-status', '');
      status.textContent = kind === 'issue' ? '暂无 Open Issue' : '暂无 Open MR';
      group.append(status);
      return group;
    }

    for (const item of items) group.append(createOpenItemRow(item));
    return group;
  }

  function renderNavigationPanel(host) {
    const { panel, trigger } = getBadgeParts(host);
    if (!panel || !trigger) return;

    panel.hidden = !navigation.open;
    trigger.setAttribute('aria-expanded', navigation.open ? 'true' : 'false');

    const header = root.document.createElement('div');
    header.setAttribute('data-open-items-header', '');
    const heading = root.document.createElement('div');
    heading.setAttribute('data-open-items-heading', '');
    const headingText = root.document.createElement('span');
    headingText.textContent = 'Open items';
    const total = root.document.createElement('span');
    total.setAttribute('data-open-items-total', '');
    total.textContent = String(
      (navigation.issues?.length || 0) + (navigation.mergeRequests?.length || 0),
    );
    heading.append(headingText, total);

    const refresh = root.document.createElement('button');
    refresh.setAttribute('type', 'button');
    refresh.setAttribute('data-refresh-open-items', '');
    refresh.setAttribute('aria-busy', navigation.loading ? 'true' : 'false');
    refresh.setAttribute('aria-label', '刷新 Open items 列表');
    refresh.append(createRefreshIcon());
    const refreshText = root.document.createElement('span');
    refreshText.textContent = '刷新列表';
    refresh.append(refreshText);
    refresh.addEventListener('click', handleRefresh);
    header.append(heading, refresh);

    const children = [header];
    if (navigation.message) {
      const message = root.document.createElement('div');
      message.setAttribute('data-open-items-message', '');
      message.setAttribute('role', 'status');
      message.textContent = navigation.message;
      children.push(message);
    }
    children.push(
      createOpenItemsGroup('issues', navigation.issues, navigation.errors.issues),
      createOpenItemsGroup(
        'merge-requests',
        navigation.mergeRequests,
        navigation.errors.mergeRequests,
      ),
    );
    panel.replaceChildren(...children);
  }

  function isCurrentNavigationRequest(generation, projectKey, host) {
    return !destroyed
      && generation === navigation.requestGeneration
      && projectKey === navigation.projectKey
      && host === root.document.getElementById(HOST_ID);
  }

  async function loadOpenItems({ force = false } = {}) {
    const reference = navigation.reference;
    const projectKey = navigation.projectKey;
    const host = root.document.getElementById(HOST_ID);
    if (!reference || !projectKey || !host) return;

    if (!force && navigation.cache?.key === projectKey) {
      navigation.issues = navigation.cache.issues;
      navigation.mergeRequests = navigation.cache.mergeRequests;
      if (root.Date.now() - navigation.cache.loadedAt < CACHE_DURATION_MS) {
        navigation.errors = { issues: false, mergeRequests: false };
        navigation.message = '';
        renderNavigationPanel(host);
        return;
      }
    }

    if (navigation.loading) return navigation.pending;

    const hasCompleteSnapshot = navigation.cache?.key === projectKey;
    const generation = navigation.requestGeneration + 1;
    navigation.requestGeneration = generation;
    navigation.loading = true;
    navigation.errors = { issues: false, mergeRequests: false };
    navigation.message = '';
    renderNavigationPanel(host);

    const pending = Promise.allSettled([
      fetchAllItems(reference, 'issue'),
      fetchAllItems(reference, 'merge-request'),
    ]).then((results) => {
      if (!isCurrentNavigationRequest(generation, projectKey, host)) return;

      const [issuesResult, mergeRequestsResult] = results;
      const complete = issuesResult.status === 'fulfilled'
        && mergeRequestsResult.status === 'fulfilled';

      if (complete) {
        navigation.issues = issuesResult.value;
        navigation.mergeRequests = mergeRequestsResult.value;
        navigation.errors = { issues: false, mergeRequests: false };
        navigation.cache = {
          key: projectKey,
          loadedAt: root.Date.now(),
          issues: issuesResult.value,
          mergeRequests: mergeRequestsResult.value,
        };
      } else if (hasCompleteSnapshot) {
        navigation.issues = navigation.cache.issues;
        navigation.mergeRequests = navigation.cache.mergeRequests;
        navigation.message = '刷新失败，显示上次结果';
      } else {
        navigation.issues = issuesResult.status === 'fulfilled' ? issuesResult.value : null;
        navigation.mergeRequests = mergeRequestsResult.status === 'fulfilled'
          ? mergeRequestsResult.value
          : null;
        navigation.errors = {
          issues: issuesResult.status === 'rejected',
          mergeRequests: mergeRequestsResult.status === 'rejected',
        };
      }
      navigation.loading = false;
      navigation.pending = null;
      renderNavigationPanel(host);
    });
    navigation.pending = pending;
    return pending;
  }

  function openNavigation() {
    clearNavigationTimers();
    if (destroyed || !navigation.reference) return;
    navigation.open = true;
    const host = root.document.getElementById(HOST_ID);
    if (!host) return;
    renderNavigationPanel(host);
    loadOpenItems();
  }

  function closeNavigation({ restoreFocus = false } = {}) {
    clearNavigationTimers();
    navigation.open = false;
    const host = root.document.getElementById(HOST_ID);
    if (!host) return;
    renderNavigationPanel(host);
    if (restoreFocus) {
      const { trigger } = getBadgeParts(host);
      suppressNextFocusOpen = true;
      trigger?.focus();
    }
  }

  function scheduleNavigationOpen() {
    clearNavigationCloseTimer();
    if (navigation.open || navigationOpenTimerId !== null) return;
    navigationOpenTimerId = root.setTimeout(() => {
      navigationOpenTimerId = null;
      openNavigation();
    }, HOVER_OPEN_DELAY_MS);
  }

  function scheduleNavigationClose() {
    clearNavigationOpenTimer();
    clearNavigationCloseTimer();
    if (!navigation.open) return;
    navigationCloseTimerId = root.setTimeout(() => {
      navigationCloseTimerId = null;
      closeNavigation();
    }, HOVER_CLOSE_DELAY_MS);
  }

  function handleNavigationEnter() {
    clearNavigationCloseTimer();
  }

  function handleNavigationPointerDown(event) {
    suppressTouchFocusOpen = event.pointerType === 'touch';
  }

  function handleNavigationPointerCancel() {
    suppressTouchFocusOpen = false;
  }

  function handleNavigationClick(event) {
    if (event.pointerType === 'touch') {
      suppressTouchFocusOpen = false;
      navigation.open ? closeNavigation() : openNavigation();
      return;
    }
    if (!navigation.open) openNavigation();
  }

  function handleNavigationFocusOut(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) closeNavigation();
  }

  function handleDocumentPointerDown(event) {
    const host = root.document.getElementById(HOST_ID);
    if (!navigation.open || !host) return;
    if (event.target === host || host.contains(event.target)) return;
    closeNavigation();
  }

  function handleNavigationFocus() {
    if (suppressTouchFocusOpen) {
      suppressTouchFocusOpen = false;
      return;
    }
    if (suppressNextFocusOpen) {
      suppressNextFocusOpen = false;
      return;
    }
    openNavigation();
  }

  function handleNavigationKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeNavigation({ restoreFocus: true });
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && !navigation.open) {
      event.preventDefault();
      openNavigation();
    }
  }

  function handleRefresh(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setAttribute('aria-busy', 'true');
    if (!navigation.loading) loadOpenItems({ force: true });
  }

  function createBadgeHost() {
    const host = root.document.createElement('div');
    host.id = HOST_ID;

    const shadow = host.attachShadow({ mode: 'open' });
    const style = root.document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        position: fixed !important;
        top: 8px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        display: block !important;
        width: max-content !important;
        max-width: calc(100vw - 24px) !important;
      }

      [data-reference-badge] {
        box-sizing: border-box;
        display: inline-flex;
        align-items: stretch;
        max-width: 100%;
        overflow: visible;
        border: 1px solid rgba(31, 41, 55, 0.28);
        border-radius: 6px;
        background: #ffffff;
        box-shadow: 0 2px 8px rgba(17, 24, 39, 0.2);
        color: #1f2937;
        font: 600 13px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        white-space: nowrap;
      }

      [data-reference-trigger] {
        box-sizing: border-box;
        display: block;
        min-width: 0;
        margin: 0;
        padding: 0;
        overflow: hidden;
        border: 0;
        border-radius: 5px 0 0 5px;
        background: transparent;
        color: currentColor;
        font: inherit;
        text-align: left;
        cursor: default;
        pointer-events: auto;
        appearance: none;
      }

      [data-reference-trigger]:hover {
        background: rgba(31, 41, 55, 0.08);
      }

      [data-reference-trigger]:focus-visible {
        outline: 2px solid #0969da;
        outline-offset: -2px;
      }

      [data-reference-label] {
        box-sizing: border-box;
        display: block;
        min-width: 0;
        max-width: calc(100vw - 64px);
        overflow: hidden;
        padding: 5px 10px;
        text-overflow: ellipsis;
        pointer-events: none;
      }

      [data-open-items-panel] {
        box-sizing: border-box;
        position: absolute;
        top: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        width: min(380px, calc(100vw - 24px));
        max-height: min(560px, calc(100vh - 58px));
        overflow: auto;
        border: 1px solid rgba(31, 41, 55, 0.24);
        border-radius: 7px;
        background: #ffffff;
        box-shadow: 0 8px 24px rgba(17, 24, 39, 0.22);
        color: #1f2937;
        font: 400 13px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        white-space: normal;
        pointer-events: auto;
      }

      [data-open-items-panel][hidden] {
        display: none !important;
      }

      [data-open-items-header] {
        box-sizing: border-box;
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 42px;
        padding: 7px 8px 7px 12px;
        border-bottom: 1px solid rgba(31, 41, 55, 0.14);
        background: inherit;
      }

      [data-open-items-heading],
      [data-open-items-group-heading] {
        display: flex;
        align-items: center;
        gap: 7px;
        font-weight: 600;
      }

      [data-open-items-total],
      [data-open-items-group-count] {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 9px;
        background: rgba(31, 41, 55, 0.1);
        font-size: 11px;
        line-height: 18px;
      }

      [data-refresh-open-items] {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-height: 28px;
        margin: 0;
        padding: 4px 7px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: #57606a;
        font: 500 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        pointer-events: auto;
        appearance: none;
      }

      [data-refresh-open-items]:hover {
        background: rgba(31, 41, 55, 0.08);
        color: #24292f;
      }

      [data-refresh-open-items]:focus-visible,
      [data-open-item]:focus-visible {
        outline: 2px solid #0969da;
        outline-offset: -2px;
      }

      [data-refresh-open-items][aria-busy="true"] svg {
        animation: gitlab-reference-spin 800ms linear infinite;
      }

      @keyframes gitlab-reference-spin {
        to { transform: rotate(360deg); }
      }

      [data-open-items-message] {
        margin: 8px 10px 2px;
        padding: 7px 9px;
        border: 1px solid #d4a72c;
        border-radius: 5px;
        background: #fff8c5;
        color: #633c01;
        font-size: 12px;
      }

      [data-open-items-group] {
        display: block;
        padding: 7px 0;
      }

      [data-open-items-group] + [data-open-items-group] {
        border-top: 1px solid rgba(31, 41, 55, 0.12);
      }

      [data-open-items-group-heading] {
        padding: 3px 12px 6px;
        color: #57606a;
        font-size: 12px;
      }

      [data-open-items-status] {
        padding: 9px 12px 10px;
        color: #6e7781;
        font-size: 12px;
      }

      [data-open-item] {
        box-sizing: border-box;
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        padding: 6px 12px;
        border-left: 3px solid transparent;
        color: inherit;
        line-height: 20px;
        text-decoration: none;
        pointer-events: auto;
      }

      a[data-open-item]:hover {
        background: rgba(31, 41, 55, 0.06);
      }

      [data-open-item-iid] {
        font-weight: 600;
        color: #137333;
      }

      [data-open-item][data-kind="merge-request"] [data-open-item-iid] {
        color: #7d4e9e;
      }

      [data-open-item-title] {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      [data-current-open-item] {
        border-left-color: #0969da;
        background: #ddf4ff;
        color: #24292f;
      }

      [data-current-marker] {
        padding: 1px 6px;
        border-radius: 9px;
        background: rgba(9, 105, 218, 0.12);
        color: #0969da;
        font-size: 11px;
        line-height: 16px;
      }

      [data-copy-reference] {
        box-sizing: border-box;
        position: relative;
        display: inline-flex;
        flex: 0 0 31px;
        align-items: center;
        justify-content: center;
        width: 31px;
        min-width: 31px;
        margin: 0;
        padding: 0;
        border: 0;
        border-left: 1px solid rgba(31, 41, 55, 0.2);
        border-radius: 0 5px 5px 0;
        background: transparent;
        color: currentColor;
        font: inherit;
        cursor: pointer;
        pointer-events: auto;
        appearance: none;
      }

      [data-copy-reference]:hover {
        background: rgba(31, 41, 55, 0.08);
      }

      [data-copy-reference]:focus-visible {
        outline: 2px solid #0969da;
        outline-offset: -2px;
      }

      [data-copy-reference][data-copy-state="success"] {
        color: #1f883d;
      }

      [data-copy-icon] {
        display: block;
        flex: none;
      }

      [data-copy-tooltip] {
        box-sizing: border-box;
        position: absolute;
        top: calc(100% + 7px);
        right: -5px;
        z-index: 1;
        width: max-content;
        max-width: min(220px, calc(100vw - 24px));
        padding: 5px 8px;
        border-radius: 6px;
        background: #24292f;
        box-shadow: 0 2px 8px rgba(17, 24, 39, 0.25);
        color: #ffffff;
        font: 500 12px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        white-space: nowrap;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-2px);
        transition: opacity 80ms ease, transform 80ms ease, visibility 80ms ease;
        pointer-events: none;
      }

      [data-copy-reference]:hover [data-copy-tooltip],
      [data-copy-reference]:focus-visible [data-copy-tooltip] {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      [data-copy-announcement] {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      [data-kind="merge-request"] {
        border-color: rgba(31, 111, 235, 0.42);
        color: #0b5cad;
      }

      @media (prefers-color-scheme: dark) {
        [data-reference-badge] {
          border-color: rgba(255, 255, 255, 0.25);
          background: #24272d;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
          color: #f0f2f5;
        }

        [data-copy-reference] {
          border-left-color: rgba(255, 255, 255, 0.2);
        }

        [data-reference-trigger]:hover,
        [data-copy-reference]:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        [data-open-items-panel] {
          border-color: rgba(255, 255, 255, 0.2);
          background: #24272d;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
          color: #f0f2f5;
        }

        [data-open-items-header],
        [data-open-items-group] + [data-open-items-group] {
          border-color: rgba(255, 255, 255, 0.14);
        }

        [data-open-items-total],
        [data-open-items-group-count] {
          background: rgba(255, 255, 255, 0.12);
        }

        [data-refresh-open-items],
        [data-open-items-group-heading],
        [data-open-items-status] {
          color: #b7bdc8;
        }

        [data-refresh-open-items]:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
        }

        [data-open-items-message] {
          border-color: #9e6a03;
          background: #4d2d00;
          color: #ffd18a;
        }

        a[data-open-item]:hover {
          background: rgba(255, 255, 255, 0.08);
        }

        [data-open-item-iid] {
          color: #56d364;
        }

        [data-open-item][data-kind="merge-request"] [data-open-item-iid] {
          color: #d2a8ff;
        }

        [data-current-open-item] {
          background: rgba(9, 105, 218, 0.24);
          color: #ffffff;
        }

        [data-kind="merge-request"] {
          border-color: rgba(117, 170, 255, 0.55);
          color: #9ac1ff;
        }
      }
    `;

    const badge = root.document.createElement('div');
    badge.setAttribute('data-reference-badge', '');

    const trigger = root.document.createElement('button');
    trigger.setAttribute('type', 'button');
    trigger.setAttribute('data-reference-trigger', '');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', PANEL_ID);
    trigger.setAttribute('aria-label', '打开当前项目的 Open Issue 和 MR 列表');
    trigger.addEventListener('pointerdown', handleNavigationPointerDown);
    trigger.addEventListener('pointercancel', handleNavigationPointerCancel);
    trigger.addEventListener('mouseenter', scheduleNavigationOpen);
    trigger.addEventListener('mouseleave', scheduleNavigationClose);
    trigger.addEventListener('focus', handleNavigationFocus);
    trigger.addEventListener('keydown', handleNavigationKeydown);
    trigger.addEventListener('click', handleNavigationClick);

    const label = root.document.createElement('span');
    label.setAttribute('data-reference-label', '');
    trigger.append(label);

    const button = root.document.createElement('button');
    button.setAttribute('type', 'button');
    button.setAttribute('data-copy-reference', '');
    button.setAttribute('data-copy-state', 'default');
    button.addEventListener('mouseenter', handleNavigationEnter);
    button.addEventListener('mouseleave', scheduleNavigationClose);
    button.addEventListener('click', handleCopy);

    const icon = createIcon();

    const tooltip = root.document.createElement('span');
    tooltip.setAttribute('data-copy-tooltip', '');
    tooltip.setAttribute('role', 'tooltip');
    button.append(icon, tooltip);

    const announcement = root.document.createElement('span');
    announcement.setAttribute('data-copy-announcement', '');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');

    const panel = root.document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('data-open-items-panel', '');
    panel.addEventListener('mouseenter', handleNavigationEnter);
    panel.addEventListener('mouseleave', scheduleNavigationClose);
    panel.addEventListener('keydown', handleNavigationKeydown);
    panel.hidden = true;

    badge.append(trigger, button);
    shadow.append(style, badge, panel, announcement);
    shadow.addEventListener('focusout', handleNavigationFocusOut);
    root.document.documentElement.append(host);
    root.document.addEventListener('pointerdown', handleDocumentPointerDown);
    return host;
  }

  function sync() {
    if (destroyed) return;

    invalidateCopyOperations();
    lastUrl = root.location.href;
    const reference = parseGitLabReference(lastUrl);
    if (!reference) {
      resetNavigation();
      removeBadge();
      return;
    }

    const projectKey = getProjectKey(reference);
    const projectChanged = navigation.projectKey !== projectKey;
    if (projectChanged) {
      resetNavigation();
      navigation.projectKey = projectKey;
    }
    navigation.reference = reference;

    const host = root.document.getElementById(HOST_ID) || createBadgeHost();
    const { badge, trigger, label, button } = getBadgeParts(host);
    const copyText = formatCopyText(reference);
    label.textContent = formatReference(reference);
    badge.setAttribute('data-kind', reference.kind);
    trigger.setAttribute(
      'aria-label',
      `打开 ${reference.projectPath} 项目的 Open Issue 和 MR 列表`,
    );
    button.setAttribute('aria-label', `复制 ${copyText}`);
    button.setAttribute('data-copy-text', copyText);
    setDefaultFeedback(host, copyText);
    renderNavigationPanel(host);
  }

  function scheduleSync() {
    if (destroyed || frameId !== null) return;

    frameId = root.requestAnimationFrame(() => {
      frameId = null;
      sync();
    });
  }

  function handleMutation() {
    if (root.location.href !== lastUrl) {
      scheduleSync();
    }
  }

  function startObserver() {
    if (observer || !root.document.documentElement) return;

    observer = new root.MutationObserver(handleMutation);
    observer.observe(root.document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    invalidateCopyOperations();
    resetNavigation();

    if (frameId !== null) {
      root.cancelAnimationFrame(frameId);
      frameId = null;
    }
    observer?.disconnect();
    observer = null;
    for (const eventName of NAVIGATION_EVENTS) {
      const target = eventName === 'popstate' || eventName === 'hashchange'
        ? root
        : root.document;
      target.removeEventListener(eventName, scheduleSync);
    }
    root.document.removeEventListener('DOMContentLoaded', handleDocumentReady);
    root.document.removeEventListener('pointerdown', handleDocumentPointerDown);
    removeBadge();
  }

  function handleDocumentReady() {
    sync();
    startObserver();
  }

  for (const eventName of NAVIGATION_EVENTS) {
    const target = eventName === 'popstate' || eventName === 'hashchange'
      ? root
      : root.document;
    target.addEventListener(eventName, scheduleSync);
  }

  root.GitLabReferenceBadge = { sync, destroy };

  if (root.document.documentElement) {
    handleDocumentReady();
  } else {
    root.document.addEventListener('DOMContentLoaded', handleDocumentReady, { once: true });
  }
})(globalThis);
