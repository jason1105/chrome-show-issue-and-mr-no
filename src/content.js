(function initializeGitLabReferenceBadge(root) {
  'use strict';

  const HOST_ID = 'gitlab-reference-badge-host';
  const FEEDBACK_DURATION_MS = 1500;
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
  let copyGeneration = 0;
  let observer = null;
  let destroyed = false;

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

  function clearFeedbackTimer() {
    if (feedbackTimerId === null) return;
    root.clearTimeout(feedbackTimerId);
    feedbackTimerId = null;
  }

  function invalidateCopyOperations() {
    copyGeneration += 1;
    clearFeedbackTimer();
  }

  function removeBadge() {
    invalidateCopyOperations();
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
      label: shadow?.querySelector('[data-reference-label]'),
      button: shadow?.querySelector('[data-copy-reference]'),
      tooltip: shadow?.querySelector('[data-copy-tooltip]'),
      icon: shadow?.querySelector('[data-copy-icon]'),
      announcement: shadow?.querySelector('[data-copy-announcement]'),
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

        [data-copy-reference]:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        [data-kind="merge-request"] {
          border-color: rgba(117, 170, 255, 0.55);
          color: #9ac1ff;
        }
      }
    `;

    const badge = root.document.createElement('div');
    badge.setAttribute('data-reference-badge', '');

    const label = root.document.createElement('span');
    label.setAttribute('data-reference-label', '');

    const button = root.document.createElement('button');
    button.setAttribute('type', 'button');
    button.setAttribute('data-copy-reference', '');
    button.setAttribute('data-copy-state', 'default');
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

    badge.append(label, button);
    shadow.append(style, badge, announcement);
    root.document.documentElement.append(host);
    return host;
  }

  function sync() {
    if (destroyed) return;

    invalidateCopyOperations();
    lastUrl = root.location.href;
    const reference = parseGitLabReference(lastUrl);
    if (!reference) {
      removeBadge();
      return;
    }

    const host = root.document.getElementById(HOST_ID) || createBadgeHost();
    const { badge, label, button } = getBadgeParts(host);
    const copyText = formatCopyText(reference);
    label.textContent = formatReference(reference);
    badge.setAttribute('data-kind', reference.kind);
    button.setAttribute('aria-label', `复制 ${copyText}`);
    button.setAttribute('data-copy-text', copyText);
    setDefaultFeedback(host, copyText);
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
