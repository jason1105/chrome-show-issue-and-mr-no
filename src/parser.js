(function exposeGitLabReferenceParser(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.GitLabReferenceParser = api;
})(typeof globalThis === 'object' ? globalThis : this, function createParser() {
  const RESOURCE_KINDS = {
    issues: 'issue',
    merge_requests: 'merge-request',
  };

  function parseGitLabReference(urlLike) {
    let url;

    try {
      url = new URL(urlLike);
    } catch {
      return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    const modernSeparatorIndex = segments.findIndex(
      (segment, index) => segment === '-' && RESOURCE_KINDS[segments[index + 1]],
    );

    let resourceIndex;
    if (modernSeparatorIndex >= 0) {
      if (modernSeparatorIndex < 2) {
        return null;
      }
      resourceIndex = modernSeparatorIndex + 1;
    } else {
      resourceIndex = segments.findIndex(
        (segment, index) => index >= 2 && RESOURCE_KINDS[segment],
      );
    }

    if (resourceIndex < 0) {
      return null;
    }

    const iid = segments[resourceIndex + 1];
    const firstChildPage = segments[resourceIndex + 2];
    if (!/^[1-9][0-9]*$/.test(iid || '') || firstChildPage === 'edit') {
      return null;
    }

    const projectEndIndex = modernSeparatorIndex >= 0
      ? modernSeparatorIndex
      : resourceIndex;
    let projectSegments;
    try {
      projectSegments = segments.slice(0, projectEndIndex).map(decodeURIComponent);
    } catch {
      return null;
    }

    return {
      origin: url.origin,
      projectPath: projectSegments.join('/'),
      kind: RESOURCE_KINDS[segments[resourceIndex]],
      iid,
    };
  }

  // Reserved top-level GitLab routes that can never be a project namespace.
  const RESERVED_ROOT_SEGMENTS = new Set([
    '-',
    'api',
    'users',
    'groups',
    'dashboard',
    'admin',
    'explore',
    'projects',
    'profile',
    'search',
    'settings',
    'help',
    'public',
  ]);

  // Recognizes any GitLab project page URL (repository tree, CI/CD, wiki, ...)
  // and returns the project coordinates. Deliberately decoupled from
  // parseGitLabReference: it only needs the "group/project" prefix, which is
  // always the first two path segments.
  function parseGitLabProjectPage(urlLike) {
    let url;

    try {
      url = new URL(urlLike);
    } catch {
      return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2) return null;

    if (RESERVED_ROOT_SEGMENTS.has(segments[0])) return null;

    let projectSegments;
    try {
      projectSegments = segments.slice(0, 2).map(decodeURIComponent);
    } catch {
      return null;
    }

    return {
      origin: url.origin,
      projectPath: projectSegments.join('/'),
    };
  }

  return { parseGitLabReference, parseGitLabProjectPage };
});
