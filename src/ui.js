(function exposeGitLabReferenceUi(root, factory) {
  const api = factory(root);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.GitLabReferenceUi = api;
})(typeof globalThis === 'object' ? globalThis : this, function createUi(root) {
  const COPY_ICON_PATHS = [
    'M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z',
    'M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z',
  ];
  const SUCCESS_ICON_PATHS = [
    'M13.78 4.22a.75.75 0 0 1 0 1.06l-6.25 6.25a.75.75 0 0 1-1.06 0L3.22 8.28a.75.75 0 0 1 1.06-1.06L7 9.94l5.72-5.72a.75.75 0 0 1 1.06 0Z',
  ];

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

  function createSettingsIcon() {
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
      'M8 0a1.75 1.75 0 0 1 1.7 1.33l.12.55c.16.06.32.13.47.21l.48-.29a1.75 1.75 0 0 1 2.13.18l.13.13c.56.56.62 1.44.18 2.13l-.29.48c.08.15.15.31.21.47l.55.12A1.75 1.75 0 0 1 16 8c0 .84-.59 1.56-1.42 1.7l-.55.12c-.06.16-.13.32-.21.47l.29.48c.44.69.38 1.57-.18 2.13l-.13.13a1.75 1.75 0 0 1-2.13.18l-.48-.29c-.15.08-.31.15-.47.21l-.12.55A1.75 1.75 0 0 1 8 16c-.84 0-1.56-.59-1.7-1.42l-.12-.55a4.7 4.7 0 0 1-.47-.21l-.48.29a1.75 1.75 0 0 1-2.13-.18l-.13-.13a1.75 1.75 0 0 1-.18-2.13l.29-.48a4.7 4.7 0 0 1-.21-.47l-.55-.12A1.75 1.75 0 0 1 0 8c0-.84.59-1.56 1.42-1.7l.55-.12c.06-.16.13-.32.21-.47l-.29-.48a1.75 1.75 0 0 1 .18-2.13l.13-.13a1.75 1.75 0 0 1 2.13-.18l.48.29c.15-.08.31-.15.47-.21l.12-.55A1.75 1.75 0 0 1 8 0Zm0 5.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5Z',
    );
    icon.append(path);
    return icon;
  }

  return {
    COPY_ICON_PATHS,
    SUCCESS_ICON_PATHS,
    createDragHandleIcon,
    setIcon,
    createIcon,
    createRefreshIcon,
    createSettingsIcon,
  };
});
