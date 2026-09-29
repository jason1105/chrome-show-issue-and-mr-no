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

  // GitLab routes everything after the project path behind a "/-/" separator
  // (/-/tree/main, /-/commits/main, ...). The project path is therefore every
  // segment before the first "-". Without a separator the URL can only be a
  // project homepage (or its 302 predecessor): modern GitLab group routes
  // always carry the reserved "/groups/" prefix, so any prefix-less path here
  // is a project's full nested namespace. Mirrors parseGitLabReference's
  // project end.
  function resolveProjectPathSegments(segments) {
    const separatorIndex = segments.indexOf('-');
    if (separatorIndex >= 0) {
      return separatorIndex >= 2 ? segments.slice(0, separatorIndex) : null;
    }
    return segments;
  }

  // Recognizes any GitLab project page URL (repository tree, CI/CD, wiki, ...)
  // and returns the project coordinates. Deliberately decoupled from
  // parseGitLabReference: it only needs the project path, which ends at the
  // "/-/" route separator when one is present.
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

    const projectSegments = resolveProjectPathSegments(segments);
    if (!projectSegments) return null;

    let decoded;
    try {
      decoded = projectSegments.map(decodeURIComponent);
    } catch {
      return null;
    }

    return {
      origin: url.origin,
      projectPath: decoded.join('/'),
    };
  }

  return { parseGitLabReference, parseGitLabProjectPage };
});
