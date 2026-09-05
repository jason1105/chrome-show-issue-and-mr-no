(function exposeGitLabReferenceBadgeCss(root, factory) {
  const api = factory(root);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.GitLabReferenceBadgeCss = api;
})(typeof globalThis === 'object' ? globalThis : this, function createBadgeCss(root) {
  const BADGE_CSS = `
      :host,
      :host([data-theme="light"]),
      :host(:not([data-theme])) {
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

      [data-item-state-controls] {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 7px;
        padding: 6px 10px;
        border-bottom: 1px solid rgba(31, 41, 55, 0.12);
        background: inherit;
      }

      [data-item-state-label] {
        color: #57606a;
        font-size: 12px;
      }

      [data-item-state-controls] [data-open-items-filter] {
        min-height: 26px;
        padding: 3px 9px;
        font-size: 11px;
      }

      [data-open-options] {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: #57606a;
        cursor: pointer;
        pointer-events: auto;
        appearance: none;
      }

      [data-open-options]:hover {
        background: rgba(31, 41, 55, 0.08);
        color: #24292f;
      }

      [data-open-options]:focus-visible {
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

      [data-open-item][data-item-state] [data-open-item-title] {
        color: #6e7781;
        text-decoration: line-through;
      }

      [data-open-item][data-item-state] [data-open-item-iid] {
        opacity: 0.65;
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

      [data-copy-announcement],
      [data-open-items-search-summary] {
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
        [data-item-state-controls],
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

        [data-refresh-open-items]:hover,
        [data-open-options]:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
        }

        [data-item-state-label] {
          color: #b7bdc8;
        }

        [data-open-options] {
          color: #b7bdc8;
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

      /* #24 B2: consume the host's data-theme so the badge follows GitLab's own
         theme (dark when GitLab is dark), not the OS preference. The content
         script drives the host attribute; dark is consumed here, while light
         and the no-attribute fallback are handled by the merged base :host
         selector above (:host, :host([data-theme="light"]),
         :host(:not([data-theme]))). The bare :host layout block applies to all
         three, keeping the light theme as the default with no dark flash. */
      :host([data-theme="dark"]) {
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
        [data-item-state-controls],
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

        [data-refresh-open-items]:hover,
        [data-open-options]:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
        }

        [data-item-state-label] {
          color: #b7bdc8;
        }

        [data-open-options] {
          color: #b7bdc8;
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
  return {
    BADGE_CSS,
  };
});
