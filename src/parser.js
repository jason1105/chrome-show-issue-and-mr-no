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

    return {
      kind: RESOURCE_KINDS[segments[resourceIndex]],
      iid,
    };
  }

  return { parseGitLabReference };
});
