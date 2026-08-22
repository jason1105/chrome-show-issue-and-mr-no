(function initializeGitLabReferenceBadge(root) {
  'use strict';

  const HOST_ID = 'gitlab-reference-badge-host';
  const PANEL_ID = 'gitlab-open-items-panel';
  const FEEDBACK_DURATION_MS = 1500;
  const HOVER_OPEN_DELAY_MS = 150;
  const HOVER_CLOSE_DELAY_MS = 250;
  const POSITION_SAVE_DELAY_MS = 200;
  const SEARCH_STATE_SAVE_DELAY_MS = 200;
  const VIEWPORT_MARGIN = 8;
  const PANEL_GAP = 6;
  const DRAG_THRESHOLD = 4;
  const NAVIGATION_EVENTS = [
    'glr:navigate',
    'popstate',
    'hashchange',
    'turbo:load',
    'turbolinks:load',
    'gl:page:load',
  ];
  const parseGitLabReference = root.GitLabReferenceParser?.parseGitLabReference;
  const parseGitLabProjectPage = root.GitLabReferenceParser?.parseGitLabProjectPage;
  const configApi = root.GitLabReferenceConfig;
  const uiApi = root.GitLabReferenceUi;
  const i18nApi = root.GitLabReferenceI18n;
  const t = (key, substitutions) => (
    i18nApi && typeof i18nApi.getMessage === 'function'
      ? i18nApi.getMessage(key, substitutions)
      : key
  );
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
    || typeof parseGitLabProjectPage !== 'function'
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
  let searchStateSaveTimerId = null;
  let pendingSearchStateSave = null;
  let persistedPosition = { ...DEFAULT_POSITION };
  let drag = null;
  let activeConfig = {
    ...defaultConfig,
    position: { ...defaultConfig.position },
    searchState: { ...defaultConfig.searchState },
  };
  const configStore = configApi.createConfigStore(root.chrome?.storage?.sync, {
    legacyStorage: root.chrome?.storage?.local,
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
    requestControllers: new Set(),
    pending: null,
    query: defaultConfig.searchState?.query || '',
    listFilter: defaultConfig.searchState?.listFilter || defaultConfig.listFilter || 'all',
    stateFilter: defaultConfig.itemStateFilter || 'open',
    stateFilterOwned: false,
    searchOwned: false,
    truncated: { issues: false, mergeRequests: false },
  };

  function formatReference(reference) {
    if (!reference.kind) return reference.projectPath;
    return reference.kind === 'issue'
      ? `Issue #${reference.iid}`
      : `MR !${reference.iid}`;
  }

  function formatCopyText(reference) {
    if (!reference.kind) return '';
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

  function getItemStateFilter() {
    return navigation.stateFilter === 'all' ? 'all' : 'open';
  }

  function isCurrentCache() {
    return navigation.cache?.key === navigation.projectKey
      && navigation.cache?.maxItemsPerType === activeConfig.maxItemsPerType
      && navigation.cache?.itemStateFilter === getItemStateFilter();
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

    if (/^[1-9][0-9]*$/.test(normalized)) {
      if (activeConfig.searchScope === 'number') return item.iid === normalized;
      return item.iid === normalized
        || item.title.toLocaleLowerCase().includes(normalized.toLocaleLowerCase());
    }
    return item.title.toLocaleLowerCase().includes(normalized.toLocaleLowerCase());
  }

  function filterOpenItems(items) {
    return Array.isArray(items)
      ? items.filter((item) => itemMatchesQuery(item, navigation.query))
      : items;
  }

  function cancelScheduledSearchStateSave() {
    if (searchStateSaveTimerId !== null) {
      root.clearTimeout(searchStateSaveTimerId);
      searchStateSaveTimerId = null;
    }
    pendingSearchStateSave = null;
  }

  function flushScheduledSearchStateSave() {
    if (searchStateSaveTimerId !== null) {
      root.clearTimeout(searchStateSaveTimerId);
      searchStateSaveTimerId = null;
    }
    const pending = pendingSearchStateSave;
    pendingSearchStateSave = null;
    if (!pending || !activeConfig.rememberSearch) return;
    Promise.resolve(configStore.setSearchState(pending.state, pending.origin)).catch(() => {
      // Search remains usable in this content-script session when persistence fails.
    });
  }

  function persistSearchState({ immediate = false } = {}) {
    if (!activeConfig.rememberSearch) {
      cancelScheduledSearchStateSave();
      return;
    }
    pendingSearchStateSave = {
      state: {
        query: navigation.query,
        listFilter: navigation.listFilter,
      },
      origin: getCurrentOrigin(),
    };
    if (immediate) {
      flushScheduledSearchStateSave();
      return;
    }
    if (searchStateSaveTimerId !== null) root.clearTimeout(searchStateSaveTimerId);
    searchStateSaveTimerId = root.setTimeout(() => {
      searchStateSaveTimerId = null;
      flushScheduledSearchStateSave();
    }, SEARCH_STATE_SAVE_DELAY_MS);
  }

  function buildItemsApiUrl(reference, resource, page, perPage, stateParam) {
    const encodedProject = encodeURIComponent(reference.projectPath);
    return `${reference.origin}/api/v4/projects/${encodedProject}/${resource}`
      + `?state=${stateParam}&scope=all&order_by=updated_at&sort=desc&per_page=${perPage}`
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

  function createAbortSignalSupport() {
    // Environments without AbortController (older browsers, test harness) fall
    // back to fetch without a signal; the request still completes or rejects.
    return typeof root.AbortController === 'function'
      ? new root.AbortController()
      : null;
  }

  async function fetchWithTimeout(url, { signal: externalSignal } = {}) {
    const controller = createAbortSignalSupport();
    let timerId = null;
    const timeoutMs = activeConfig.requestTimeoutMs || 10000;
    const onExternalAbort = () => controller?.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller?.abort();
      else externalSignal.addEventListener('abort', onExternalAbort);
    }
    if (controller && !controller.signal.aborted) {
      timerId = root.setTimeout(() => controller.abort(), timeoutMs);
    }
    try {
      return await root.fetch(url, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (error) {
      if (externalSignal?.aborted) throw new DOMException('GitLab API request aborted', 'AbortError');
      if (controller?.signal?.aborted) throw new Error(`GitLab API request timed out after ${timeoutMs}ms`);
      throw error;
    } finally {
      if (timerId !== null) root.clearTimeout(timerId);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  async function fetchAllItems(reference, kind, { startPage = 1, signal } = {}) {
    const resource = kind === 'issue' ? 'issues' : 'merge_requests';
    const limit = Math.min(
      activeConfig.maxItemsPerType,
      activeConfig.protected?.maxItemsPerType || 100,
    );
    const perPage = Math.min(limit, activeConfig.protected?.maxItemsPerPage || 100);
    const paginated = activeConfig.loadingMode === 'paginated';
    const batchLimit = paginated
      ? Math.min(limit, startPage > 1 ? perPage : (activeConfig.maxItemsPerBatch || perPage))
      : limit;
    const stateParam = getItemStateFilter() === 'all' ? 'all' : 'opened';
    const items = [];
    const visitedPages = new Set();
    let page = String(startPage);
    let truncated = false;
    let nextStartPage = 1;

    while (page) {
      if (visitedPages.has(page)) throw new Error('Invalid GitLab pagination');
      visitedPages.add(page);

      const response = await fetchWithTimeout(
        buildItemsApiUrl(reference, resource, page, perPage, stateParam),
        { signal },
      );
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
          state: typeof item.state === 'string' ? item.state : '',
          webUrl: typeof item.web_url === 'string' && item.web_url
            ? item.web_url
            : buildFallbackWebUrl(reference, kind, iid),
        });
        if (items.length >= batchLimit) break;
      }

      if (items.length >= batchLimit) {
        const breakNext = response.headers?.get('X-Next-Page') || '';
        nextStartPage = /^[1-9][0-9]*$/.test(breakNext) ? Number(breakNext) : 0;
        truncated = batchLimit < limit && nextStartPage > 0;
        break;
      }

      const nextPage = response.headers?.get('X-Next-Page') || '';
      if (nextPage && !/^[1-9][0-9]*$/.test(nextPage)) {
        throw new Error('GitLab API returned an invalid next page');
      }
      nextStartPage = Number(nextPage) || 0;
      page = nextPage;
    }

    return { items, truncated, nextStartPage };
  }

  function mergeLoadedItems(existing, incoming, limit) {
    if (!existing?.length) return { items: incoming, truncated: false };
    const seen = new Set(existing.map((item) => `${item.kind}:${item.iid}`));
    const merged = [...existing];
    let truncated = false;
    for (const item of incoming) {
      const key = `${item.kind}:${item.iid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
      if (merged.length >= limit) {
        truncated = merged.length >= limit;
        break;
      }
    }
    return { items: merged, truncated };
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
    abortStaleNavigationRequests();
    navigation.loadingMore = { issues: false, mergeRequests: false };
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
    // stateFilter is panel-owned (#16); it intentionally survives navigations
    // and host re-creation, exactly like the query/type filters do.
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
    if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      cancelDrag();
      positionGeneration += 1;
      position = { ...DEFAULT_POSITION };
      applyPosition();
      clearStoredPosition();
      return;
    }
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
    tooltip.textContent = t('copyDefault', [copyText]);
    uiApi.setIcon(icon, 'copy', uiApi.COPY_ICON_PATHS);
    announcement.textContent = '';
  }

  function setFeedback(host, state, copyText, generation) {
    const { button, tooltip, icon, announcement } = getBadgeParts(host);
    if (!button) return;

    const succeeded = state === 'success';
    button.setAttribute('data-copy-state', state);
    tooltip.textContent = succeeded ? t('copied') : t('copyFailed');
    uiApi.setIcon(icon, succeeded ? 'success' : 'copy', succeeded ? uiApi.SUCCESS_ICON_PATHS : uiApi.COPY_ICON_PATHS);
    announcement.textContent = succeeded ? t('copied') : t('copyFailed');

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
    if (!text) return; // project-mode badge has nothing to copy
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
    if (item.state && item.state !== 'opened') {
      row.setAttribute('data-item-state', item.state);
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
      marker.textContent = t('current');
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
    headingLabel.textContent = name === 'issues' ? t('groupIssues') : t('groupMergeRequests');
    const count = root.document.createElement('span');
    count.setAttribute('data-open-items-group-count', '');
    count.textContent = String(items?.length || 0);
    heading.append(headingLabel, count);
    group.append(heading);

    if (failed) {
      group.setAttribute('data-open-items-state', 'error');
      const status = root.document.createElement('div');
      status.setAttribute('data-open-items-status', '');
      status.textContent = t('loadFailed');
      group.append(status);
      return group;
    }

    if (items === null) {
      group.setAttribute('data-open-items-state', 'loading');
      const status = root.document.createElement('div');
      status.setAttribute('data-open-items-status', '');
      status.textContent = t('loading');
      group.append(status);
      return group;
    }

    group.setAttribute('data-open-items-state', 'ready');
    if (items.length === 0) {
      const status = root.document.createElement('div');
      status.setAttribute('data-open-items-status', '');
      status.textContent = kind === 'issue' ? t('emptyOpenIssue') : t('emptyOpenMr');
      if (getItemStateFilter() === 'all') {
        status.textContent = kind === 'issue' ? t('emptyIssue') : t('emptyMr');
      }
      group.append(status);
      return group;
    }

    for (const item of items) group.append(createOpenItemRow(item));

    const kindKey = name === 'issues' ? 'issues' : 'mergeRequests';
    const limit = Math.min(
      activeConfig.maxItemsPerType,
      activeConfig.protected?.maxItemsPerType || 100,
    );
    const loadMore = root.document.createElement('button');
    loadMore.setAttribute('type', 'button');
    loadMore.setAttribute('data-open-items-load-more', kind);
    if (navigation.loadingMore?.[kindKey]) {
      loadMore.setAttribute('aria-busy', 'true');
      loadMore.disabled = true;
      loadMore.textContent = t('loadingMore');
    } else if (navigation.truncated?.[kindKey] && items.length < limit) {
      loadMore.textContent = t('loadMore', [String(items.length)]);
      loadMore.addEventListener('click', handleLoadMore);
    } else {
      if (items.length >= limit) {
        loadMore.textContent = t('reachedLimit', [String(limit)]);
      } else {
        loadMore.textContent = t('loadedAll', [String(items.length)]);
      }
      loadMore.disabled = true;
    }
    group.append(loadMore);
    return group;
  }

  function formatLastRefresh(timestamp) {
    if (!Number.isFinite(timestamp)) return '';
    try {
      const elapsedMs = root.Date.now() - timestamp;
      if (elapsedMs < 60000) return t('justUpdated');
      if (elapsedMs < 3600000) return t('minutesAgo', [String(Math.floor(elapsedMs / 60000))]);
      return new root.Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  function getNavigationPanelState() {
    const filteredIssues = filterOpenItems(navigation.issues);
    const filteredMergeRequests = filterOpenItems(navigation.mergeRequests);
    const visibleKinds = getVisibleKinds();
    const totalCount = (
      (visibleKinds.includes('issue') ? filteredIssues?.length || 0 : 0)
      + (visibleKinds.includes('merge-request') ? filteredMergeRequests?.length || 0 : 0)
    );
    const visibleGroupsReady = visibleKinds.every((kind) => (
      kind === 'issue'
        ? filteredIssues !== null && !navigation.errors.issues
        : filteredMergeRequests !== null && !navigation.errors.mergeRequests
    ));
    const allGroupsReady = navigation.issues !== null
      && navigation.mergeRequests !== null
      && !navigation.errors.issues
      && !navigation.errors.mergeRequests;
    const projectHasNoOpenItems = allGroupsReady
      && navigation.issues.length + navigation.mergeRequests.length === 0;

    return {
      filteredIssues,
      filteredMergeRequests,
      projectHasNoOpenItems,
      totalCount,
      visibleGroupsReady,
      visibleKinds,
    };
  }

  function createNavigationResultChildren(state) {
    const children = [];
    if (navigation.message) {
      const message = root.document.createElement('div');
      message.setAttribute('data-open-items-message', '');
      message.setAttribute('role', 'status');
      message.textContent = navigation.message;
      children.push(message);
    }
    const allMode = getItemStateFilter() === 'all';
    const naturalEmpty = navigation.query.trim() === '' && state.projectHasNoOpenItems;
    if (state.visibleGroupsReady && state.totalCount === 0 && !naturalEmpty) {
      const empty = root.document.createElement('div');
      empty.setAttribute('data-open-items-empty', '');
      empty.setAttribute('role', 'status');
      empty.textContent = allMode ? t('emptyNoMatchAll') : t('emptyNoMatchOpen');
      children.push(empty);
      return children;
    }
    if (state.visibleKinds.includes('issue')) {
      children.push(createOpenItemsGroup(
        'issues',
        state.filteredIssues,
        navigation.errors.issues,
      ));
    }
    if (state.visibleKinds.includes('merge-request')) {
      children.push(createOpenItemsGroup(
        'merge-requests',
        state.filteredMergeRequests,
        navigation.errors.mergeRequests,
      ));
    }
    return children;
  }

  function renderNavigationResults(host) {
    const { panel } = getBadgeParts(host);
    const total = panel?.querySelector('[data-open-items-total]');
    const summary = panel?.querySelector('[data-open-items-search-summary]');
    const results = panel?.querySelector('[data-open-items-results]');
    if (!total || !summary || !results) {
      renderNavigationPanel(host);
      return;
    }
    const state = getNavigationPanelState();
    total.textContent = String(state.totalCount);
    summary.textContent = state.totalCount === 0
      ? t('summaryNoMatch')
      : t('summaryFound', [String(state.totalCount)]);
    renderingNavigationPanel = true;
    try {
      results.replaceChildren(...createNavigationResultChildren(state));
    } finally {
      renderingNavigationPanel = false;
    }
  }

  function renderNavigationPanel(host, { rebuildStatic = false } = {}) {
    const { panel, trigger } = getBadgeParts(host);
    if (!panel || !trigger) return;
    const state = getNavigationPanelState();

    panel.hidden = !navigation.open;
    trigger.setAttribute('aria-expanded', navigation.open ? 'true' : 'false');

    if (rebuildStatic) {
      // Manual language switch: drop the once-built static controls so the
      // build branch below re-creates every string in the new language.
      for (const selector of [
        '[data-open-items-header]',
        '[data-open-items-controls]',
        '[data-item-state-controls]',
        '[data-open-items-search-summary]',
        '[data-open-items-results]',
      ]) {
        panel.querySelector(selector)?.remove();
      }
    }

    if (!panel.querySelector('[data-open-items-search]')) {
      const header = root.document.createElement('div');
      header.setAttribute('data-open-items-header', '');
      const heading = root.document.createElement('div');
      heading.setAttribute('data-open-items-heading', '');
      const headingText = root.document.createElement('span');
      headingText.textContent = t('panelHeading');
      const total = root.document.createElement('span');
      total.setAttribute('data-open-items-total', '');
      heading.append(headingText, total);

      const refresh = root.document.createElement('button');
      refresh.setAttribute('type', 'button');
      refresh.setAttribute('data-refresh-open-items', '');
      refresh.setAttribute('aria-label', t('refreshAriaLabel'));
      refresh.append(uiApi.createRefreshIcon());
      const refreshText = root.document.createElement('span');
      refreshText.textContent = t('refreshList');
      refresh.append(refreshText);
      refresh.addEventListener('click', handleRefresh);

      const settings = root.document.createElement('button');
      settings.setAttribute('type', 'button');
      settings.setAttribute('data-open-options', '');
      settings.setAttribute('aria-label', t('openSettingsAriaLabel'));
      settings.setAttribute('title', t('settingsTitle'));
      settings.append(uiApi.createSettingsIcon());
      settings.addEventListener('click', handleOpenOptionsClick);
      header.append(heading, settings, refresh);

      const searchControls = root.document.createElement('div');
      searchControls.setAttribute('data-open-items-controls', '');
      const search = root.document.createElement('input');
      search.setAttribute('type', 'search');
      search.setAttribute('data-open-items-search', '');
      search.setAttribute('aria-label', t('searchAriaLabel'));
      search.setAttribute('placeholder', t('searchPlaceholder'));
      search.addEventListener('input', handleSearchInput);
      search.addEventListener('keydown', handleSearchKeyboardEvent);
      search.addEventListener('keypress', handleSearchKeyboardEvent);
      search.addEventListener('keyup', handleSearchKeyboardEvent);

      const filters = root.document.createElement('div');
      filters.setAttribute('data-open-items-filters', '');
      filters.setAttribute('role', 'group');
      filters.setAttribute('aria-label', t('filterTypeAriaLabel'));
      for (const [kind, label] of [
        ['all', t('filterAll')],
        ['issue', t('filterIssue')],
        ['merge-request', t('filterMr')],
      ]) {
        const filter = root.document.createElement('button');
        filter.setAttribute('type', 'button');
        filter.setAttribute('data-open-items-filter', kind);
        filter.textContent = label;
        filter.addEventListener('click', handleFilterClick);
        filters.append(filter);
      }
      searchControls.append(search, filters);

      const stateControls = root.document.createElement('div');
      stateControls.setAttribute('data-item-state-controls', '');
      const stateLabel = root.document.createElement('span');
      stateLabel.setAttribute('data-item-state-label', '');
      stateLabel.textContent = t('stateLabel');
      const stateFilters = root.document.createElement('div');
      stateFilters.setAttribute('data-open-items-filters', '');
      stateFilters.setAttribute('data-item-state-filters', '');
      stateFilters.setAttribute('role', 'group');
      stateFilters.setAttribute('aria-label', t('filterStateAriaLabel'));
      for (const [stateValue, stateText] of [
        ['open', t('stateOpenOnly')],
        ['all', t('stateAll')],
      ]) {
        const stateFilter = root.document.createElement('button');
        stateFilter.setAttribute('type', 'button');
        stateFilter.setAttribute('data-open-items-filter', 'state');
        stateFilter.setAttribute('data-item-state-filter', stateValue);
        stateFilter.textContent = stateText;
        stateFilter.addEventListener('click', handleStateFilterClick);
        stateFilters.append(stateFilter);
      }
      stateControls.append(stateLabel, stateFilters);

      const searchSummary = root.document.createElement('span');
      searchSummary.setAttribute('data-open-items-search-summary', '');
      searchSummary.setAttribute('aria-live', 'polite');
      searchSummary.setAttribute('aria-atomic', 'true');

      const results = root.document.createElement('div');
      results.setAttribute('data-open-items-results', '');
      panel.append(header, searchControls, stateControls, searchSummary, results);
    }

    const heading = panel.querySelector('[data-open-items-heading]');
    const total = panel.querySelector('[data-open-items-total]');
    const refresh = panel.querySelector('[data-refresh-open-items]');
    const search = panel.querySelector('[data-open-items-search]');
    const searchSummary = panel.querySelector('[data-open-items-search-summary]');
    const results = panel.querySelector('[data-open-items-results]');
    if (!heading || !total || !refresh || !search || !searchSummary || !results) return;

    total.textContent = String(state.totalCount);
    searchSummary.textContent = state.totalCount === 0
      ? t('summaryNoMatch')
      : t('summaryFound', [String(state.totalCount)]);
    const existingLastRefresh = heading.querySelector('[data-last-refresh]');
    if (activeConfig.showLastRefresh && Number.isFinite(navigation.lastLoadedAt)) {
      const lastRefresh = existingLastRefresh || root.document.createElement('time');
      lastRefresh.setAttribute('data-last-refresh', '');
      lastRefresh.setAttribute('datetime', new root.Date(navigation.lastLoadedAt).toISOString());
      lastRefresh.textContent = t('lastRefreshPrefix', [formatLastRefresh(navigation.lastLoadedAt)]);
      if (!existingLastRefresh) heading.append(lastRefresh);
    } else {
      existingLastRefresh?.remove();
    }
    refresh.setAttribute('aria-busy', navigation.loading ? 'true' : 'false');
    if (navigation.loading) {
      refresh.setAttribute('disabled', '');
    } else {
      refresh.removeAttribute('disabled');
    }
    if (search.value !== navigation.query) search.value = navigation.query;
    for (const filter of panel.querySelectorAll('[data-open-items-filter]')) {
      const kind = filter.getAttribute('data-open-items-filter');
      filter.setAttribute('aria-pressed', navigation.listFilter === kind ? 'true' : 'false');
    }
    for (const stateFilter of panel.querySelectorAll('[data-item-state-filter]')) {
      const stateValue = stateFilter.getAttribute('data-item-state-filter');
      stateFilter.setAttribute(
        'aria-pressed',
        navigation.stateFilter === stateValue ? 'true' : 'false',
      );
    }
    renderingNavigationPanel = true;
    try {
      results.replaceChildren(...createNavigationResultChildren(state));
    } finally {
      renderingNavigationPanel = false;
    }
  }

  function abortStaleNavigationRequests() {
    const controllers = Array.from(navigation.requestControllers || []);
    navigation.requestControllers = new Set();
    for (const controller of controllers) controller?.abort();
  }

  function isCurrentNavigationRequest(generation, projectKey, host) {
    return !destroyed
      && generation === navigation.requestGeneration
      && projectKey === navigation.projectKey
      && host === root.document.getElementById(HOST_ID);
  }

  function buildErrorMessage(issueResult, mergeRequestResult) {
    const failed = [issueResult, mergeRequestResult].filter((result) => result?.status === 'rejected');
    if (failed.length === 0) return '';
    if (failed.length === 2) return t('loadFailedRetry');
    return issueResult?.status === 'rejected' ? t('issueUpdateFailed') : t('mrUpdateFailed');
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
      navigation.truncated = navigation.cache.truncated || { issues: false, mergeRequests: false };
      navigation.nextStartPage = navigation.cache.nextStartPage
        || { issues: 1, mergeRequests: 1 };
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
    const requestController = createAbortSignalSupport();
    if (requestController) navigation.requestControllers.add(requestController);
    const requestSignal = requestController?.signal || null;
    navigation.loading = true;
    navigation.errors = { issues: false, mergeRequests: false };
    navigation.message = '';
    renderNavigationPanel(host);

    const kinds = ['issue', 'merge-request'];
    const fetchOne = (kind) => fetchAllItems(reference, kind, { signal: requestSignal })
      .then((value) => ({ status: 'fulfilled', value }))
      .catch((reason) => ({ status: 'rejected', reason }));
    const pending = (async () => {
      try {
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
        navigation.issues = issueResult?.value?.items || [];
        navigation.mergeRequests = mergeRequestResult?.value?.items || [];
        navigation.truncated = {
          issues: Boolean(issueResult?.value?.truncated),
          mergeRequests: Boolean(mergeRequestResult?.value?.truncated),
        };
        navigation.nextStartPage = {
          issues: issueResult?.value?.nextStartPage || 1,
          mergeRequests: mergeRequestResult?.value?.nextStartPage || 1,
        };
        navigation.errors = { issues: false, mergeRequests: false };
        navigation.cache = {
          key: projectKey,
          maxItemsPerType: activeConfig.maxItemsPerType,
          itemStateFilter: getItemStateFilter(),
          loadedAt: root.Date.now(),
          issues: navigation.issues,
          mergeRequests: navigation.mergeRequests,
          truncated: navigation.truncated,
          nextStartPage: navigation.nextStartPage,
        };
        navigation.lastLoadedAt = navigation.cache.loadedAt;
      } else if (hasCompleteSnapshot) {
        navigation.issues = navigation.cache.issues;
        navigation.mergeRequests = navigation.cache.mergeRequests;
        navigation.lastLoadedAt = navigation.cache.loadedAt;
        navigation.message = t('refreshFailedShowLast');
      } else {
        navigation.issues = issueResult?.status === 'fulfilled' ? issueResult.value.items : null;
        navigation.mergeRequests = mergeRequestResult?.status === 'fulfilled'
          ? mergeRequestResult.value.items
          : null;
        navigation.truncated = { issues: false, mergeRequests: false };
        navigation.errors = {
          issues: Boolean(issueResult?.status === 'rejected'),
          mergeRequests: Boolean(mergeRequestResult?.status === 'rejected'),
        };
        if (navigation.issues !== null || navigation.mergeRequests !== null) {
          navigation.message = buildErrorMessage(issueResult, mergeRequestResult);
        }
      }
      navigation.loading = false;
      navigation.pending = null;
      renderNavigationPanel(host);
      } finally {
        navigation.requestControllers.delete(requestController);
      }
    })();
    navigation.pending = pending;
    return pending;
  }

  async function loadMoreOpenItems(kind) {
    const kindKey = kind === 'issue' ? 'issues' : 'mergeRequests';
    const current = navigation[kindKey];
    const host = root.document.getElementById(HOST_ID);
    if (!host || !Array.isArray(current) || navigation.loadingMore?.[kindKey] || navigation.loading) return;
    await configurationReady;
    if (destroyed || !navigation.reference) return;
    const generation = navigation.requestGeneration;
    const projectKey = navigation.projectKey;
    const startPage = navigation.nextStartPage?.[kindKey] || 1;
    const limit = Math.min(
      activeConfig.maxItemsPerType,
      activeConfig.protected?.maxItemsPerType || 100,
    );
    const requestController = createAbortSignalSupport();
    if (requestController) navigation.requestControllers.add(requestController);
    const requestSignal = requestController?.signal || null;
    navigation.loadingMore = { ...navigation.loadingMore, [kindKey]: true };
    renderNavigationPanel(host);
    try {
      const { items, truncated, nextStartPage } = await fetchAllItems(
        navigation.reference,
        kind,
        { startPage, signal: requestSignal },
      );
      if (!isCurrentNavigationRequest(generation, projectKey, host)) return;
      const merged = mergeLoadedItems(current, items, limit);
      navigation[kindKey] = merged.items;
      navigation.truncated = { ...navigation.truncated, [kindKey]: Boolean(truncated) };
      navigation.nextStartPage = { ...navigation.nextStartPage, [kindKey]: nextStartPage || 0 };
      if (navigation.cache && navigation.cache.key === navigation.projectKey) {
        navigation.cache = {
          ...navigation.cache,
          issues: navigation.issues,
          mergeRequests: navigation.mergeRequests,
          truncated: navigation.truncated,
          nextStartPage: navigation.nextStartPage,
        };
      }
    } catch {
      navigation.message = t('loadMoreFailed');
    } finally {
      navigation.loadingMore = { ...navigation.loadingMore, [kindKey]: false };
      if (!requestController) return;
      if (generation === navigation.requestGeneration) {
        navigation.requestControllers.delete(requestController);
      } else {
        requestController.abort();
      }
      renderNavigationPanel(host);
    }
  }

  function handleLoadMore(event) {
    event.preventDefault();
    event.stopPropagation();
    const kind = event.currentTarget.getAttribute('data-open-items-load-more');
    if (kind === 'issue' || kind === 'merge-request') loadMoreOpenItems(kind);
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
      const host = root.document.getElementById(HOST_ID);
      if (host?.shadowRoot?.activeElement) return;
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
      if (event.isComposing) return;
      event.preventDefault();
      closeNavigation({ restoreFocus: true });
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && !navigation.open) {
      event.preventDefault();
      openNavigation();
    }
  }

  function handleSearchKeyboardEvent(event) {
    if (event.type === 'keydown') handleNavigationKeydown(event);
    event.stopPropagation();
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
    if (host) renderNavigationResults(host);
    persistSearchState();
  }

  function handleFilterClick(event) {
    const nextFilter = event.currentTarget.getAttribute('data-open-items-filter');
    if (!['all', 'issue', 'merge-request'].includes(nextFilter)) return;
    navigation.listFilter = nextFilter;
    navigation.searchOwned = true;
    const host = root.document.getElementById(HOST_ID);
    if (host) renderNavigationPanel(host);
    persistSearchState({ immediate: true });
  }

  function handleStateFilterClick(event) {
    const nextFilter = event.currentTarget.getAttribute('data-item-state-filter');
    if (nextFilter !== 'open' && nextFilter !== 'all') return;
    if (navigation.stateFilter === nextFilter) return;
    navigation.stateFilter = nextFilter;
    navigation.stateFilterOwned = true;
    const host = root.document.getElementById(HOST_ID);
    if (!host) return;
    // The state filter changes the API request (state=opened vs all): drop the
    // cache like a request-policy change and reload, keeping the panel open.
    navigation.requestGeneration += 1;
    abortStaleNavigationRequests();
    navigation.pending = null;
    navigation.loading = false;
    navigation.cache = null;
    navigation.lastLoadedAt = null;
    navigation.issues = null;
    navigation.mergeRequests = null;
    navigation.errors = { issues: false, mergeRequests: false };
    navigation.truncated = { issues: false, mergeRequests: false };
    navigation.loadingMore = { issues: false, mergeRequests: false };
    navigation.message = '';
    renderNavigationPanel(host);
    loadOpenItems({ force: true });
    // Persist through the config store so the choice survives sessions (#16:
    // the panel is the single entry point for this preference now).
    Promise.resolve(configStore.save({ itemStateFilter: nextFilter }, getCurrentOrigin()))
      .catch(() => {
        // The in-session filter still works when persistence fails.
      });
  }

  function handleOpenOptionsClick(event) {
    event.preventDefault();
    event.stopPropagation();
    try {
      // #20 (final): openOptionsPage is unavailable in content-script contexts
      // (silent no-op), and getURL + window.open from a page is blocked by the
      // browser (ERR_BLOCKED_BY_CLIENT in Arc/Chrome). Delegate to the service
      // worker via a message so it can call the official openOptionsPage API.
      root.chrome?.runtime?.sendMessage?.({ type: 'gitlab-reference-open-options' });
    } catch {
      // The message is best-effort; the click is still absorbed so the panel
      // stays open even if the service worker is unreachable.
    }
  }

  function createBadgeHost() {
    const host = root.document.createElement('div');
    host.id = HOST_ID;

    const shadow = host.attachShadow({ mode: 'open' });
    const style = root.document.createElement('style');
    style.textContent = uiApi.BADGE_CSS;

    const badge = root.document.createElement('div');
    badge.setAttribute('data-reference-badge', '');

    const handle = root.document.createElement('button');
    handle.setAttribute('type', 'button');
    handle.setAttribute('data-drag-handle', '');
    handle.setAttribute('aria-label', t('dragAriaLabel'));
    handle.setAttribute('aria-describedby', 'gitlab-reference-drag-tooltip');
    handle.addEventListener('pointerdown', handleDragPointerDown);
    handle.addEventListener('pointermove', handleDragPointerMove);
    handle.addEventListener('pointerup', handleDragPointerUp);
    handle.addEventListener('pointercancel', handleDragPointerCancel);
    handle.addEventListener('dblclick', handleDragDoubleClick);
    handle.addEventListener('click', handleDragClick);
    handle.addEventListener('keydown', handleDragKeydown);

    const handleIcon = uiApi.createDragHandleIcon();
    const handleTooltip = root.document.createElement('span');
    handleTooltip.id = 'gitlab-reference-drag-tooltip';
    handleTooltip.setAttribute('data-drag-tooltip', '');
    handleTooltip.setAttribute('role', 'tooltip');
    handleTooltip.textContent = t('dragTooltip');
    handle.append(handleIcon, handleTooltip);

    const trigger = root.document.createElement('button');
    trigger.setAttribute('type', 'button');
    trigger.setAttribute('data-reference-trigger', '');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', PANEL_ID);
    trigger.setAttribute('aria-label', t('triggerAriaLabel'));
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

    const icon = uiApi.createIcon();

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

  function sync({ resetCopy = true, forceRender = false, rerenderPanel = false } = {}) {
    if (destroyed) return;

    if (resetCopy) invalidateCopyOperations();
    lastUrl = root.location.href;
    let reference = parseGitLabReference(lastUrl);
    if (!reference && activeConfig.showOnAllRepoPages) {
      // Full-repo mode: fall back to project-level coordinates so the badge
      // (with open issue/MR counts) shows on every repository page.
      const project = parseGitLabProjectPage(lastUrl);
      if (project) {
        reference = {
          origin: project.origin,
          projectPath: project.projectPath,
          kind: null,
          iid: null,
          projectOnly: true,
        };
      }
    }
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
    const referenceChanged = navigation.reference !== reference && (
      !navigation.reference
      || navigation.reference.kind !== reference.kind
      || navigation.reference.number !== reference.number
      || navigation.reference.projectPath !== reference.projectPath
      || navigation.reference.origin !== reference.origin
      || Boolean(navigation.reference.projectOnly) !== Boolean(reference.projectOnly)
    );
    navigation.reference = reference;

    const host = root.document.getElementById(HOST_ID) || createBadgeHost();
    host.setAttribute('data-touch-drag', activeConfig.touchDrag ? 'true' : 'false');
    const { badge, trigger, label, button } = getBadgeParts(host);
    const copyText = formatCopyText(reference);
    const currentKind = badge.getAttribute('data-kind');
    const currentCopyText = button.getAttribute('data-copy-text');
    const unchanged = !referenceChanged && !forceRender
      && currentKind === String(reference.kind)
      && currentCopyText === copyText;
    if (!unchanged) {
      label.textContent = formatReference(reference);
      if (reference.kind) badge.setAttribute('data-kind', reference.kind);
      else badge.removeAttribute('data-kind');
      trigger.setAttribute(
        'aria-label',
        t('triggerAriaLabelProject', [reference.projectPath]),
      );
      if (copyText) {
        button.setAttribute('aria-label', t('copyDefault', [copyText]));
        button.setAttribute('data-copy-text', copyText);
      } else {
        button.removeAttribute('aria-label');
        button.removeAttribute('data-copy-text');
      }
      if (resetCopy) setDefaultFeedback(host, copyText);
      renderNavigationPanel(host, { rebuildStatic: rerenderPanel });
    }
    applyPosition(host);
  }

  function scheduleSync() {
    if (destroyed || frameId !== null) return;

    frameId = root.requestAnimationFrame(() => {
      frameId = null;
      sync();
    });
  }

  function handleNavigationEvent() {
    if (destroyed) return;
    // MAIN-world hook fires as soon as pushState/replaceState returns, before
    // GitLab swaps DOM content; defer to the next frame like other events.
    scheduleSync();
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
    flushScheduledSearchStateSave();
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
    for (const { target, eventName, listener } of navigationEventListeners) {
      target.removeEventListener(eventName, listener);
    }
    navigationEventListeners.length = 0;
    root.document.removeEventListener('DOMContentLoaded', handleDocumentReady);
    root.document.removeEventListener('pointerdown', handleDocumentPointerDown);
    root.removeEventListener('resize', handleResize);
    root.chrome?.storage?.onChanged?.removeListener?.(handleStorageLanguageChanged);
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
          || previous.loadingMode !== effective.loadingMode
          || (!navigation.stateFilterOwned
            && (previous.itemStateFilter || 'open') !== (effective.itemStateFilter || 'open'));
        let searchDisplayChanged = false;
        const memoryDisabled = previous.rememberSearch && !effective.rememberSearch;
        if (memoryDisabled) {
          cancelScheduledSearchStateSave();
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
        if (!navigation.stateFilterOwned) {
          const nextStateFilter = effective.itemStateFilter === 'all' ? 'all' : 'open';
          if (navigation.stateFilter !== nextStateFilter) {
            navigation.stateFilter = nextStateFilter;
            searchDisplayChanged = true;
          }
        }
        const navigationDisplayChanged = searchDisplayChanged
          || previous.showLastRefresh !== effective.showLastRefresh
          || previous.showOnAllRepoPages !== effective.showOnAllRepoPages
          || previous.searchScope !== effective.searchScope;
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
          abortStaleNavigationRequests();
          navigation.pending = null;
          navigation.loading = false;
          navigation.cache = null;
          navigation.lastLoadedAt = null;
          navigation.issues = null;
          navigation.mergeRequests = null;
          navigation.errors = { issues: false, mergeRequests: false };
          navigation.truncated = { issues: false, mergeRequests: false };
          navigation.loadingMore = { issues: false, mergeRequests: false };
          navigation.message = '';
        }
        if (host) {
          host.setAttribute('data-touch-drag', effective.touchDrag ? 'true' : 'false');
          applyPosition(host);
        }
        // sync() re-creates the host when the new mode shows a badge where
        // none existed (full-repo display mode toggled on).
        if (requestPolicyChanged || navigationDisplayChanged) sync({ resetCopy: false, forceRender: true });
        if (host && (reloadNavigation || requestPolicyChanged) && navigation.open) {
          loadOpenItems({ force: true });
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
    loadStoredLanguage();
    subscribeToLanguageChanges();
  }

  const LANGUAGE_STORAGE_KEY = 'language';

  function applyLanguageOverride(locale) {
    if (!i18nApi || typeof i18nApi.setLanguage !== 'function') return false;
    const normalized = locale === 'zh_CN' || locale === 'en' ? locale : null;
    const previous = typeof i18nApi.getLanguage === 'function' ? i18nApi.getLanguage() : null;
    i18nApi.setLanguage(normalized);
    const next = typeof i18nApi.getLanguage === 'function' ? i18nApi.getLanguage() : normalized;
    if (previous === next) return false;
    // Rebuild the panel's static controls so every string renders in the
    // newly selected language; badge labels update via forceRender.
    sync({ resetCopy: false, forceRender: true, rerenderPanel: true });
    // The tooltip is only rewritten by setDefaultFeedback (resetCopy), so
    // refresh it directly when no copy feedback is in progress.
    refreshDefaultTooltip();
    return true;
  }

  function refreshDefaultTooltip() {
    const host = root.document.getElementById(HOST_ID);
    if (!host) return;
    const { button, tooltip } = getBadgeParts(host);
    if (!button || button.getAttribute('data-copy-state') !== 'default') return;
    const copyText = button.getAttribute('data-copy-text');
    if (!copyText) return;
    tooltip.textContent = t('copyDefault', [copyText]);
  }

  function loadStoredLanguage() {
    const storage = root.chrome?.storage?.sync;
    if (!storage?.get || typeof i18nApi?.setLanguage !== 'function') return;
    let applied = false;
    const apply = (locale) => {
      if (applied || destroyed) return;
      applied = true;
      applyLanguageOverride(locale);
    };
    try {
      // Chrome calls the callback; the test harness resolves a promise.
      const returned = storage.get([LANGUAGE_STORAGE_KEY], (items) => {
        apply(items?.[LANGUAGE_STORAGE_KEY]);
      });
      if (returned && typeof returned.then === 'function') {
        returned.then((items) => apply(items?.[LANGUAGE_STORAGE_KEY])).catch(() => apply(undefined));
      }
    } catch {
      apply(undefined);
    }
  }

  function handleStorageLanguageChanged(changes, areaName) {
    if (destroyed || (areaName && areaName !== 'sync')) return;
    const change = changes?.[LANGUAGE_STORAGE_KEY];
    if (!change) return;
    applyLanguageOverride(change.newValue);
  }

  function subscribeToLanguageChanges() {
    root.chrome?.storage?.onChanged?.addListener?.(handleStorageLanguageChanged);
  }

  const navigationEventListeners = [];
  for (const eventName of NAVIGATION_EVENTS) {
    const target = eventName === 'popstate' || eventName === 'hashchange'
      || eventName === 'glr:navigate'
      ? root
      : root.document;
    const listener = eventName === 'glr:navigate' ? handleNavigationEvent : scheduleSync;
    target.addEventListener(eventName, listener);
    navigationEventListeners.push({ target, eventName, listener });
  }

  root.GitLabReferenceBadge = { sync, destroy };
  root.addEventListener('resize', handleResize);

  if (root.document.documentElement) {
    handleDocumentReady();
  } else {
    root.document.addEventListener('DOMContentLoaded', handleDocumentReady, { once: true });
  }
})(globalThis);
