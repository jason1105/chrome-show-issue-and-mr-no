(function exposeGitLabReferenceBadgeCss(root, factory) {
  const api = factory(root);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.GitLabReferenceBadgeCss = api;
})(typeof globalThis === 'object' ? globalThis : this, function createBadgeCss(root) {
  const BADGE_CSS = `
      :host {
        /* P0-a color tokens (#11): every color in the badge resolves through a
           --pin-* token. Light values live on this bare :host block (applies to
           every host); the dark palette is scoped to :host([data-theme="dark"])
           below and mirrored by the @media (prefers-color-scheme: dark)
           fallback. Values are byte-identical to the pre-tokenization hex/rgba. */
        --pin-focus-ring: #0969da;
        --pin-focus-ring-width: 2px;
        --pin-bg-surface: #ffffff;
        --pin-bg-field: #ffffff;
        --pin-bg-hover: rgba(31, 41, 55, 0.08);
        --pin-bg-hover-soft: rgba(31, 41, 55, 0.06);
        --pin-bg-pill: rgba(31, 41, 55, 0.1);
        --pin-bg-selected: #ddf4ff;
        --pin-bg-current: #ddf4ff;
        --pin-bg-marker: rgba(9, 105, 218, 0.12);
        --pin-bg-tooltip: #24292f;
        --pin-bg-warning: #fff8c5;
        --pin-surface-pop: #24292f;
        --pin-success-on-pop: #7ee787;
        --pin-empty-title: #1f2328;
        --pin-empty-illustration: #57606a;
        --pin-text-primary: #1f2937;
        --pin-text-input: #24292f;
        --pin-text-hover: #24292f;
        --pin-text-hover-strong: #24292f;
        --pin-text-muted: #6e7781;
        --pin-text-icon: #6e7781;
        --pin-text-secondary: #57606a;
        --pin-text-disabled: #6e7781;
        --pin-text-selected: #0550ae;
        --pin-text-marker: #0550ae;
        --pin-text-success: #0f6d2e;
        --pin-text-issue: #137333;
        --pin-text-mr: #7d4e9e;
        --pin-text-mr-link: #0b5cad;
        --pin-text-warning: #633c01;
        --pin-text-tooltip: #ffffff;
        --pin-border-badge: rgba(31, 41, 55, 0.28);
        --pin-border-field: rgba(31, 41, 55, 0.28);
        --pin-border-panel: rgba(31, 41, 55, 0.24);
        --pin-border-filters: rgba(31, 41, 55, 0.24);
        --pin-border-edge: rgba(31, 41, 55, 0.2);
        --pin-border-filter-inner: rgba(31, 41, 55, 0.18);
        --pin-border-header: rgba(31, 41, 55, 0.14);
        --pin-border-divider: rgba(31, 41, 55, 0.12);
        --pin-border-current: #0969da;
        --pin-border-warning: #d4a72c;
        --pin-border-mr: rgba(31, 111, 235, 0.42);
        --pin-shadow-badge: rgba(17, 24, 39, 0.2);
        --pin-shadow-panel: rgba(17, 24, 39, 0.22);
        --pin-shadow-tooltip: rgba(17, 24, 39, 0.25);
      }

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
        border: 1px solid var(--pin-border-badge);
        border-radius: 6px;
        background: var(--pin-bg-surface);
        box-shadow: 0 2px 8px var(--pin-shadow-badge);
        color: var(--pin-text-primary);
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
        border-right: 1px solid var(--pin-border-edge);
        border-radius: 5px 0 0 5px;
        background: transparent;
        color: var(--pin-text-icon);
        cursor: grab;
        pointer-events: auto;
        touch-action: none;
        appearance: none;
      }

      :host([data-touch-drag="false"]) [data-drag-handle] {
        touch-action: auto;
      }

      [data-drag-handle]:hover {
        background: var(--pin-bg-hover);
        color: var(--pin-text-hover);
      }

      [data-drag-handle]:focus-visible {
        outline: var(--pin-focus-ring-width) solid var(--pin-focus-ring);
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
        background: var(--pin-bg-tooltip);
        box-shadow: 0 2px 8px var(--pin-shadow-tooltip);
        color: var(--pin-text-tooltip);
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
        background: var(--pin-bg-hover);
      }

      [data-reference-trigger]:focus-visible {
        outline: var(--pin-focus-ring-width) solid var(--pin-focus-ring);
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
        border: 1px solid var(--pin-border-panel);
        border-radius: 7px;
        background: var(--pin-bg-surface);
        box-shadow: 0 8px 24px var(--pin-shadow-panel);
        color: var(--pin-text-primary);
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
        border-bottom: 1px solid var(--pin-border-header);
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
        color: var(--pin-text-muted);
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
        background: var(--pin-bg-pill);
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
        color: var(--pin-text-secondary);
        font: 500 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        pointer-events: auto;
        appearance: none;
      }

      [data-refresh-open-items]:hover {
        background: var(--pin-bg-hover);
        color: var(--pin-text-hover-strong);
      }

      [data-refresh-open-items]:focus-visible,
      [data-open-item]:focus-visible,
      [data-open-items-load-more]:focus-visible {
        outline: var(--pin-focus-ring-width) solid var(--pin-focus-ring);
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
        border-bottom: 1px solid var(--pin-border-divider);
        background: inherit;
      }

      [data-open-items-search] {
        box-sizing: border-box;
        flex: 1 1 auto;
        min-width: 0;
        height: 30px;
        margin: 0;
        padding: 5px 9px;
        border: 1px solid var(--pin-border-field);
        border-radius: 6px;
        background: var(--pin-bg-field);
        color: var(--pin-text-input);
        font: 400 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        appearance: auto;
      }

      [data-open-items-search]::placeholder {
        color: var(--pin-text-icon);
        opacity: 1;
      }

      [data-open-items-search]:focus {
        border-color: var(--pin-focus-ring);
        box-shadow: 0 0 0 1px var(--pin-focus-ring);
        outline: none;
      }

      [data-open-items-filters] {
        box-sizing: border-box;
        display: inline-flex;
        flex: 0 0 auto;
        overflow: hidden;
        border: 1px solid var(--pin-border-filters);
        border-radius: 6px;
      }

      [data-open-items-filter] {
        box-sizing: border-box;
        min-height: 28px;
        margin: 0;
        padding: 4px 8px;
        border: 0;
        border-left: 1px solid var(--pin-border-filter-inner);
        border-radius: 0;
        background: var(--pin-bg-surface);
        color: var(--pin-text-secondary);
        font: 500 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        appearance: none;
      }

      [data-open-items-filter]:first-child {
        border-left: 0;
      }

      [data-open-items-filter]:hover {
        background: var(--pin-bg-hover-soft);
        color: var(--pin-text-hover-strong);
      }

      [data-open-items-filter][aria-pressed="true"] {
        background: var(--pin-bg-selected);
        color: var(--pin-text-selected);
      }

      [data-open-items-filter]:focus-visible {
        position: relative;
        z-index: 1;
        outline: var(--pin-focus-ring-width) solid var(--pin-focus-ring);
        outline-offset: -2px;
      }

      [data-item-state-controls] {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 7px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--pin-border-divider);
        background: inherit;
      }

      [data-item-state-label] {
        color: var(--pin-text-secondary);
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
        color: var(--pin-text-secondary);
        cursor: pointer;
        pointer-events: auto;
        appearance: none;
      }

      [data-open-options]:hover {
        background: var(--pin-bg-hover);
        color: var(--pin-text-hover-strong);
      }

      [data-open-options]:focus-visible {
        outline: var(--pin-focus-ring-width) solid var(--pin-focus-ring);
        outline-offset: -2px;
      }

      [data-open-items-message] {
        margin: 8px 10px 2px;
        padding: 7px 9px;
        border: 1px solid var(--pin-border-warning);
        border-radius: 5px;
        background: var(--pin-bg-warning);
        color: var(--pin-text-warning);
        font-size: 12px;
      }

      [data-open-items-group] {
        display: block;
        padding: 7px 0;
      }

      [data-open-items-group] + [data-open-items-group] {
        border-top: 1px solid var(--pin-border-divider);
      }

      [data-open-items-group-heading] {
        padding: 3px 12px 6px;
        color: var(--pin-text-secondary);
        font-size: 12px;
      }

      [data-open-items-status] {
        padding: 9px 12px 10px;
        color: var(--pin-text-muted);
        font-size: 12px;
      }

      /* #11 P1 empty state (spec §3): centered flex column with a decorative
         illustration, a 500-weight primary title, an optional muted helper, and
         at most one action button reusing the filter affordance. */
      [data-open-items-empty] {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 120px;
        padding: 24px 16px;
        text-align: center;
      }

      [data-open-items-empty-icon] {
        display: block;
        flex: none;
        color: var(--pin-empty-illustration);
      }

      [data-open-items-empty-title] {
        color: var(--pin-empty-title);
        font-size: 14px;
        line-height: 20px;
        font-weight: 500;
      }

      [data-open-items-empty-hint] {
        color: var(--pin-text-muted);
        font-size: 12px;
        line-height: 18px;
      }

      [data-open-items-empty-action] {
        box-sizing: border-box;
        min-height: 28px;
        margin: 4px 0 0;
        padding: 4px 10px;
        border: 1px solid var(--pin-border-filter-inner);
        border-radius: 6px;
        background: var(--pin-bg-surface);
        color: var(--pin-text-secondary);
        font: 500 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        appearance: none;
      }

      [data-open-items-empty-action]:hover {
        background: var(--pin-bg-hover-soft);
        color: var(--pin-text-hover-strong);
      }

      [data-open-items-empty-action]:focus-visible {
        position: relative;
        z-index: 1;
        outline: var(--pin-focus-ring-width) solid var(--pin-focus-ring);
        outline-offset: -2px;
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
        background: var(--pin-bg-hover-soft);
      }

      [data-open-item-iid] {
        font-weight: 600;
        color: var(--pin-text-issue);
      }

      [data-open-item][data-kind="merge-request"] [data-open-item-iid] {
        color: var(--pin-text-mr);
      }

      [data-open-item][data-item-state] [data-open-item-title] {
        color: var(--pin-text-disabled);
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
        border-left-color: var(--pin-border-current);
        background: var(--pin-bg-current);
        color: var(--pin-text-hover-strong);
      }

      [data-current-marker] {
        padding: 1px 6px;
        border-radius: 9px;
        background: var(--pin-bg-marker);
        color: var(--pin-text-marker);
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
        border-left: 1px solid var(--pin-border-edge);
        border-radius: 0 5px 5px 0;
        background: transparent;
        color: currentColor;
        font: inherit;
        cursor: pointer;
        pointer-events: auto;
        appearance: none;
      }

      [data-copy-reference]:hover {
        background: var(--pin-bg-hover);
      }

      [data-copy-reference]:focus-visible {
        outline: var(--pin-focus-ring-width) solid var(--pin-focus-ring);
        outline-offset: -2px;
      }

      [data-copy-reference][data-copy-state="success"],
      [data-copy-reference][data-copy-state="success"]:hover {
        color: var(--pin-text-success);
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
        background: var(--pin-bg-tooltip);
        box-shadow: 0 2px 8px var(--pin-shadow-tooltip);
        color: var(--pin-text-tooltip);
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

      /* #11 P1 copy-success toast (spec §4): anchored under the copy button
         like the tooltip, but stacked above it (z-index 3, higher than the
         panel header's z-index 2 so the toast stays visible while the panel
         is open — the #43 follow-up overlap fix). It is mutually
         exclusive with the tooltip while visible — the suppression rules below
         come after the hover/focus reveal so they win at equal specificity.
         Scoped to the direct child span: the button itself carries
         [data-copy-toast] as the on/leaving STATE attribute (content.js), so a
         bare selector would hide the button and its whole subtree (the #43
         empty-toast regression). */
      [data-copy-reference] > [data-copy-toast] {
        box-sizing: border-box;
        position: absolute;
        top: calc(100% + 7px);
        right: -5px;
        z-index: 3;
        display: flex;
        align-items: center;
        gap: 5px;
        max-width: 240px;
        padding: 7px 11px;
        border-radius: 6px;
        background: var(--pin-surface-pop);
        box-shadow: 0 2px 8px var(--pin-shadow-tooltip);
        color: #ffffff;
        font: 600 12px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        white-space: nowrap;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-2px);
        transition: opacity 150ms ease, transform 150ms ease, visibility 150ms ease;
        pointer-events: none;
      }

      [data-copy-toast-icon] {
        display: block;
        flex: none;
        color: var(--pin-success-on-pop);
      }

      [data-copy-reference][data-copy-toast="on"] [data-copy-toast] {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      /* Fade-out: same spot, so a repeated copy replaces the toast in place. */
      [data-copy-reference][data-copy-toast="leaving"] [data-copy-toast] {
        opacity: 0;
        transform: translateY(-2px);
      }

      [data-copy-reference][data-copy-toast="on"] [data-copy-tooltip],
      [data-copy-reference][data-copy-toast="leaving"] [data-copy-tooltip] {
        opacity: 0;
        visibility: hidden;
        transform: translateY(-2px);
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
        border-color: var(--pin-border-mr);
        color: var(--pin-text-mr-link);
      }

      /* Dark fallback for OS preference: when the OS reports dark but the host
         attribute is absent, flip the token values to the dark palette on the
         bare :host. This mirrors the old per-element dark overrides exactly
         (later in source than the light :host defaults, so it wins when the
         media query matches). */
      @media (prefers-color-scheme: dark) {
        :host {
          --pin-focus-ring: #58a6ff;
          --pin-bg-surface: #24272d;
          --pin-bg-field: #1f2227;
          --pin-bg-hover: rgba(255, 255, 255, 0.1);
          --pin-bg-hover-soft: rgba(255, 255, 255, 0.08);
          --pin-bg-pill: rgba(255, 255, 255, 0.12);
          --pin-bg-selected: rgba(9, 105, 218, 0.28);
          --pin-bg-current: rgba(9, 105, 218, 0.24);
          --pin-bg-warning: #4d2d00;
          --pin-surface-pop: #1f2227;
          --pin-success-on-pop: #7ee787;
          --pin-empty-title: #f0f6fc;
          --pin-empty-illustration: #8b949e;
          --pin-text-primary: #f0f2f5;
          --pin-text-input: #f0f2f5;
          --pin-text-hover: #f0f2f5;
          --pin-text-hover-strong: #ffffff;
          --pin-text-muted: #b7bdc8;
          --pin-text-icon: #8b949e;
          --pin-text-secondary: #b7bdc8;
          --pin-text-selected: #79c0ff;
          --pin-text-issue: #56d364;
          --pin-text-mr: #d2a8ff;
          --pin-text-mr-link: #9ac1ff;
          --pin-text-warning: #ffd18a;
          --pin-border-badge: rgba(255, 255, 255, 0.25);
          --pin-border-field: rgba(255, 255, 255, 0.26);
          --pin-border-panel: rgba(255, 255, 255, 0.2);
          --pin-border-filters: rgba(255, 255, 255, 0.24);
          --pin-border-edge: rgba(255, 255, 255, 0.2);
          --pin-border-filter-inner: rgba(255, 255, 255, 0.16);
          --pin-border-header: rgba(255, 255, 255, 0.14);
          --pin-border-divider: rgba(255, 255, 255, 0.14);
          --pin-border-warning: #9e6a03;
          --pin-border-mr: rgba(117, 170, 255, 0.55);
          --pin-shadow-badge: rgba(0, 0, 0, 0.45);
          --pin-shadow-panel: rgba(0, 0, 0, 0.5);
        }
      }

      /* #24 B2: consume the host's data-theme so the badge follows GitLab's own
         theme (dark when GitLab is dark), not the OS preference. The content
         script drives the host attribute; dark is consumed here, while light
         and the no-attribute fallback are handled by the merged base :host
         selector above (:host, :host([data-theme="light"]),
         :host(:not([data-theme]))). Dark is expressed as token overrides so
         the light rules resolve to the dark palette without per-element dark
         rules. This block has higher specificity than the :host defaults, so
         it wins for data-theme="dark" hosts in every OS scheme. */
      :host([data-theme="dark"]) {
        --pin-focus-ring: #58a6ff;
        --pin-bg-surface: #24272d;
        --pin-bg-field: #1f2227;
        --pin-bg-hover: rgba(255, 255, 255, 0.1);
        --pin-bg-hover-soft: rgba(255, 255, 255, 0.08);
        --pin-bg-pill: rgba(255, 255, 255, 0.12);
        --pin-bg-selected: rgba(9, 105, 218, 0.28);
        --pin-bg-current: rgba(9, 105, 218, 0.24);
        --pin-bg-warning: #4d2d00;
        --pin-surface-pop: #1f2227;
        --pin-success-on-pop: #7ee787;
        --pin-empty-title: #f0f6fc;
        --pin-empty-illustration: #8b949e;
        --pin-text-primary: #f0f2f5;
        --pin-text-input: #f0f2f5;
        --pin-text-hover: #f0f2f5;
        --pin-text-hover-strong: #ffffff;
        --pin-text-muted: #b7bdc8;
        --pin-text-icon: #8b949e;
        --pin-text-secondary: #b7bdc8;
        --pin-text-selected: #79c0ff;
        --pin-text-issue: #56d364;
        --pin-text-mr: #d2a8ff;
        --pin-text-mr-link: #9ac1ff;
        --pin-text-warning: #ffd18a;
        --pin-border-badge: rgba(255, 255, 255, 0.25);
        --pin-border-field: rgba(255, 255, 255, 0.26);
        --pin-border-panel: rgba(255, 255, 255, 0.2);
        --pin-border-filters: rgba(255, 255, 255, 0.24);
        --pin-border-edge: rgba(255, 255, 255, 0.2);
        --pin-border-filter-inner: rgba(255, 255, 255, 0.16);
        --pin-border-header: rgba(255, 255, 255, 0.14);
        --pin-border-divider: rgba(255, 255, 255, 0.14);
        --pin-border-warning: #9e6a03;
        --pin-border-mr: rgba(117, 170, 255, 0.55);
        --pin-shadow-badge: rgba(0, 0, 0, 0.45);
        --pin-shadow-panel: rgba(0, 0, 0, 0.5);
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

      /* #11 P1 reduced motion (spec §5): the toast is the only animated
         surface. Under prefers-reduced-motion, kill its transform/transition
         so it shows and hides instantly (no displacement, no fade). */
      @media (prefers-reduced-motion: reduce) {
        [data-copy-tooltip],
        [data-copy-reference] > [data-copy-toast] {
          transition: none;
          transform: none;
        }
      }
  `;
  return {
    BADGE_CSS,
  };
});
