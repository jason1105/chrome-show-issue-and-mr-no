(function initializeGitLabReferenceNavigationHook(root) {
  'use strict';

  if (root.GitLabReferenceNavigationHook) return;

  const NAVIGATION_EVENT_NAME = 'glr:navigate';
  let hookInstalled = false;

  function dispatchNavigation(type) {
    try {
      root.dispatchEvent(new CustomEvent(NAVIGATION_EVENT_NAME, {
        detail: { type, url: root.location.href },
      }));
    } catch {
      // Dispatch must never break the page's own navigation flow.
    }
  }

  function wrapHistoryMethod(name) {
    const original = root.history?.[name];
    if (typeof original !== 'function') return;
    root.history[name] = function hooked(...args) {
      const result = original.apply(this, args);
      dispatchNavigation(name);
      return result;
    };
  }

  function install() {
    if (hookInstalled) return;
    hookInstalled = true;
    wrapHistoryMethod('pushState');
    wrapHistoryMethod('replaceState');
  }

  install();

  root.GitLabReferenceNavigationHook = {
    event: NAVIGATION_EVENT_NAME,
    installed: true,
  };
})(globalThis);
