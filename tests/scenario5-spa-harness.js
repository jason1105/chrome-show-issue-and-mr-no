'use strict';

// Scenario 5 harness: SPA route changes must not break the badge UI.
//
// Skeleton scope (this MR): page fixture that fakes GitLab SPA navigation via
// history.pushState + DOM swaps, and a pure "change detection" helper that
// diffs two serializeDomTree dumps. Wiring into a real CDP-driven browser
// scenario comes later (needs the 9a baseline; see issue #9 planning).

const { serializeDomTree } = require('./browser-helpers');

// Fixture page source for the SPA routing harness. Served by the fixture
// server, then navigated in-page via pushState like GitLab does.
const SPA_FIXTURE_SOURCE = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>SPA routing fixture</title>
    <style>
      #glr-badge { position: fixed; top: 0; right: 0; z-index: 30; opacity: 1; }
    </style>
  </head>
  <body>
    <div id="glr-badge" class="glr-badge">badge</div>
    <main id="content"><h1>issues list</h1></main>
    <script>
      // GitLab-like SPA navigation: pushState + content swap, no reload.
      window.glrNavigate = function (path, heading) {
        history.pushState({}, '', path);
        document.querySelector('#content h1').textContent = heading;
      };
      window.addEventListener('popstate', function () {
        document.querySelector('#content h1').textContent = 'after popstate';
      });
    </script>
  </body>
</html>`;

// Diffs two dumps produced by serializeDomTree. Returns a list of change
// records: { path, kind: 'added' | 'removed' | 'changed', before, after }.
// Pure function so the contract is unit-testable in Node.
function diffDomDumps(beforeDump, afterDump) {
  const before = new Map((beforeDump || []).map((line) => {
    const node = JSON.parse(line);
    return [node.path, node];
  }));
  const after = new Map((afterDump || []).map((line) => {
    const node = JSON.parse(line);
    return [node.path, node];
  }));

  const changes = [];
  for (const [path, node] of before) {
    if (!after.has(path)) {
      changes.push({ path, kind: 'removed', before: node, after: null });
    } else if (JSON.stringify(after.get(path)) !== JSON.stringify(node)) {
      changes.push({ path, kind: 'changed', before: node, after: after.get(path) });
    }
  }
  for (const [path, node] of after) {
    if (!before.has(path)) {
      changes.push({ path, kind: 'added', before: null, after: node });
    }
  }
  return changes;
}

// Keeps only changes that touch badge nodes — the scenario 5 assertion basis:
// SPA route changes may rewrite page content but must not disturb the badge.
function badgeRelevantChanges(changes, badgeSelector = '#glr-badge') {
  return changes.filter((change) => (
    change.path.includes(badgeSelector)
    || (change.after?.class || change.before?.class || '').includes('glr-badge')
    || (change.before?.attrs?.id === 'glr-badge' || change.after?.attrs?.id === 'glr-badge')
  ));
}

module.exports = {
  SPA_FIXTURE_SOURCE,
  diffDomDumps,
  badgeRelevantChanges,
};
