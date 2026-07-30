(function initializeGitLabReferenceBadge(root) {
  'use strict';

  const HOST_ID = 'gitlab-reference-badge-host';
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
  let observer = null;
  let destroyed = false;

  function formatReference(reference) {
    return reference.kind === 'issue'
      ? `Issue #${reference.iid}`
      : `MR !${reference.iid}`;
  }

  function removeBadge() {
    root.document.getElementById(HOST_ID)?.remove();
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
        display: block;
        max-width: 100%;
        overflow: hidden;
        padding: 5px 10px;
        border: 1px solid rgba(31, 41, 55, 0.28);
        border-radius: 6px;
        background: #ffffff;
        box-shadow: 0 2px 8px rgba(17, 24, 39, 0.2);
        color: #1f2937;
        font: 600 13px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        text-overflow: ellipsis;
        white-space: nowrap;
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

        [data-kind="merge-request"] {
          border-color: rgba(117, 170, 255, 0.55);
          color: #9ac1ff;
        }
      }
    `;

    const badge = root.document.createElement('div');
    badge.setAttribute('data-reference-badge', '');
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    shadow.append(style, badge);
    root.document.documentElement.append(host);
    return host;
  }

  function sync() {
    if (destroyed) return;

    lastUrl = root.location.href;
    const reference = parseGitLabReference(lastUrl);
    if (!reference) {
      removeBadge();
      return;
    }

    const host = root.document.getElementById(HOST_ID) || createBadgeHost();
    const badge = host.shadowRoot.querySelector('[data-reference-badge]');
    badge.textContent = formatReference(reference);
    badge.setAttribute('data-kind', reference.kind);
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
