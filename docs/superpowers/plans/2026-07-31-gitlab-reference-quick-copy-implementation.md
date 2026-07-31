# GitLab Issue/MR Reference Quick Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub-style, always-visible copy button that copies GitLab Issue references as `#<iid>` and Merge Request references as `!<iid>`.

**Architecture:** Keep the existing fixed Shadow DOM host and split its badge into a passive label plus an interactive native button. The content script owns clipboard fallback, feedback timers, and a generation token that invalidates stale asynchronous results during SPA navigation or destruction.

**Tech Stack:** Manifest V3 content script, plain JavaScript, Node.js built-in test runner, WebDriver BiDi, Chrome DevTools Protocol.

## Global Constraints

- Continue supporting `gitlab.com` and arbitrary HTTP/HTTPS self-hosted GitLab instances.
- Target Chrome 150 and Arc 1.157.1 (Chromium 150).
- Copy Issue references as `#<iid>` and Merge Request references as `!<iid>`.
- Keep the host at `pointer-events: none`; only the copy button uses `pointer-events: auto`.
- Show default tooltip text `复制 #<iid>` or `复制 !<iid>`, success text `已复制`, and failure text `复制失败`.
- Restore default feedback after exactly `1500ms`, with the latest click replacing any older timer.
- Prefer `navigator.clipboard.writeText`; fall back to a temporary text control and `document.execCommand('copy')`.
- Add no permissions, network requests, storage, settings, shortcuts, Toasts, runtime dependencies, or build step.

---

## File Structure

- `src/content.js`: renders the segmented control, performs copy operations, and owns feedback/lifecycle state.
- `tests/content.test.js`: provides a deterministic fake DOM, clipboard, and timer harness for unit behavior.
- `tests/browser.test.js`: validates real Chromium hit testing, tooltip geometry, clipboard content, and SPA reset.
- `README.md`: documents the user-visible copy behavior.
- `docs/testing.md`: records automated coverage and manual acceptance checks.

### Task 1: Unit Harness And Segmented Control Contract

**Files:**
- Modify: `tests/content.test.js`
- Modify: `src/content.js`

**Interfaces:**
- Consumes: `GitLabReferenceParser.parseGitLabReference(url)` from `src/parser.js`.
- Produces: Shadow DOM selectors `[data-reference-badge]`, `[data-reference-label]`, `[data-copy-reference]`, `[data-copy-tooltip]`, `[data-copy-icon]`, and `[data-copy-announcement]`.

- [ ] **Step 1: Extend the fake DOM and write failing render tests**

Add generic attribute selector support, button event dispatch, SVG element creation, textarea selection, clipboard injection, and deterministic timers. Assert that an Issue page renders a passive `Issue #123` label, a native button with `aria-label="复制 #123"`, a tooltip with `复制 #123`, a copy icon, and a separate polite live region.

```js
const rendered = getBadge(createHarness(issueUrl).document);
assert.equal(rendered.label.textContent, 'Issue #123');
assert.equal(rendered.button.tagName, 'BUTTON');
assert.equal(rendered.button.getAttribute('aria-label'), '复制 #123');
assert.equal(rendered.tooltip.textContent, '复制 #123');
assert.equal(rendered.copyIcon.getAttribute('data-copy-icon'), 'copy');
assert.equal(rendered.announcement.getAttribute('aria-live'), 'polite');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern="renders a segmented" tests/content.test.js`

Expected: FAIL because `[data-reference-label]` and `[data-copy-reference]` do not exist.

- [ ] **Step 3: Implement the minimal segmented DOM and styles**

In `createBadgeHost()`, create a passive label, native copy button, copy/check SVG nodes, tooltip, and visually hidden announcement. Keep the host non-interactive and make only `[data-copy-reference]` interactive.

```js
const badge = root.document.createElement('div');
const label = root.document.createElement('span');
const button = root.document.createElement('button');
const tooltip = root.document.createElement('span');
const announcement = root.document.createElement('span');
button.setAttribute('type', 'button');
button.setAttribute('data-copy-reference', '');
```

- [ ] **Step 4: Run the focused test and full unit suite**

Run: `node --test --test-name-pattern="renders a segmented" tests/content.test.js`

Expected: PASS.

Run: `npm test`

Expected: all existing and new tests PASS.

- [ ] **Step 5: Commit the independently testable UI contract**

```bash
git add tests/content.test.js src/content.js
git commit -m "feat: add reference copy control"
```

### Task 2: Clipboard Success, Fallback, And Feedback

**Files:**
- Modify: `tests/content.test.js`
- Modify: `src/content.js`

**Interfaces:**
- Consumes: button attribute `data-copy-text` and the selectors created in Task 1.
- Produces: `copyText(text): Promise<boolean>`, `fallbackCopy(text): boolean`, and feedback states `default`, `success`, and `error` represented by `data-copy-state`.

- [ ] **Step 1: Write failing Issue and MR success tests**

Inject a clipboard writer that records text, click the real fake button, await microtasks, and assert the copied literal, green check state, tooltip, announcement, and `1500ms` reset.

```js
await rendered.button.dispatchEvent({ type: 'click' });
await harness.flushMicrotasks();
assert.deepEqual(harness.clipboardWrites, ['#15']);
assert.equal(rendered.button.getAttribute('data-copy-state'), 'success');
assert.equal(rendered.tooltip.textContent, '已复制');
harness.advanceTimersBy(1500);
assert.equal(rendered.button.getAttribute('data-copy-state'), 'default');
```

- [ ] **Step 2: Run the success tests and verify RED**

Run: `node --test --test-name-pattern="copies an Issue|copies an MR" tests/content.test.js`

Expected: FAIL because clicking the button performs no clipboard operation or feedback transition.

- [ ] **Step 3: Implement Clipboard API success and feedback reset**

Add `formatCopyText(reference)`, an async click handler, `setFeedback(state)`, `clearFeedbackTimer()`, and a `1500ms` reset. Toggle copy/check icons with `hidden`, use `#1f883d` for the successful check, and update the tooltip and live region.

```js
async function copyText(text) {
  try {
    if (typeof root.navigator?.clipboard?.writeText === 'function') {
      await root.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Continue to the HTTP-compatible fallback.
  }
  return fallbackCopy(text);
}
```

- [ ] **Step 4: Write failing fallback and total failure tests**

Cover Clipboard API rejection, missing Clipboard API, `execCommand('copy') === false`, thrown fallback errors, removal of the temporary textarea, and failure feedback without unhandled rejection.

```js
assert.deepEqual(harness.execCommandCalls, ['copy']);
assert.equal(harness.document.querySelector('textarea'), null);
assert.equal(rendered.tooltip.textContent, '复制失败');
assert.equal(rendered.announcement.textContent, '复制失败');
```

- [ ] **Step 5: Run fallback tests and verify RED**

Run: `node --test --test-name-pattern="falls back|reports copy failure" tests/content.test.js`

Expected: FAIL because no temporary control or `execCommand` path exists.

- [ ] **Step 6: Implement the fallback and error containment**

Create a temporary textarea under `document.documentElement`, position it off-screen, set it readonly, select its value, call `document.execCommand('copy')`, catch errors, and always remove it in `finally`.

```js
function fallbackCopy(text) {
  const field = root.document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  root.document.documentElement.append(field);
  try {
    field.select();
    return root.document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
```

- [ ] **Step 7: Run focused and full unit tests**

Run: `node --test tests/content.test.js`

Expected: all content-script tests PASS.

Run: `npm test`

Expected: all project unit/static tests PASS.

- [ ] **Step 8: Commit clipboard behavior**

```bash
git add tests/content.test.js src/content.js
git commit -m "feat: copy GitLab references"
```

### Task 3: Async Lifecycle And Latest-Click Semantics

**Files:**
- Modify: `tests/content.test.js`
- Modify: `src/content.js`

**Interfaces:**
- Consumes: `sync()`, `destroy()`, and feedback helpers from Task 2.
- Produces: monotonically increasing `copyGeneration`, `clearFeedback()`, and stale-result checks around every awaited copy operation.

- [ ] **Step 1: Write failing race and lifecycle tests**

Use deferred Clipboard promises. Verify SPA navigation clears success/error state, an old Issue promise cannot overwrite the new MR state, `destroy()` blocks late updates, and a second click invalidates the first click and replaces its timer.

```js
const first = deferred();
const second = deferred();
const harness = createHarness(issueUrl, { clipboardResults: [first.promise, second.promise] });
button.dispatchEvent({ type: 'click' });
button.dispatchEvent({ type: 'click' });
second.resolve();
await harness.flushMicrotasks();
first.reject(new Error('late failure'));
await harness.flushMicrotasks();
assert.equal(button.getAttribute('data-copy-state'), 'success');
```

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run: `node --test --test-name-pattern="stale|latest copy|destroy" tests/content.test.js`

Expected: FAIL because old asynchronous work can still update current feedback.

- [ ] **Step 3: Implement generation invalidation and cleanup**

Increment `copyGeneration` on every click, every `sync()`, every badge removal, and `destroy()`. Capture the generation and host before awaiting; only apply feedback when both still match. Clear old timers whenever a new click or synchronization begins.

```js
const generation = ++copyGeneration;
const host = root.document.getElementById(HOST_ID);
const copied = await copyText(text);
if (destroyed || generation !== copyGeneration || host !== root.document.getElementById(HOST_ID)) {
  return;
}
setFeedback(copied ? 'success' : 'error');
```

- [ ] **Step 4: Run content and full unit suites**

Run: `node --test tests/content.test.js`

Expected: all content-script tests PASS.

Run: `npm test`

Expected: all project unit/static tests PASS.

- [ ] **Step 5: Commit lifecycle protection**

```bash
git add tests/content.test.js src/content.js
git commit -m "fix: isolate copy feedback across navigation"
```

### Task 4: Real Chromium Interaction Coverage

**Files:**
- Modify: `tests/browser.test.js`

**Interfaces:**
- Consumes: all Shadow DOM selectors and feedback attributes from Tasks 1-3.
- Produces: one end-to-end scenario covering hit testing, hover tooltip geometry, clipboard data, success icon, reset on SPA navigation, and badge removal.

- [ ] **Step 1: Write the browser assertions before relying on them**

Grant clipboard permissions for the local fixture origin through CDP, compute separate centers for `[data-reference-label]` and `[data-copy-reference]`, click each with `Input.dispatchMouseEvent`, and read `navigator.clipboard.readText()` after button clicks.

```js
await cdpClient.send('Browser.grantPermissions', {
  origin,
  permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
});
assert.equal(await cdpClient.evaluate('navigator.clipboard.readText()'), '#123');
```

Assert the tooltip is visible below the button while hovered, the successful icon state is green, the label click reaches `#click-target`, SPA navigation changes copy text to `!456` and resets feedback, and leaving a detail page removes the host.

- [ ] **Step 2: Run the browser test and verify the new assertions fail before implementation is complete**

Run: `npm run test:browser`

Expected before Tasks 1-3 implementation: FAIL because the copy button and tooltip selectors do not exist.

- [ ] **Step 3: Adjust only integration-specific details required by real Chromium**

If CDP exposes permission or hit-testing differences, preserve the user-visible contract and update the fixture/driver setup, not the production behavior. Keep clipboard content, tooltip geometry, success state, and pointer-through assertions mandatory.

- [ ] **Step 4: Run the browser test**

Run: `npm run test:browser`

Expected: 1 end-to-end scenario PASS, 0 failures, 0 skips.

- [ ] **Step 5: Commit browser coverage**

```bash
git add tests/browser.test.js
git commit -m "test: cover reference copy interaction"
```

### Task 5: Documentation And Final Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/testing.md`

**Interfaces:**
- Consumes: verified behavior and test counts from Tasks 1-4.
- Produces: user installation/usage guidance and an up-to-date verification record.

- [ ] **Step 1: Update user documentation**

Document the permanent copy icon, tooltip, copied formats, green-check feedback, HTTP fallback compatibility, and unchanged privacy/permission model. Link both the approved quick-copy design and this implementation plan.

- [ ] **Step 2: Update the testing document**

Record unit coverage for success, fallback, failure, timer, race, SPA, and destruction. Expand browser assertions for passive-label hit testing, interactive-button hit testing, tooltip placement, clipboard values, green check, and SPA reset. Update actual test counts only from fresh command output.

- [ ] **Step 3: Run complete verification**

Run: `npm test`

Expected: all tests PASS with 0 failures and 0 skips.

Run: `npm run test:browser`

Expected: 1 end-to-end scenario PASS with 0 failures and 0 skips.

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 4: Review the final diff against the approved design**

Run: `git diff -- src/content.js tests/content.test.js tests/browser.test.js README.md docs/testing.md`

Confirm every Global Constraint is represented and `manifest.json` remains unchanged.

- [ ] **Step 5: Commit documentation and verification record**

```bash
git add README.md docs/testing.md docs/superpowers/plans/2026-07-31-gitlab-reference-quick-copy-implementation.md
git commit -m "docs: explain reference quick copy"
```
