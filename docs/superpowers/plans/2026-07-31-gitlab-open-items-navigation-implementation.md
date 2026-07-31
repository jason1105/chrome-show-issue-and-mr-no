# GitLab Open Issue/MR Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hover, keyboard, and touch accessible panel that lists every
Open Issue and Open MR in the current GitLab project, highlights the current
item, refreshes on demand, and navigates to other items.

**Architecture:** Extend the existing URL parser with the current origin and
decoded project path. Keep the no-build content-script IIFE and add a small
in-memory navigation state machine that owns same-origin GitLab REST requests,
pagination, a 60-second complete snapshot, rendering, and lifecycle guards.
The existing Shadow DOM host remains the only injected node and continues to
own the independent quick-copy interaction.

**Tech Stack:** Manifest V3 content scripts, browser DOM and Fetch APIs,
GitLab REST API v4, Node.js built-in test runner, WebDriver BiDi, Chrome
DevTools Protocol, Chrome/Chromium 150.

## Global Constraints

- Keep support for `gitlab.com` and arbitrary HTTP/HTTPS self-hosted GitLab.
- Do not add extension permissions, a service worker, persistent storage,
  access tokens, settings, third-party dependencies, or a build step.
- Request only the current origin and use the browser's existing session
  cookies; do not read or persist authentication material.
- List only `state=opened` Issues and Merge Requests for the current project.
- Fetch Issues and MRs concurrently and cache only a complete two-group
  snapshot for 60 seconds.
- Preserve the existing GitHub copy Octicon, tooltip, clipboard fallback, and
  1.5-second green success check behavior.
- Open after 150 ms of trigger hover and close 250 ms after both trigger and
  panel lose hover.
- Keep the current Open item highlighted and non-navigable; do not synthesize
  a row for a current Closed or Merged item.
- Target Chrome 150 and Arc 1.157.1 using Chromium 150.

---

### Task 1: Parse the GitLab project context

**Files:**

- Modify: `tests/parser.test.js`
- Modify: `src/parser.js`

**Interfaces:**

- Consumes: `parseGitLabReference(urlLike: string)` and the existing modern
  and legacy GitLab URL rules.
- Produces: `parseGitLabReference(urlLike)` returning
  `{ origin: string, projectPath: string, kind: 'issue' | 'merge-request',
  iid: string } | null`.

- [ ] **Step 1: Change the expected parser result and add encoding cases**

Update every existing expected result to include `origin` and `projectPath`,
then add focused cases equivalent to:

```js
assert.deepEqual(
  parseGitLabReference(
    'https://git.example.test/platform/frontend/web%20app/-/issues/7',
  ),
  {
    origin: 'https://git.example.test',
    projectPath: 'platform/frontend/web app',
    kind: 'issue',
    iid: '7',
  },
);

assert.equal(
  parseGitLabReference(
    'https://git.example.test/platform/%E0%A4%A/project/-/issues/7',
  ),
  null,
);
```

Also assert that legacy paths return exactly the namespace/project segments
before `issues` or `merge_requests` and that the origin retains a non-default
port.

- [ ] **Step 2: Run the parser tests and observe the contract failure**

Run:

```bash
node --test tests/parser.test.js
```

Expected: FAIL because the parser still returns only `kind` and `iid` and does
not reject malformed project segment escapes.

- [ ] **Step 3: Decode project segments exactly once**

In `parseGitLabReference`, keep the resource-index discovery and validation,
then implement the project extraction with this shape:

```js
const rawProjectSegments = segments.slice(0, resourceIndex - (
  modernSeparatorIndex >= 0 ? 1 : 0
));
let projectSegments;
try {
  projectSegments = rawProjectSegments.map(decodeURIComponent);
} catch {
  return null;
}

return {
  origin: url.origin,
  projectPath: projectSegments.join('/'),
  kind: RESOURCE_KINDS[segments[resourceIndex]],
  iid,
};
```

Retain the minimum two project segments rule, positive IID validation, child
page support, and edit-page rejection.

- [ ] **Step 4: Run parser and complete unit tests**

Run:

```bash
node --test tests/parser.test.js
npm test
```

Expected: both commands PASS; existing content tests continue to work because
they consume `kind` and `iid` from the larger object.

- [ ] **Step 5: Commit the parser contract**

```bash
git add src/parser.js tests/parser.test.js
git commit -m "feat: parse GitLab project context"
```

### Task 2: Add fetch, focus, and DOM support to the content test harness

**Files:**

- Modify: `tests/content.test.js`

**Interfaces:**

- Consumes: the existing `FakeEventTarget`, `FakeNode`, `FakeDocument`, and
  `createHarness(initialUrl, options)` test helpers.
- Produces: `querySelectorAll`, `replaceChildren`, `contains`, `focus`,
  `document.activeElement`, deterministic `Date.now()`, `fetchCalls`, queued
  `fetchResults`, and `jsonResponse(body, options)` for navigation tests.

- [ ] **Step 1: Add harness contract tests through the first menu test**

Add `jsonResponse` and a test that creates a harness with four queued API
responses, focuses the reference trigger, flushes microtasks, and inspects all
rendered rows:

```js
const harness = createHarness(
  'https://gitlab.com/acme/platform/-/issues/15',
  {
    fetchResults: [
      jsonResponse([{ iid: 15, title: 'Current issue', web_url: '.../15' }]),
      jsonResponse([{ iid: 8, title: 'Open MR', web_url: '.../8' }]),
    ],
  },
);

getBadge(harness.document).trigger.dispatchEvent({ type: 'focus' });
await harness.flushMicrotasks();

assert.equal(harness.fetchCalls.length, 2);
assert.equal(getBadge(harness.document).panel.hidden, false);
assert.equal(
  getBadge(harness.document).panel.querySelectorAll('[data-open-item]').length,
  2,
);
```

This test is intentionally red until both the helper extensions and content
implementation exist.

- [ ] **Step 2: Run the focused content test and observe missing helpers**

Run:

```bash
node --test --test-name-pattern="loads Open items" tests/content.test.js
```

Expected: FAIL on absent `jsonResponse`, `trigger`, or `querySelectorAll`.

- [ ] **Step 3: Extend the fake DOM without implementing browser layout**

Implement these exact helper semantics:

```js
querySelectorAll(selector) {
  return this.findAll((node) => matchesSelector(node, selector));
}

replaceChildren(...nodes) {
  for (const child of this.children) child.parentNode = null;
  this.children = [];
  this.append(...nodes);
}

contains(node) {
  return node === this || this.children.some((child) => child.contains(node));
}

focus() {
  this.ownerDocument.activeElement = this;
  this.dispatchEvent({ type: 'focus' });
}
```

Propagate `ownerDocument` from `FakeDocument.createElement`,
`createElementNS`, and `append`. Add `FakeDocument.activeElement = null`.
Support simple tag, `[attr]`, `[attr="value"]`, and `#id` selectors only; no
CSS parser is needed.

Add deterministic clock and fetch queues in `createHarness`:

```js
const fetchCalls = [];
let fetchCall = 0;
const fetch = (url, init) => {
  fetchCalls.push({ url: String(url), init });
  const result = options.fetchResults?.[fetchCall++];
  if (result instanceof Error) return Promise.reject(result);
  return Promise.resolve(result);
};

class FakeDate extends Date {
  static now() { return now; }
}
```

Expose `fetch`, `Date: FakeDate`, `URL`, and an assignment-capable
`location.href` in the VM context. `jsonResponse` must provide `ok`, `status`,
`headers.get('X-Next-Page')`, and async `json()`; allow `json()` rejection and
non-2xx status to be configured.

- [ ] **Step 4: Run the full pre-feature content suite**

Run:

```bash
node --test tests/content.test.js
```

Expected: the original quick-copy and lifecycle tests PASS; only the new menu
test remains red because `src/content.js` has no panel yet.

- [ ] **Step 5: Keep harness work with the first data implementation**

Do not commit a standalone test-only helper change. Include this file in the
Task 3 commit so the commit has a passing behavior-level test.

### Task 3: Fetch, paginate, map, and cache complete project snapshots

**Files:**

- Modify: `tests/content.test.js`
- Modify: `src/content.js`

**Interfaces:**

- Consumes: parser result from Task 1 and test helpers from Task 2.
- Produces these internal content-script functions and data shapes:
  `getProjectKey(reference)`, `buildItemsApiUrl(reference, resource, page)`,
  `buildFallbackWebUrl(reference, kind, iid)`,
  `fetchAllItems(reference, kind)`, `loadOpenItems({ force })`, and complete
  snapshots `{ key, loadedAt, issues, mergeRequests }`.

- [ ] **Step 1: Add request URL, paging, mapping, and cache tests**

Add tests with these assertions:

```js
assert.deepEqual(
  harness.fetchCalls.map(({ url }) => url),
  [
    'https://git.example.test/api/v4/projects/group%2Fsub%20group%2Fapp/issues'
      + '?state=opened&scope=all&order_by=updated_at&sort=desc&per_page=100&page=1',
    'https://git.example.test/api/v4/projects/group%2Fsub%20group%2Fapp/'
      + 'merge_requests?state=opened&scope=all&order_by=updated_at&sort=desc'
      + '&per_page=100&page=1',
  ],
);
```

Configure the Issue first response with `X-Next-Page: 2`, assert the second
Issue page is fetched, and assert each call has
`credentials: 'same-origin'` and `headers.accept: 'application/json'`.
Use numeric API `iid` values and assert rendered/cached references use strings.
Omit one `web_url` and assert its link is
`<origin>/<projectPath>/-/issues/<iid>`.

Open, close, and reopen the panel within 59,999 ms; assert the fetch count does
not increase. Advance to 60,000 ms, reopen, and assert both resource requests
run while the old rows remain rendered.

- [ ] **Step 2: Run data-layer tests and verify they fail**

Run:

```bash
node --test --test-name-pattern="API|pagination|cache" tests/content.test.js
```

Expected: FAIL because no Open-item requests or cache exist.

- [ ] **Step 3: Add navigation state and API helpers**

Add constants and one-project state near the existing lifecycle state:

```js
const CACHE_DURATION_MS = 60000;
const navigation = {
  reference: null,
  projectKey: null,
  open: false,
  loading: false,
  issues: null,
  mergeRequests: null,
  errors: { issues: false, mergeRequests: false },
  message: '',
  cache: null,
  requestGeneration: 0,
};
```

Build each API URL by applying `encodeURIComponent` once to the complete
decoded `projectPath`. Fetch page 1 with the exact query order from the test,
read `X-Next-Page`, validate it with `/^[1-9][0-9]*$/`, and continue until the
header is empty. Treat a non-2xx response, non-array JSON, JSON rejection, or
any failed page as failure for that resource.

Map each API item to:

```js
{
  kind,
  iid: String(item.iid),
  title: typeof item.title === 'string' ? item.title : '',
  webUrl: typeof item.web_url === 'string' && item.web_url
    ? item.web_url
    : buildFallbackWebUrl(reference, kind, item.iid),
}
```

Reject an item whose IID is not a positive integer. Run Issue and MR loaders
with `Promise.allSettled` so one failure does not hide the other result.

- [ ] **Step 4: Implement complete snapshot and stale-data behavior**

When both groups succeed, set both arrays and cache exactly one snapshot with
`loadedAt: Date.now()`. When either group fails without a cache, expose the
successful group, set the failed group to `null`, and do not create a cache.
When either group fails while a complete snapshot is displayed, preserve both
old arrays and set `message` to `刷新失败，显示上次结果`.

Guard every async completion with the captured `requestGeneration`, project
key, current host, and `destroyed`. An existing in-flight request must be
returned instead of starting duplicate requests unless `{ force: true }`
starts a newer generation.

- [ ] **Step 5: Run all unit tests and commit the data layer**

Run:

```bash
npm test
git diff --check
```

Expected: all tests through paging, complete caching, and stale refresh PASS;
no whitespace errors.

```bash
git add src/content.js tests/content.test.js
git commit -m "feat: load open GitLab project items"
```

### Task 4: Render the grouped navigation panel and current item

**Files:**

- Modify: `tests/content.test.js`
- Modify: `src/content.js`

**Interfaces:**

- Consumes: `navigation` state and item arrays from Task 3.
- Produces: `createNavigationPanel()`, `renderNavigationPanel(host)`,
  `[data-reference-trigger]`, `[data-open-items-panel]`,
  `[data-refresh-open-items]`, `[data-open-items-group]`, and
  `[data-open-item]` Shadow DOM elements.

- [ ] **Step 1: Add grouped rendering and semantic tests**

Assert the fixed badge now contains a native trigger button and the unchanged
copy button:

```js
assert.equal(rendered.trigger.tagName, 'BUTTON');
assert.equal(rendered.trigger.getAttribute('type'), 'button');
assert.equal(rendered.trigger.getAttribute('aria-expanded'), 'false');
assert.equal(
  rendered.trigger.getAttribute('aria-controls'),
  'gitlab-open-items-panel',
);
assert.equal(rendered.button.getAttribute('data-copy-text'), '#15');
```

After loading, assert the panel heading is `Open items`, total count is the sum
of both successful groups, Issues precede Merge requests, and each group shows
its own count. Assert a current Issue is a `span` without `href`, has
`aria-current="page"`, displays `当前`, and has a current-state data attribute.
Assert every other row is an `a` with the API/fallback URL. Add a case where
the current IID is absent and verify no row is fabricated.

Add empty, initial loading, and partial-error tests. The failed group must say
`无法加载`; a successful empty group must say `暂无 Open Issue` or
`暂无 Open MR`.

- [ ] **Step 2: Run grouped panel tests and verify failure**

Run:

```bash
node --test --test-name-pattern="panel|current|empty|partial" \
  tests/content.test.js
```

Expected: FAIL because the host has no trigger or grouped panel DOM.

- [ ] **Step 3: Replace the passive label with a trigger button**

Create a `button[type="button"]` with `data-reference-trigger`, preserve the
visible `Issue #iid` or `MR !iid` text in its child
`[data-reference-label]`, and set `aria-expanded`, `aria-controls`, and an
accessible label describing the Open-item list. Keep the copy button as its
independent sibling. Do not add a down-arrow icon.

The host remains `pointer-events: none`; set the trigger, copy button, panel,
links, and refresh button to `pointer-events: auto`. The badge keeps 6 px
corners and the existing kind colors. Give the trigger the left two corners
and copy button the right two corners.

- [ ] **Step 4: Render the A-layout panel from state**

Create the panel once, position it below and left-aligned with the trigger,
and toggle its `hidden` property rather than recreating the host. Render:

```text
Open items <total>                         [refresh icon] 刷新列表
<optional refresh error>
Issues <count>
#15 Current issue                                      当前
#18 Another issue
Merge requests <count>
!8 Open MR
```

Use `textContent` for all API titles. Use native anchors for navigable rows and
native spans for current rows. Set refresh `aria-busy` from `navigation.loading`.
Keep old rows during a refresh, and use group-level loading placeholders only
when there is no existing complete snapshot.

Add restrained light and dark styles: white/dark-neutral surface, 1 px border,
8 px or smaller radius, 380 px width constrained by the viewport, internal
scrolling with viewport-constrained max height, one-line title ellipsis, green
Issue references, purple MR references, and a pale-blue current row with a
left accent. Include a visible focus style for all native controls and links.

- [ ] **Step 5: Run unit tests and commit panel rendering**

Run:

```bash
npm test
git diff --check
```

Expected: all parser, quick-copy, grouped panel, state, and manifest tests PASS.

```bash
git add src/content.js tests/content.test.js
git commit -m "feat: render open items navigation"
```

### Task 5: Complete hover, keyboard, touch, refresh, and SPA lifecycle

**Files:**

- Modify: `tests/content.test.js`
- Modify: `src/content.js`

**Interfaces:**

- Consumes: trigger and panel DOM from Task 4 and `loadOpenItems({ force })`
  from Task 3.
- Produces: `openNavigation()`, `closeNavigation()`,
  `scheduleNavigationOpen()`, `scheduleNavigationClose()`, independent hover
  timers, manual refresh, outside-click handling, focus handling, and request
  invalidation during navigation and destruction.

- [ ] **Step 1: Add mouse timing and refresh tests**

Dispatch `mouseenter` on the trigger and assert the panel remains hidden at
149 ms and opens at 150 ms. Dispatch `mouseleave`, assert it remains open at
249 ms and closes at 250 ms. Entering the panel during the close delay must
cancel closing; leaving the trigger and entering the copy button must also
keep an already open panel visible.

Load an initial snapshot, click `[data-refresh-open-items]`, and assert:

```js
assert.equal(refresh.getAttribute('aria-busy'), 'true');
assert.equal(rendered.panel.querySelectorAll('[data-open-item]').length, 2);
assert.equal(harness.fetchCalls.length, 4);
```

After successful refresh, assert new rows replace old rows. After one-group
failure, assert old rows remain and the panel displays
`刷新失败，显示上次结果`. During initial partial failure, click refresh and
assert both groups retry and can establish the first complete cache.

- [ ] **Step 2: Add keyboard, touch, and outside-click tests**

Use trigger focus to open and fetch. Dispatch `keydown` with `Escape` from the
panel and assert it closes, `aria-expanded` becomes `false`, and
`document.activeElement` is the trigger. Dispatch Enter/Space while closed and
assert it opens; while open these keys do not close it.

Dispatch a trigger click with `pointerType: 'touch'` twice and assert it toggles
open then closed. Dispatch document `pointerdown` with a node outside the host
and assert the panel closes. Clicking the copy button must copy without opening
or closing the panel.

Dispatch focus transitions whose `relatedTarget` stays inside the Shadow DOM
and assert the panel remains open; a related target outside the host closes it.

- [ ] **Step 3: Add stale-request and project navigation tests**

Start deferred Project A requests, SPA-navigate to Project B, open its panel,
resolve B, then resolve A. Assert only B rows render and its snapshot is used.
SPA-navigate between two items in the same project and assert no new request is
made within 60 seconds while the current-row marker moves. Navigate to a list
page or call `destroy()`, resolve pending requests, and assert the host remains
absent.

- [ ] **Step 4: Run interaction tests and verify failure**

Run:

```bash
node --test --test-name-pattern="hover|refresh|Escape|touch|stale project" \
  tests/content.test.js
```

Expected: FAIL until the interaction handlers and lifecycle invalidation are
implemented.

- [ ] **Step 5: Implement interaction timers and focus containment**

Use separate open and close timer IDs. `openNavigation()` must clear both
timers, show the panel, update `aria-expanded`, render immediately, and call
`loadOpenItems({ force: false })`. `closeNavigation()` must clear timers, hide
the panel, update `aria-expanded`, and leave a complete snapshot available.

Attach trigger `mouseenter`, `mouseleave`, `focus`, `keydown`, and `click`
handlers; panel `mouseenter`, `mouseleave`, and `keydown` handlers; and Shadow
DOM `focusout` containment handling. The touch click path toggles; mouse and
keyboard activation open a closed panel but do not close an open panel.
Escape closes and calls `trigger.focus()`.

Attach one document `pointerdown` listener at initialization. Close only when
the target is outside the injected host. Remove it in `destroy()`.

- [ ] **Step 6: Implement refresh and lifecycle generations**

The refresh click must stop propagation, keep the panel open, and call
`loadOpenItems({ force: true })`. Ignore clicks while a force refresh is
already the latest active request.

On same-project SPA sync, retain the complete snapshot, update
`navigation.reference`, and rerender the current marker. On project-key change,
increment `requestGeneration`, clear timers and cache, reset group states, and
close the panel. On list-page navigation or `destroy()`, also invalidate all
requests and remove document listeners.

- [ ] **Step 7: Run the full unit suite and commit interactions**

Run:

```bash
npm test
git diff --check
```

Expected: all unit/static tests PASS, including delayed responses completing
out of order.

```bash
git add src/content.js tests/content.test.js
git commit -m "feat: add open items panel interactions"
```

### Task 6: Verify the full workflow in real Chromium

**Files:**

- Modify: `tests/browser.test.js`

**Interfaces:**

- Consumes: the packaged content scripts from Tasks 1-5 and existing local
  HTTP fixture/WebDriver BiDi/CDP infrastructure.
- Produces: deterministic REST API fixtures, request counters, and a real
  browser scenario covering hover, current item, refresh, copy, keyboard, and
  current-tab navigation.

- [ ] **Step 1: Make the fixture server emulate GitLab REST endpoints**

Route the two encoded project API paths before the HTML fallback. Return
opened fixture data with `content-type: application/json`, `X-Next-Page`, and
request counters:

```js
const issues = [
  { iid: 123, title: 'Current issue', web_url: `${origin}/acme/platform/-/issues/123` },
  { iid: 124, title: 'Next issue', web_url: `${origin}/acme/platform/-/issues/124` },
];
const mergeRequests = [
  { iid: 456, title: 'Open MR', web_url: `${origin}/acme/platform/-/merge_requests/456` },
];
```

Because `origin` is known only after listen, create response objects inside
the request callback from the server address. Expose counters to the test and
make the second request return a distinguishable refreshed title.

- [ ] **Step 2: Replace the passive-label pointer test with menu assertions**

The reference region is now intentionally interactive. Use real CDP mouse
movement over its center, wait at least 150 ms, and assert the panel is visible,
has `Open items`, Issues before Merge requests, three rows, and a current Issue
row without an anchor. Confirm the copy button still has an independent hit
target and copies `#123` with the green check.

- [ ] **Step 3: Exercise refresh, keyboard, and current-tab navigation**

Click the refresh button with real mouse events. While the response is pending,
assert old rows remain and `aria-busy="true"`; after completion assert the
refreshed title and incremented API counters.

Focus the trigger with `Runtime.evaluate`, send Escape with
`Input.dispatchKeyEvent`, and assert the panel hides and focus returns to the
trigger. Reopen it, click the non-current MR anchor, and assert the same page
target navigates to `/acme/platform/-/merge_requests/456`; after SPA/full page
load, open the panel and assert MR `!456` is now the non-link current row.

- [ ] **Step 4: Run the real Chromium scenario**

Run:

```bash
npm run test:browser
```

Expected: one complete browser scenario PASS; the extension is installed by
BiDi, all API requests stay on the fixture origin, and cleanup removes the
extension, WebDriver session, ChromeDriver, server, and temporary profile.

- [ ] **Step 5: Commit browser coverage**

```bash
git add tests/browser.test.js
git commit -m "test: verify open items navigation in Chromium"
```

### Task 7: Update user and testing documentation, then verify delivery

**Files:**

- Modify: `README.md`
- Modify: `docs/testing.md`
- Verify: `manifest.json`
- Verify: `docs/superpowers/specs/2026-07-31-gitlab-open-items-navigation-design.md`

**Interfaces:**

- Consumes: final UI behavior, API/cache behavior, test counts, and commands.
- Produces: accurate installation/privacy documentation and an auditable test
  matrix without changing the extension permission model.

- [ ] **Step 1: Update README behavior and privacy statements**

Document that hovering/focusing the number opens current-project Open Issues
and Open MRs, current items are highlighted and disabled, other rows navigate
in the same tab, and “刷新列表” bypasses a 60-second in-memory cache.

Replace the obsolete “不发起网络请求” statement with the exact boundary:
same-origin GitLab API v4 requests use the current logged-in session, only
`iid`, `title`, and `web_url` are retained in memory, no token/authentication
data is read or stored, and no new extension permission is required. Link the
new design and implementation plan from the development section.

- [ ] **Step 2: Update the automated and manual test matrix**

In `docs/testing.md`, add API URL/encoding, pagination, complete cache,
partial failure, stale refresh, current-row, hover timing, keyboard/touch,
project switch, and real-browser navigation coverage. Replace old test counts
with the actual values printed by the final commands. Update manual acceptance
for Chrome 150, Arc 1.157.1, logged-in private projects, HTTP self-hosted
GitLab, Closed/Merged current pages, and API failure behavior.

- [ ] **Step 3: Run all final verification commands**

Run:

```bash
npm test
npm run test:browser
markdownlint-cli2 --no-globs README.md docs/testing.md \
  docs/superpowers/specs/2026-07-31-gitlab-open-items-navigation-design.md \
  docs/superpowers/plans/2026-07-31-gitlab-open-items-navigation-implementation.md
git diff --check
git status --short
```

Expected: both test commands PASS, all four Markdown files pass lint, no
whitespace errors exist, and status lists only the intentional documentation
changes.

- [ ] **Step 4: Inspect permissions and final diff**

Run:

```bash
git diff -- manifest.json
git diff --stat
git diff
```

Expected: `manifest.json` has no diff; implementation changes are confined to
the parser, content script, tests, README, testing document, and this plan.
Confirm every requirement in the design spec has a test or an explicit manual
acceptance step.

- [ ] **Step 5: Commit delivery documentation**

```bash
git add README.md docs/testing.md \
  docs/superpowers/plans/2026-07-31-gitlab-open-items-navigation-implementation.md
git commit -m "docs: document open items navigation"
```

- [ ] **Step 6: Re-run release evidence from the committed tree**

Run:

```bash
npm test
npm run test:browser
git status --short --branch
git log --oneline -8
```

Expected: both suites PASS, the working tree is clean, and the recent history
contains separate parser, data, UI, interaction, browser, and documentation
commits.
