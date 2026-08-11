(function initializeGitLabReferenceBadge(root) {
  'use strict';

  const HOST_ID = 'gitlab-reference-badge-host';
  const PANEL_ID = 'gitlab-open-items-panel';
  const FEEDBACK_DURATION_MS = 1500;
  const HOVER_OPEN_DELAY_MS = 150;
  const HOVER_CLOSE_DELAY_MS = 250;
  const POSITION_SAVE_DELAY_MS = 200;
  const VIEWPORT_MARGIN = 8;
  const PANEL_GAP = 6;
  const DRAG_THRESHOLD = 4;
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
  const configApi = root.GitLabReferenceConfig;
  const DEFAULT_POSITION = configApi?.DEFAULT_POSITION || { edge: 'top', ratio: 0.5 };
  const initialOrigin = (() => {
    try {
      return new root.URL(root.location.href).origin;
    } catch {
      return '';
    }
  })();
  const defaultConfig = configApi?.getEffectiveConfig
    ? configApi.getEffectiveConfig(configApi.getDefaultConfig(), initialOrigin)
    : {
      listFilter: 'all',
      rememberSearch: true,
      cacheTtlSeconds: 60,
      maxItemsPerType: 100,
      loadingMode: 'parallel',
      showLastRefresh: true,
      touchDrag: true,
      keyboardStep: 8,
      position: { ...DEFAULT_POSITION },
      searchState: { query: '', listFilter: null },
    };

  if (
    typeof parseGitLabReference !== 'function'
    || typeof configApi?.createConfigStore !== 'function'
  ) {
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
  let renderingNavigationPanel = false;
  let suppressNextFocusOpen = false;
  let suppressTouchFocusOpen = false;
  let position = { ...DEFAULT_POSITION };
  let positionLoaded = false;
  let positionGeneration = 0;
  let positionFrameId = null;
  let positionSaveTimerId = null;
  let pendingPositionSave = null;
  let persistedPosition = { ...DEFAULT_POSITION };
  let drag = null;
  let activeConfig = {
    ...defaultConfig,
    position: { ...defaultConfig.position },
    searchState: { ...defaultConfig.searchState },
  };
  const configStore = configApi.createConfigStore(root.chrome?.storage?.local, {
    storageChangeEvents: root.chrome?.storage?.onChanged,
    onConfigChanged() {
      updateConfig(getCurrentOrigin(), { force: true });
    },
  });
  let configOrigin = initialOrigin;
  let configurationReady = Promise.resolve();
  let configurationGeneration = 0;
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
    lastLoadedAt: null,
    requestGeneration: 0,
    pending: null,
    query: defaultConfig.searchState?.query || '',
    listFilter: defaultConfig.searchState?.listFilter || defaultConfig.listFilter || 'all',
    searchOwned: false,
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

  function getCurrentOrigin() {
    try {
      return new root.URL(root.location.href).origin;
    } catch {
      return '';
    }
  }

  function getVisibleKinds() {
    if (navigation.listFilter === 'issue') return ['issue'];
    if (navigation.listFilter === 'merge-request') return ['merge-request'];
    return ['issue', 'merge-request'];
  }

  function isCurrentCache() {
    return navigation.cache?.key === navigation.projectKey
      && navigation.cache?.maxItemsPerType === activeConfig.maxItemsPerType;
  }

  function itemMatchesQuery(item, query) {
    const normalized = query.trim();
    if (!normalized) return true;

    const issueReference = normalized.match(/^#([1-9][0-9]*)$/);
    if (issueReference) return item.kind === 'issue' && item.iid === issueReference[1];

    const mergeRequestReference = normalized.match(/^!([1-9][0-9]*)$/);
    if (mergeRequestReference) {
      return item.kind === 'merge-request' && item.iid === mergeRequestReference[1];
    }

    if (/^[1-9][0-9]*$/.test(normalized)) return item.iid === normalized;
    return item.title.toLocaleLowerCase().includes(normalized.toLocaleLowerCase());
  }

  function filterOpenItems(items) {
    return Array.isArray(items)
      ? items.filter((item) => itemMatchesQuery(item, navigation.query))
      : items;
  }

  function persistSearchState() {
    if (!activeConfig.rememberSearch) return;
    Promise.resolve(configStore.setSearchState({
      query: navigation.query,
      listFilter: navigation.listFilter,
    }, getCurrentOrigin())).catch(() => {
      // Search remains usable in this content-script session when persistence fails.
    });
  }

  function buildItemsApiUrl(reference, resource, page, perPage) {
    const encodedProject = encodeURIComponent(reference.projectPath);
    return `${reference.origin}/api/v4/projects/${encodedProject}/${resource}`
      + `?state=opened&scope=all&order_by=updated_at&sort=desc&per_page=${perPage}`
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
    const limit = Math.min(
      activeConfig.maxItemsPerType,
      activeConfig.protected?.maxItemsPerType || 100,
    );
    const perPage = Math.min(limit, activeConfig.protected?.maxItemsPerPage || 100);
    const items = [];
    const visitedPages = new Set();
    let page = '1';

    while (page) {
      if (visitedPages.has(page)) throw new Error('Invalid GitLab pagination');
      visitedPages.add(page);

      const response = await root.fetch(buildItemsApiUrl(reference, resource, page, perPage), {
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
        if (items.length >= limit) break;
      }

      if (items.length >= limit) break;

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
    navigation.lastLoadedAt = null;
    if (clearCache) navigation.cache = null;
  }

  function removeBadge() {
    cancelDrag();
    invalidateCopyOperations();
    clearNavigationTimers();
    root.document.getElementById(HOST_ID)?.remove();
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function getHostSize(host) {
    const rect = host.getBoundingClientRect();
    return {
      width: Math.min(rect.width, Math.max(0, root.innerWidth - (VIEWPORT_MARGIN * 2))),
      height: Math.min(rect.height, Math.max(0, root.innerHeight - (VIEWPORT_MARGIN * 2))),
    };
  }

  function getPositionPixels(host, snappedPosition) {
    const { width, height } = getHostSize(host);
    const horizontalRange = Math.max(0, root.innerWidth - (VIEWPORT_MARGIN * 2) - width);
    const verticalRange = Math.max(0, root.innerHeight - (VIEWPORT_MARGIN * 2) - height);
    let left = VIEWPORT_MARGIN;
    let top = VIEWPORT_MARGIN;

    if (snappedPosition.edge === 'top') {
      left += horizontalRange * snappedPosition.ratio;
    } else {
      top += verticalRange * snappedPosition.ratio;
      if (snappedPosition.edge === 'right') left += horizontalRange;
    }
    return { left, top, width, height };
  }

  function setPanelPlacement(host, rect, preferredEdge) {
    const panelWidth = Math.min(380, Math.max(0, root.innerWidth - (VIEWPORT_MARGIN * 2)));
    const fullPanelHeight = Math.min(560, Math.max(0, root.innerHeight - (VIEWPORT_MARGIN * 2)));
    const spaceAbove = rect.top - VIEWPORT_MARGIN - PANEL_GAP;
    const spaceBelow = root.innerHeight - VIEWPORT_MARGIN - rect.top - rect.height - PANEL_GAP;
    const spaceLeft = rect.left - VIEWPORT_MARGIN - PANEL_GAP;
    const spaceRight = root.innerWidth
      - VIEWPORT_MARGIN
      - rect.left
      - rect.width
      - PANEL_GAP;
    let placement;

    if (preferredEdge === 'top') {
      placement = 'down';
    } else if (spaceBelow < 240 && spaceAbove > spaceBelow) {
      placement = 'up';
    } else if (spaceAbove < 120 && spaceBelow >= spaceAbove) {
      placement = 'down';
    } else if (preferredEdge === 'left' && spaceRight >= panelWidth) {
      placement = 'right';
    } else if (preferredEdge === 'right' && spaceLeft >= panelWidth) {
      placement = 'left';
    } else {
      placement = spaceBelow >= spaceAbove ? 'down' : 'up';
    }

    host.setAttribute('data-panel-placement', placement);
    if (placement === 'down' || placement === 'up') {
      const centeredOffset = (rect.width - panelWidth) / 2;
      const minimumOffset = VIEWPORT_MARGIN - rect.left;
      const maximumOffset = root.innerWidth
        - VIEWPORT_MARGIN
        - panelWidth
        - rect.left;
      host.style.setProperty(
        '--panel-left',
        `${clamp(centeredOffset, minimumOffset, maximumOffset)}px`,
      );
      host.style.setProperty(
        '--panel-max-height',
        `${Math.max(0, placement === 'down' ? spaceBelow : spaceAbove)}px`,
      );
      return;
    }

    const centeredOffset = (rect.height - fullPanelHeight) / 2;
    const minimumOffset = VIEWPORT_MARGIN - rect.top;
    const maximumOffset = root.innerHeight
      - VIEWPORT_MARGIN
      - fullPanelHeight
      - rect.top;
    host.style.setProperty(
      '--panel-top',
      `${clamp(centeredOffset, minimumOffset, maximumOffset)}px`,
    );
    host.style.setProperty('--panel-max-height', `${fullPanelHeight}px`);
  }

  function setHostPixels(host, left, top, preferredEdge = position.edge) {
    const { width, height } = getHostSize(host);
    const constrainedLeft = clamp(
      left,
      VIEWPORT_MARGIN,
      Math.max(VIEWPORT_MARGIN, root.innerWidth - VIEWPORT_MARGIN - width),
    );
    const constrainedTop = clamp(
      top,
      VIEWPORT_MARGIN,
      Math.max(VIEWPORT_MARGIN, root.innerHeight - VIEWPORT_MARGIN - height),
    );
    host.style.setProperty('--reference-left', `${constrainedLeft}px`);
    host.style.setProperty('--reference-top', `${constrainedTop}px`);
    host.style.setProperty('--reference-transform', 'none');
    setPanelPlacement(
      host,
      { left: constrainedLeft, top: constrainedTop, width, height },
      preferredEdge,
    );
    return { left: constrainedLeft, top: constrainedTop, width, height };
  }

  function applyPosition(host = root.document.getElementById(HOST_ID)) {
    if (!host) return;
    const rect = getPositionPixels(host, position);
    host.setAttribute('data-edge', position.edge);
    setHostPixels(host, rect.left, rect.top, position.edge);
  }

  function positionsEqual(first, second) {
    return first?.edge === second?.edge && first?.ratio === second?.ratio;
  }

  function savePosition(nextPosition = position, generation = positionGeneration) {
    const snapshot = configApi.normalizePosition(nextPosition);
    const priorPosition = { ...persistedPosition };
    Promise.resolve(configStore.setPosition(snapshot, configOrigin))
      .then(() => {
        persistedPosition = { ...snapshot };
      })
      .catch(() => {
        if (
          destroyed
          || generation !== positionGeneration
          || !positionsEqual(position, snapshot)
        ) return;
        positionGeneration += 1;
        position = { ...priorPosition };
        applyPosition();
      });
  }

  function cancelScheduledPositionSave() {
    if (positionSaveTimerId !== null) {
      root.clearTimeout(positionSaveTimerId);
      positionSaveTimerId = null;
    }
    pendingPositionSave = null;
  }

  function flushScheduledPositionSave() {
    if (positionSaveTimerId !== null) {
      root.clearTimeout(positionSaveTimerId);
      positionSaveTimerId = null;
    }
    const pending = pendingPositionSave;
    pendingPositionSave = null;
    if (pending) savePosition(pending.position, pending.generation);
  }

  function schedulePositionSave() {
    pendingPositionSave = {
      position: { ...position },
      generation: positionGeneration,
    };
    if (positionSaveTimerId !== null) root.clearTimeout(positionSaveTimerId);
    positionSaveTimerId = root.setTimeout(() => {
      positionSaveTimerId = null;
      const pending = pendingPositionSave;
      pendingPositionSave = null;
      if (pending) savePosition(pending.position, pending.generation);
    }, POSITION_SAVE_DELAY_MS);
  }

  function clearStoredPosition() {
    cancelScheduledPositionSave();
    const generation = positionGeneration;
    const nextPosition = { ...DEFAULT_POSITION };
    const priorPosition = { ...persistedPosition };
    Promise.resolve(configStore.resetPosition(configOrigin))
      .then(() => {
        persistedPosition = nextPosition;
      })
      .catch(() => {
        if (
          destroyed
          || generation !== positionGeneration
          || !positionsEqual(position, nextPosition)
        ) return;
        positionGeneration += 1;
        position = priorPosition;
        applyPosition();
      });
  }

  function loadStoredPosition() {
    if (positionLoaded) return;
    positionLoaded = true;
    const generation = positionGeneration;
    Promise.resolve(configurationReady).then(() => {
      if (destroyed || generation !== positionGeneration) return;
      position = configApi.normalizePosition(activeConfig.position);
      persistedPosition = { ...position };
      applyPosition();
    }).catch(() => {});
  }

  function chooseNearestEdge(rect) {
    const distances = {
      top: rect.top - VIEWPORT_MARGIN,
      left: rect.left - VIEWPORT_MARGIN,
      right: root.innerWidth - VIEWPORT_MARGIN - rect.left - rect.width,
    };
    return Object.keys(distances).reduce(
      (nearest, edge) => (distances[edge] < distances[nearest] ? edge : nearest),
      'top',
    );
  }

  function snapDrag(host, rect) {
    const edge = chooseNearestEdge(rect);
    const range = edge === 'top'
      ? Math.max(0, root.innerWidth - (VIEWPORT_MARGIN * 2) - rect.width)
      : Math.max(0, root.innerHeight - (VIEWPORT_MARGIN * 2) - rect.height);
    const offset = edge === 'top'
      ? rect.left - VIEWPORT_MARGIN
      : rect.top - VIEWPORT_MARGIN;
    position = {
      edge,
      ratio: range === 0 ? 0.5 : clamp(offset / range, 0, 1),
    };
    applyPosition(host);
    savePosition();
  }

  function releaseDragPointer(activeDrag) {
    if (!activeDrag?.handle?.hasPointerCapture?.(activeDrag.pointerId)) return;
    try {
      activeDrag.handle.releasePointerCapture(activeDrag.pointerId);
    } catch {
      // The browser may have already released capture after pointer cancellation.
    }
  }

  function cancelDrag() {
    if (!drag) return;
    const activeDrag = drag;
    drag = null;
    releaseDragPointer(activeDrag);
    activeDrag.host.removeAttribute('data-dragging');
    if (activeDrag.active && activeDrag.host === root.document.getElementById(HOST_ID)) {
      position = { ...activeDrag.priorPosition };
      applyPosition(activeDrag.host);
    }
  }

  function handleDragPointerDown(event) {
    if (
      drag
      || event.button !== 0
      || event.isPrimary === false
      || (event.pointerType === 'touch' && !activeConfig.touchDrag)
    ) return;
    const host = root.document.getElementById(HOST_ID);
    if (!host) return;
    const rect = host.getBoundingClientRect();
    flushScheduledPositionSave();
    positionGeneration += 1;
    drag = {
      pointerId: event.pointerId,
      handle: event.currentTarget,
      host,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      priorPosition: { ...position },
      active: false,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  }

  function handleDragPointerMove(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.active && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;

    if (!drag.active) {
      drag.active = true;
      clearNavigationTimers();
      closeNavigation();
      drag.host.setAttribute('data-dragging', 'true');
    }
    drag.rect = setHostPixels(
      drag.host,
      drag.startLeft + deltaX,
      drag.startTop + deltaY,
      chooseNearestEdge(drag.rect),
    );
    event.preventDefault();
    event.stopPropagation();
  }

  function handleDragPointerUp(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const activeDrag = drag;
    drag = null;
    releaseDragPointer(activeDrag);
    activeDrag.host.removeAttribute('data-dragging');
    if (!activeDrag.active) return;
    event.preventDefault();
    event.stopPropagation();
    snapDrag(activeDrag.host, activeDrag.rect);
  }

  function handleDragPointerCancel(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    cancelDrag();
  }

  function handleDragDoubleClick(event) {
    event.preventDefault();
    event.stopPropagation();
    cancelDrag();
    positionGeneration += 1;
    position = { ...DEFAULT_POSITION };
    applyPosition();
    clearStoredPosition();
  }

  function handleDragClick(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleDragKeydown(event) {
    const horizontal = position.edge === 'top';
    const direction = horizontal
      ? (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)
      : (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0);
    if (!direction) return;

    event.preventDefault();
    event.stopPropagation();
    const host = root.document.getElementById(HOST_ID);
    if (!host) return;
    const { width, height } = getHostSize(host);
    const range = horizontal
      ? Math.max(0, root.innerWidth - (VIEWPORT_MARGIN * 2) - width)
      : Math.max(0, root.innerHeight - (VIEWPORT_MARGIN * 2) - height);
    if (range === 0) return;

    positionGeneration += 1;
    position = {
      ...position,
      ratio: clamp(
        position.ratio + (direction * activeConfig.keyboardStep) / range,
        0,
        1,
      ),
    };
    applyPosition(host);
    schedulePositionSave();
  }

  function handleResize() {
    if (destroyed || positionFrameId !== null) return;
    positionFrameId = root.requestAnimationFrame(() => {
      positionFrameId = null;
      if (drag?.active) {
        drag.rect = setHostPixels(
          drag.host,
          drag.rect.left,
          drag.rect.top,
          chooseNearestEdge(drag.rect),
        );
        return;
      }
      applyPosition();
    });
  }

  function createDragHandleIcon() {
    const namespace = 'http://www.w3.org/2000/svg';
    const icon = root.document.createElementNS(namespace, 'svg');
    icon.setAttribute('data-drag-handle-icon', '');
    icon.setAttribute('viewBox', '0 0 12 16');
    icon.setAttribute('width', '12');
    icon.setAttribute('height', '16');
    icon.setAttribute('fill', 'currentColor');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    for (const x of [4, 8]) {
      for (const y of [4, 8, 12]) {
        const dot = root.document.createElementNS(namespace, 'circle');
        dot.setAttribute('cx', String(x));
        dot.setAttribute('cy', String(y));
        dot.setAttribute('r', '1.25');
        icon.append(dot);
      }
    }
    return icon;
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
      handle: shadow?.querySelector('[data-drag-handle]'),
      handleTooltip: shadow?.querySelector('[data-drag-tooltip]'),
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

  function formatLastRefresh(timestamp) {
    if (!Number.isFinite(timestamp)) return '';
    try {
      return new root.Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '';
    }
  }

  function renderNavigationPanel(host) {
    const { panel, trigger } = getBadgeParts(host);
    if (!panel || !trigger) return;
    const activeElement = host.shadowRoot?.activeElement;
    const focusedControl = activeElement?.getAttribute?.('data-open-items-filter')
      || (activeElement?.matches?.('[data-refresh-open-items]') ? 'refresh' : null)
      || (activeElement?.matches?.('[data-open-items-search]') ? 'search' : null);
    const searchSelection = focusedControl === 'search'
      ? { start: activeElement.selectionStart, end: activeElement.selectionEnd }
      : null;
    const filteredIssues = filterOpenItems(navigation.issues);
    const filteredMergeRequests = filterOpenItems(navigation.mergeRequests);
    const visibleKinds = getVisibleKinds();
    const totalCount = (
      (visibleKinds.includes('issue') ? filteredIssues?.length || 0 : 0)
      + (visibleKinds.includes('merge-request') ? filteredMergeRequests?.length || 0 : 0)
    );
    const rawVisibleCount = (
      (visibleKinds.includes('issue') ? navigation.issues?.length || 0 : 0)
      + (visibleKinds.includes('merge-request') ? navigation.mergeRequests?.length || 0 : 0)
    );
    const visibleGroupsReady = visibleKinds.every((kind) => (
      kind === 'issue'
        ? filteredIssues !== null && !navigation.errors.issues
        : filteredMergeRequests !== null && !navigation.errors.mergeRequests
    ));

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
    total.textContent = String(totalCount);
    heading.append(headingText, total);

    if (activeConfig.showLastRefresh && Number.isFinite(navigation.lastLoadedAt)) {
      const lastRefresh = root.document.createElement('time');
      lastRefresh.setAttribute('data-last-refresh', '');
      lastRefresh.setAttribute('datetime', new root.Date(navigation.lastLoadedAt).toISOString());
      lastRefresh.textContent = `更新于 ${formatLastRefresh(navigation.lastLoadedAt)}`;
      heading.append(lastRefresh);
    }

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

    const searchControls = root.document.createElement('div');
    searchControls.setAttribute('data-open-items-controls', '');
    const search = root.document.createElement('input');
    search.setAttribute('type', 'search');
    search.setAttribute('data-open-items-search', '');
    search.setAttribute('aria-label', '搜索 Open items');
    search.setAttribute('placeholder', '搜索编号或标题');
    search.value = navigation.query;
    search.addEventListener('input', handleSearchInput);

    const filters = root.document.createElement('div');
    filters.setAttribute('data-open-items-filters', '');
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', '筛选 Open items 类型');
    for (const [kind, label] of [
      ['all', '全部'],
      ['issue', 'Issue'],
      ['merge-request', 'MR'],
    ]) {
      const filter = root.document.createElement('button');
      filter.setAttribute('type', 'button');
      filter.setAttribute('data-open-items-filter', kind);
      filter.setAttribute('aria-pressed', navigation.listFilter === kind ? 'true' : 'false');
      filter.textContent = label;
      filter.addEventListener('click', handleFilterClick);
      filters.append(filter);
    }
    searchControls.append(search, filters);

    const children = [header, searchControls];
    if (navigation.message) {
      const message = root.document.createElement('div');
      message.setAttribute('data-open-items-message', '');
      message.setAttribute('role', 'status');
      message.textContent = navigation.message;
      children.push(message);
    }
    if (visibleGroupsReady && totalCount === 0) {
      const empty = root.document.createElement('div');
      empty.setAttribute('data-open-items-empty', '');
      empty.setAttribute('role', 'status');
      empty.textContent = navigation.query.trim() === '' && rawVisibleCount === 0
        ? '暂无 Open items'
        : '没有匹配的 Open items';
      children.push(empty);
    } else {
      if (visibleKinds.includes('issue')) {
        children.push(createOpenItemsGroup(
          'issues',
          filteredIssues,
          navigation.errors.issues,
        ));
      }
      if (visibleKinds.includes('merge-request')) {
        children.push(createOpenItemsGroup(
          'merge-requests',
          filteredMergeRequests,
          navigation.errors.mergeRequests,
        ));
      }
    }
    renderingNavigationPanel = true;
    try {
      panel.replaceChildren(...children);
    } finally {
      renderingNavigationPanel = false;
    }
    if (!navigation.open || !focusedControl) return;
    const nextFocusedControl = focusedControl === 'refresh'
      ? refresh
      : focusedControl === 'search'
        ? search
        : filters.querySelector(`[data-open-items-filter="${focusedControl}"]`);
    nextFocusedControl?.focus();
    if (searchSelection) {
      search.setSelectionRange(searchSelection.start, searchSelection.end);
    }
  }

  function isCurrentNavigationRequest(generation, projectKey, host) {
    return !destroyed
      && generation === navigation.requestGeneration
      && projectKey === navigation.projectKey
      && host === root.document.getElementById(HOST_ID);
  }

  async function loadOpenItems({ force = false } = {}) {
    const requestedProjectKey = navigation.projectKey;
    await configurationReady;
    if (
      destroyed
      || requestedProjectKey !== navigation.projectKey
    ) return;
    const reference = navigation.reference;
    const projectKey = requestedProjectKey;
    const host = root.document.getElementById(HOST_ID);
    if (!reference || !projectKey || !host) return;

    if (!force && isCurrentCache()) {
      navigation.issues = navigation.cache.issues;
      navigation.mergeRequests = navigation.cache.mergeRequests;
      navigation.lastLoadedAt = navigation.cache.loadedAt;
      if (root.Date.now() - navigation.cache.loadedAt < activeConfig.cacheTtlSeconds * 1000) {
        navigation.errors = { issues: false, mergeRequests: false };
        navigation.message = '';
        renderNavigationPanel(host);
        return;
      }
    }

    if (navigation.loading) return navigation.pending;

    const hasCompleteSnapshot = isCurrentCache();
    const generation = navigation.requestGeneration + 1;
    navigation.requestGeneration = generation;
    navigation.loading = true;
    navigation.errors = { issues: false, mergeRequests: false };
    navigation.message = '';
    renderNavigationPanel(host);

    const kinds = ['issue', 'merge-request'];
    const fetchOne = (kind) => fetchAllItems(reference, kind)
      .then((value) => ({ status: 'fulfilled', value }))
      .catch((reason) => ({ status: 'rejected', reason }));
    const pending = (async () => {
      const results = [];
      if (activeConfig.loadingMode === 'sequential') {
        for (const kind of kinds) results.push(await fetchOne(kind));
      } else {
        results.push(...await Promise.all(kinds.map(fetchOne)));
      }
      if (!isCurrentNavigationRequest(generation, projectKey, host)) return;

      const issueResult = kinds.indexOf('issue') >= 0 ? results[kinds.indexOf('issue')] : null;
      const mergeRequestResult = kinds.indexOf('merge-request') >= 0
        ? results[kinds.indexOf('merge-request')]
        : null;
      const issueSucceeded = !issueResult || issueResult.status === 'fulfilled';
      const mergeRequestSucceeded = !mergeRequestResult || mergeRequestResult.status === 'fulfilled';
      const complete = issueSucceeded && mergeRequestSucceeded;

      if (complete) {
        navigation.issues = issueResult?.value || [];
        navigation.mergeRequests = mergeRequestResult?.value || [];
        navigation.errors = { issues: false, mergeRequests: false };
        navigation.cache = {
          key: projectKey,
          maxItemsPerType: activeConfig.maxItemsPerType,
          loadedAt: root.Date.now(),
          issues: navigation.issues,
          mergeRequests: navigation.mergeRequests,
        };
        navigation.lastLoadedAt = navigation.cache.loadedAt;
      } else if (hasCompleteSnapshot) {
        navigation.issues = navigation.cache.issues;
        navigation.mergeRequests = navigation.cache.mergeRequests;
        navigation.lastLoadedAt = navigation.cache.loadedAt;
        navigation.message = '刷新失败，显示上次结果';
      } else {
        navigation.issues = issueResult?.status === 'fulfilled' ? issueResult.value : null;
        navigation.mergeRequests = mergeRequestResult?.status === 'fulfilled'
          ? mergeRequestResult.value
          : null;
        navigation.errors = {
          issues: Boolean(issueResult?.status === 'rejected'),
          mergeRequests: Boolean(mergeRequestResult?.status === 'rejected'),
        };
      }
      navigation.loading = false;
      navigation.pending = null;
      renderNavigationPanel(host);
    })();
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
    if (renderingNavigationPanel) return;
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

  function handleSearchInput(event) {
    navigation.query = event.currentTarget.value;
    navigation.searchOwned = true;
    const host = root.document.getElementById(HOST_ID);
    if (host) renderNavigationPanel(host);
    persistSearchState();
  }

  function handleFilterClick(event) {
    const nextFilter = event.currentTarget.getAttribute('data-open-items-filter');
    if (!['all', 'issue', 'merge-request'].includes(nextFilter)) return;
    navigation.listFilter = nextFilter;
    navigation.searchOwned = true;
    const host = root.document.getElementById(HOST_ID);
    if (host) renderNavigationPanel(host);
    persistSearchState();
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
        top: var(--reference-top) !important;
        left: var(--reference-left) !important;
        transform: var(--reference-transform) !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        display: block !important;
        width: max-content !important;
        max-width: calc(100vw - 16px) !important;
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

      [data-drag-handle] {
        box-sizing: border-box;
        position: relative;
        display: inline-flex;
        flex: 0 0 26px;
        align-items: center;
        justify-content: center;
        width: 26px;
        min-width: 26px;
        margin: 0;
        padding: 0;
        border: 0;
        border-right: 1px solid rgba(31, 41, 55, 0.2);
        border-radius: 5px 0 0 5px;
        background: transparent;
        color: #6e7781;
        cursor: grab;
        pointer-events: auto;
        touch-action: none;
        appearance: none;
      }

      :host([data-touch-drag="false"]) [data-drag-handle] {
        touch-action: auto;
      }

      [data-drag-handle]:hover {
        background: rgba(31, 41, 55, 0.08);
        color: #24292f;
      }

      [data-drag-handle]:focus-visible {
        outline: 2px solid #0969da;
        outline-offset: -2px;
      }

      :host([data-dragging]) [data-drag-handle] {
        cursor: grabbing;
      }

      [data-drag-handle-icon] {
        display: block;
        flex: none;
      }

      [data-drag-tooltip] {
        box-sizing: border-box;
        position: absolute;
        top: calc(100% + 7px);
        left: -5px;
        z-index: 1;
        width: max-content;
        max-width: min(220px, calc(100vw - 16px));
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

      [data-drag-handle]:hover [data-drag-tooltip],
      [data-drag-handle]:focus-visible [data-drag-tooltip] {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      [data-reference-trigger] {
        box-sizing: border-box;
        display: block;
        min-width: 0;
        margin: 0;
        padding: 0;
        overflow: hidden;
        border: 0;
        border-radius: 0;
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
        width: min(380px, calc(100vw - 16px));
        max-height: var(--panel-max-height);
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

      :host([data-panel-placement="down"]) [data-open-items-panel] {
        top: calc(100% + 6px);
        left: var(--panel-left);
      }

      :host([data-panel-placement="up"]) [data-open-items-panel] {
        bottom: calc(100% + 6px);
        left: var(--panel-left);
      }

      :host([data-panel-placement="right"]) [data-open-items-panel] {
        top: var(--panel-top);
        left: calc(100% + 6px);
      }

      :host([data-panel-placement="left"]) [data-open-items-panel] {
        top: var(--panel-top);
        right: calc(100% + 6px);
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

      [data-open-items-heading] {
        flex-wrap: wrap;
      }

      [data-last-refresh] {
        flex-basis: 100%;
        color: #6e7781;
        font-size: 11px;
        font-weight: 400;
        line-height: 14px;
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

      [data-open-items-controls] {
        box-sizing: border-box;
        display: flex;
        align-items: stretch;
        gap: 7px;
        padding: 8px 10px;
        border-bottom: 1px solid rgba(31, 41, 55, 0.12);
        background: inherit;
      }

      [data-open-items-search] {
        box-sizing: border-box;
        flex: 1 1 auto;
        min-width: 0;
        height: 30px;
        margin: 0;
        padding: 5px 9px;
        border: 1px solid rgba(31, 41, 55, 0.28);
        border-radius: 6px;
        background: #ffffff;
        color: #24292f;
        font: 400 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        appearance: auto;
      }

      [data-open-items-search]::placeholder {
        color: #6e7781;
        opacity: 1;
      }

      [data-open-items-search]:focus {
        border-color: #0969da;
        box-shadow: 0 0 0 1px #0969da;
        outline: none;
      }

      [data-open-items-filters] {
        box-sizing: border-box;
        display: inline-flex;
        flex: 0 0 auto;
        overflow: hidden;
        border: 1px solid rgba(31, 41, 55, 0.24);
        border-radius: 6px;
      }

      [data-open-items-filter] {
        box-sizing: border-box;
        min-height: 28px;
        margin: 0;
        padding: 4px 8px;
        border: 0;
        border-left: 1px solid rgba(31, 41, 55, 0.18);
        border-radius: 0;
        background: #ffffff;
        color: #57606a;
        font: 500 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        appearance: none;
      }

      [data-open-items-filter]:first-child {
        border-left: 0;
      }

      [data-open-items-filter]:hover {
        background: rgba(31, 41, 55, 0.06);
        color: #24292f;
      }

      [data-open-items-filter][aria-pressed="true"] {
        background: #ddf4ff;
        color: #0969da;
      }

      [data-open-items-filter]:focus-visible {
        position: relative;
        z-index: 1;
        outline: 2px solid #0969da;
        outline-offset: -2px;
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

      [data-open-items-empty] {
        padding: 28px 16px 30px;
        color: #6e7781;
        font-size: 12px;
        text-align: center;
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

      [data-copy-reference][data-copy-state="success"],
      [data-copy-reference][data-copy-state="success"]:hover {
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

        [data-drag-handle] {
          border-right-color: rgba(255, 255, 255, 0.2);
          color: #8b949e;
        }

        [data-reference-trigger]:hover,
        [data-copy-reference]:hover,
        [data-drag-handle]:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #f0f2f5;
        }

        [data-open-items-panel] {
          border-color: rgba(255, 255, 255, 0.2);
          background: #24272d;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
          color: #f0f2f5;
        }

        [data-open-items-header],
        [data-open-items-controls],
        [data-open-items-group] + [data-open-items-group] {
          border-color: rgba(255, 255, 255, 0.14);
        }

        [data-open-items-total],
        [data-open-items-group-count] {
          background: rgba(255, 255, 255, 0.12);
        }

        [data-refresh-open-items],
        [data-open-items-group-heading],
        [data-open-items-status],
        [data-open-items-empty],
        [data-last-refresh] {
          color: #b7bdc8;
        }

        [data-open-items-search] {
          border-color: rgba(255, 255, 255, 0.26);
          background: #1f2227;
          color: #f0f2f5;
        }

        [data-open-items-search]::placeholder {
          color: #8b949e;
        }

        [data-open-items-filters] {
          border-color: rgba(255, 255, 255, 0.24);
        }

        [data-open-items-filter] {
          border-left-color: rgba(255, 255, 255, 0.16);
          background: #24272d;
          color: #b7bdc8;
        }

        [data-open-items-filter]:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #ffffff;
        }

        [data-open-items-filter][aria-pressed="true"] {
          background: rgba(9, 105, 218, 0.28);
          color: #79c0ff;
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

      @media (max-width: 420px) {
        [data-open-items-controls] {
          flex-wrap: wrap;
        }

        [data-open-items-search],
        [data-open-items-filters] {
          flex-basis: 100%;
        }

        [data-open-items-filter] {
          flex: 1 1 0;
        }
      }
    `;

    const badge = root.document.createElement('div');
    badge.setAttribute('data-reference-badge', '');

    const handle = root.document.createElement('button');
    handle.setAttribute('type', 'button');
    handle.setAttribute('data-drag-handle', '');
    handle.setAttribute('aria-label', '拖动调整位置，双击恢复默认位置');
    handle.setAttribute('aria-describedby', 'gitlab-reference-drag-tooltip');
    handle.addEventListener('pointerdown', handleDragPointerDown);
    handle.addEventListener('pointermove', handleDragPointerMove);
    handle.addEventListener('pointerup', handleDragPointerUp);
    handle.addEventListener('pointercancel', handleDragPointerCancel);
    handle.addEventListener('dblclick', handleDragDoubleClick);
    handle.addEventListener('click', handleDragClick);
    handle.addEventListener('keydown', handleDragKeydown);

    const handleIcon = createDragHandleIcon();
    const handleTooltip = root.document.createElement('span');
    handleTooltip.id = 'gitlab-reference-drag-tooltip';
    handleTooltip.setAttribute('data-drag-tooltip', '');
    handleTooltip.setAttribute('role', 'tooltip');
    handleTooltip.textContent = '拖动调整位置';
    handle.append(handleIcon, handleTooltip);

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

    badge.append(handle, trigger, button);
    shadow.append(style, badge, panel, announcement);
    shadow.addEventListener('focusout', handleNavigationFocusOut);
    root.document.documentElement.append(host);
    root.document.addEventListener('pointerdown', handleDocumentPointerDown);
    applyPosition(host);
    return host;
  }

  function sync({ resetCopy = true } = {}) {
    if (destroyed) return;

    if (resetCopy) invalidateCopyOperations();
    lastUrl = root.location.href;
    const reference = parseGitLabReference(lastUrl);
    if (!reference) {
      resetNavigation();
      removeBadge();
      return;
    }

    const projectKey = getProjectKey(reference);
    const origin = reference.origin;
    if (origin !== configOrigin) {
      updateConfig(origin, { reloadNavigation: true });
    }
    const projectChanged = navigation.projectKey !== projectKey;
    if (projectChanged) {
      resetNavigation();
      navigation.projectKey = projectKey;
    }
    navigation.reference = reference;

    const host = root.document.getElementById(HOST_ID) || createBadgeHost();
    host.setAttribute('data-touch-drag', activeConfig.touchDrag ? 'true' : 'false');
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
    if (resetCopy) setDefaultFeedback(host, copyText);
    renderNavigationPanel(host);
    applyPosition(host);
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
    flushScheduledPositionSave();
    destroyed = true;
    invalidateCopyOperations();
    resetNavigation();

    if (frameId !== null) {
      root.cancelAnimationFrame(frameId);
      frameId = null;
    }
    if (positionFrameId !== null) {
      root.cancelAnimationFrame(positionFrameId);
      positionFrameId = null;
    }
    positionGeneration += 1;
    cancelDrag();
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
    root.removeEventListener('resize', handleResize);
    configStore.dispose?.();
    removeBadge();
  }

  function updateConfig(origin, { force = false, reloadNavigation = false } = {}) {
    if (!force && origin === configOrigin && configurationGeneration > 0) return configurationReady;
    configOrigin = origin;
    const generation = configurationGeneration + 1;
    configurationGeneration = generation;
    const previous = activeConfig;
    activeConfig = configApi.getEffectiveConfig(configStore.getConfig(), origin);
    configurationReady = Promise.resolve(configStore.load(origin))
      .then((effective) => {
        if (destroyed || generation !== configurationGeneration) return;
        const requestPolicyChanged = previous.maxItemsPerType !== effective.maxItemsPerType
          || previous.loadingMode !== effective.loadingMode;
        let searchDisplayChanged = false;
        const memoryDisabled = previous.rememberSearch && !effective.rememberSearch;
        if (memoryDisabled) {
          searchDisplayChanged = navigation.query !== ''
            || navigation.listFilter !== (effective.listFilter || 'all');
          navigation.query = '';
          navigation.listFilter = effective.listFilter || 'all';
          navigation.searchOwned = false;
        } else if (!navigation.searchOwned) {
          const nextQuery = effective.rememberSearch
            ? effective.searchState?.query || ''
            : '';
          const nextListFilter = (effective.rememberSearch
            ? effective.searchState?.listFilter
            : null) || effective.listFilter || 'all';
          searchDisplayChanged = navigation.query !== nextQuery
            || navigation.listFilter !== nextListFilter;
          navigation.query = nextQuery;
          navigation.listFilter = nextListFilter;
        }
        const navigationDisplayChanged = searchDisplayChanged
          || previous.showLastRefresh !== effective.showLastRefresh;
        const nextPosition = configApi.normalizePosition(effective.position);
        const preserveLocalPosition = Boolean(drag || pendingPositionSave);
        if (!preserveLocalPosition) persistedPosition = { ...nextPosition };
        if (!preserveLocalPosition && !positionsEqual(position, nextPosition)) {
          positionGeneration += 1;
          position = { ...nextPosition };
        }
        activeConfig = effective;
        const host = root.document.getElementById(HOST_ID);
        if (requestPolicyChanged) {
          navigation.requestGeneration += 1;
          navigation.pending = null;
          navigation.loading = false;
          navigation.cache = null;
          navigation.lastLoadedAt = null;
          navigation.issues = null;
          navigation.mergeRequests = null;
          navigation.errors = { issues: false, mergeRequests: false };
        }
        if (host) {
          host.setAttribute('data-touch-drag', effective.touchDrag ? 'true' : 'false');
          applyPosition(host);
          if (requestPolicyChanged || navigationDisplayChanged) sync({ resetCopy: false });
          if ((reloadNavigation || requestPolicyChanged) && navigation.open) {
            loadOpenItems({ force: true });
          }
        }
      })
      .catch(() => {
        if (destroyed || generation !== configurationGeneration) return;
        activeConfig = previous;
      });
    return configurationReady;
  }

  function handleDocumentReady() {
    updateConfig(getCurrentOrigin());
    sync();
    loadStoredPosition();
    startObserver();
  }

  for (const eventName of NAVIGATION_EVENTS) {
    const target = eventName === 'popstate' || eventName === 'hashchange'
      ? root
      : root.document;
    target.addEventListener(eventName, scheduleSync);
  }

  root.GitLabReferenceBadge = { sync, destroy };
  root.addEventListener('resize', handleResize);

  if (root.document.documentElement) {
    handleDocumentReady();
  } else {
    root.document.addEventListener('DOMContentLoaded', handleDocumentReady, { once: true });
  }
})(globalThis);
