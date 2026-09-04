#!/usr/bin/env node
/**
 * Capture light-theme screenshots of the REAL extension (B1 a11y baseline)
 * running in chrome-for-testing against the GitLab-lookalike fixture.
 *
 * Baseline: this script loads the extension from the CURRENT working tree,
 * which is 8283302 (B1 a11y: WCAG AA contrast + focus-visible). The fixture
 * host is granted the origin via the real options-page click gesture (CDP
 * Input.dispatchMouseEvent = genuine user gesture), then the dynamic content
 * scripts are registered (with a deterministic re-sync loop to absorb the
 * SW-lifecycle race), then 4 light-theme screenshots are captured.
 *
 * Output:
 *   screenshots/raw/issue11-01-main-panel.png
 *   screenshots/raw/issue11-02-panel-expanded.png
 *   screenshots/raw/issue11-03-badge-scroll.png
 *   screenshots/raw/issue11-04-focus-visible.png
 *
 * Usage: node scripts/issue11-capture-raw.mjs
 */
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CFT = '/tmp/cfT/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const projectRoot = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(projectRoot, 'screenshots', 'raw');

function fixturePage(origin) {
  const rows = [
    ['8', 'opened', 'Fix login redirect loop'],
    ['11', 'opened', 'Refactor auth flow (#8 regression)'],
    ['48', 'opened', 'Add API rate limit for public endpoints'],
    ['23', 'opened', 'Dark theme support'],
    ['17', 'merged', 'Persist panel state across reloads'],
    ['105', 'merged', 'Update dependency versions'],
    ['62', 'closed', 'Legacy filter cleanup'],
  ].map(([iid, state, title]) => {
    const cls = state === 'opened' ? 'open' : state;
    const txt = state === 'opened' ? 'Open' : state === 'merged' ? 'Merged' : 'Closed';
    const lbl = state === 'opened' ? 'bug' : 'feature';
    const lc = state === 'opened' ? '#e9f3ff' : '#f1f1f4';
    const lt = state === 'opened' ? '#1f75cb' : '#6e6e75';
    return `<li class="issue-row"><input type="checkbox" class="row-check"><span class="iid">#${iid}</span><a class="issue-title" href="${origin}/acme/platform/-/issues/${iid}">${title}</a><span class="state-chip ${cls}">${txt}</span><span class="labels"><span class="label" style="background:${lc};color:${lt}">${lbl}</span></span></li>`;
  }).join('');
  const mrs = [
    ['19', 'opened', 'Merge request number pin v2'],
    ['42', 'merged', 'CI pipeline API badge'],
  ].map(([iid, state, title]) => {
    const cls = state === 'opened' ? 'open' : state;
    const txt = state === 'opened' ? 'Open' : 'Merged';
    return `<li class="issue-row"><input type="checkbox" class="row-check"><span class="iid">!${iid}</span><a class="issue-title" href="${origin}/acme/platform/-/merge_requests/${iid}">${title}</a><span class="state-chip ${cls}">${txt}</span><span class="labels"><span class="label" style="background:#f1f1f4;color:#6e6e75">feature</span></span></li>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Issues · acme/platform · GitLab</title>
  <style>
    *{box-sizing:border-box}html,body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#303030}body{min-height:2200px;background:#fff}
    .topbar{height:48px;background:#292961;display:flex;align-items:center;gap:14px;padding:0 16px;position:sticky;top:0;z-index:5}
    .logo{width:26px;height:26px;background:#e24329;border-radius:5px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:15px}
    .topbar .search{flex:0 1 320px;height:28px;background:#3a3a6e;border:1px solid #4a4a82;border-radius:4px;color:#cfcfe8;font-size:13px;padding:0 10px;display:flex;align-items:center}
    .topbar .spacer{flex:1}.avatar{width:26px;height:26px;border-radius:50%;background:#6b4fbb}
    .layout{display:flex;min-height:2200px}.sidebar{width:220px;background:#fbfafd;border-right:1px solid #e5e3ec;padding:16px 0;flex-shrink:0}
    .sidebar .proj{font-weight:600;font-size:14px;padding:0 16px 10px}.sidebar .proj small{display:block;color:#88889c;font-weight:400}
    .sidebar a{display:block;padding:6px 16px;font-size:13px;color:#5c5c72;text-decoration:none}.sidebar a.active{color:#1f75cb;font-weight:600;border-left:2px solid #1f75cb}
    .main{flex:1;padding:16px 24px}.breadcrumb{font-size:12px;color:#88889c;margin-bottom:14px}.breadcrumb b{color:#303030;font-weight:600}
    h1{font-size:22px;font-weight:600;margin:0 0 14px}.toolbar{display:flex;align-items:center;gap:8px;margin-bottom:12px;border-bottom:1px solid #ece9f3;padding-bottom:10px}
    .toolbar .tab{font-size:13px;color:#5c5c72;padding:4px 10px;border-radius:12px;cursor:default}.toolbar .tab.on{background:#e9f3ff;color:#1f75cb;font-weight:600}
    .toolbar .count{font-size:12px;color:#88889c;margin-left:auto}
    .issue-list{list-style:none;margin:0;padding:0;border:1px solid #ece9f3;border-radius:4px}
    .issue-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #f2f1f6;font-size:14px}.issue-row:last-child{border-bottom:none}
    .row-check{width:14px;height:14px}.iid{color:#88889c;font-size:13px;min-width:34px}.issue-title{color:#1f75cb;text-decoration:none;flex:1}
    .state-chip{font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px}.state-chip.open{background:#e6f4ec;color:#1a7f37}.state-chip.merged{background:#f4e9fb;color:#8250df}.state-chip.closed{background:#fdecea;color:#cf222e}
    .label{font-size:11px;padding:2px 8px;border-radius:10px}.section-note{margin:26px 0 8px;font-size:15px;font-weight:600;color:#5c5c72}
    .spacer-fill{height:1200px}
  </style></head><body>
  <header class="topbar"><div class="logo">G</div><div class="search">Search or jump to…</div><div class="spacer"></div><div class="avatar"></div></header>
  <div class="layout"><nav class="sidebar"><div class="proj">Acme Platform<small>acme/platform</small></div><a href="#">Project overview</a><a href="#" class="active">Issues</a><a href="#">Merge requests</a><a href="#">CI/CD</a><a href="#">Deployments</a><a href="#">Analytics</a><a href="#">Settings</a></nav>
  <main class="main"><div class="breadcrumb">acme / <b>platform</b> / Issues</div><h1>Issues</h1>
  <div class="toolbar"><span class="tab on">Open 5</span><span class="tab">Closed 1</span><span class="tab">All 7</span><span class="count">7 issues</span></div>
  <ul class="issue-list">${rows}</ul><div class="section-note">Merge requests</div><ul class="issue-list">${mrs}</ul>
  <div class="spacer-fill"></div>
  </main></div></body></html>`;
}

async function startFixture() {
  let origin = '';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, origin || 'http://127.0.0.1');
    const api = '/api/v4/projects/acme%2Fplatform/';
    if (url.pathname === api + 'issues') {
      res.writeHead(200, { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify([
        { iid: 8, title: 'Fix login redirect loop', state: 'opened', web_url: `${origin}/acme/platform/-/issues/8` },
        { iid: 11, title: 'Refactor auth flow (#8 regression)', state: 'opened', web_url: `${origin}/acme/platform/-/issues/11` },
        { iid: 48, title: 'Add API rate limit for public endpoints', state: 'opened', web_url: `${origin}/acme/platform/-/issues/48` },
        { iid: 23, title: 'Dark theme support', state: 'opened', web_url: `${origin}/acme/platform/-/issues/23` },
      ]));
      return;
    }
    if (url.pathname === api + 'merge_requests') {
      res.writeHead(200, { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify([
        { iid: 19, title: 'Merge request number pin v2', state: 'opened', web_url: `${origin}/acme/platform/-/merge_requests/19` },
      ]));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' });
    res.end(fixturePage(origin));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => { origin = `http://127.0.0.1:${server.address().port}`; resolve(); }));
  return { server, origin };
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function clickAt(page, x, y) {
  const cdp = await page.target().createCDPSession();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await delay(120);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await delay(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function hoverAt(page, x, y) {
  const cdp = await page.target().createCDPSession();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
}

async function capture(page, filename) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const target = path.join(OUT_DIR, filename);
  await page.screenshot({ path: target });
  const { size } = fs.statSync(target);
  console.log(`  saved ${target} (${Math.round(size / 1024)} KiB)`);
  return target;
}

async function main() {
  console.log('issue11-capture-raw: start');
  const { server, origin } = await startFixture();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-shot-issue11-'));
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CFT,
      headless: false,
      args: [
        `--disable-extensions-except=${projectRoot}`,
        `--load-extension=${projectRoot}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--user-data-dir=' + profileDir,
        '--window-size=1280,800',
        '--force-prefers-color-scheme=light',
        '--disable-features=DisableLoadExtensionCommandLineSwitch',
      ],
      defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    });
    console.log('browser version:', await browser.version());
    await delay(1200);

    const swTarget = (await browser.targets()).find((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
    if (!swTarget) throw new Error('extension service worker not found');
    const extId = swTarget.url().split('/')[2];
    console.log('extension id:', extId);
    const sw = await swTarget.worker();
    sw.on('console', (msg) => { if (msg.type() !== 'log') console.log('  [SW]', msg.text()); });

    // --- Grant fixture origin via the real options-page click gesture ---
    const optionsUrl = `chrome-extension://${extId}/src/options.html`;
    const grantPage = await browser.newPage();
    await grantPage.goto(optionsUrl, { waitUntil: 'networkidle0', timeout: 20000 });
    await grantPage.evaluate((o) => {
      document.querySelector('#origin-input').value = o;
      document.querySelector('#grant-origin').scrollIntoView({ block: 'center' });
    }, origin);
    const btnRect = await grantPage.evaluate(() => document.querySelector('#grant-origin').getBoundingClientRect().toJSON());
    await clickAt(grantPage, btnRect.x + btnRect.width / 2, btnRect.y + btnRect.height / 2);
    const grantOk = await grantPage.evaluate(async () => {
      const status = document.querySelector('#origin-status');
      const t0 = Date.now();
      while (Date.now() - t0 < 10000) {
        const kind = status?.getAttribute('data-status-kind');
        if (kind === 'success' || kind === 'error') return `${kind}:${status.textContent}`;
        await delay(120);
      }
      return 'TIMEOUT';
    });
    console.log('grant status:', grantOk);

    // Read the granted origins from the OPTIONS page context (the page that
    // performed the grant) rather than the SW — they may differ across contexts.
    const grantedFromOptions = await grantPage.evaluate(async () => JSON.stringify((await chrome.permissions.getAll()).origins));
    console.log('granted origins (from options page):', grantedFromOptions);
    await grantPage.close();
    await delay(1200);

    // --- Deterministic content-script registration loop ---
    // Phase A: confirm the granted origin persisted (getAll() has it). The
    // grant -> SW storage write is racy; re-read until the origin is visible.
    let grantedOrigin = false;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const origins = await sw.evaluate(async () => (await chrome.permissions.getAll()).origins);
      console.log(`  persist check ${attempt}: origins=${JSON.stringify(origins)}`);
      if (origins && origins.some((o) => o.startsWith('http://127.0.0.1'))) {
        grantedOrigin = true;
        break;
      }
      await delay(400);
    }
    if (!grantedOrigin) throw new Error('granted origin did not persist to chrome.permissions');

    // Phase B: re-sync + confirm both content scripts registered.
    let registered = [];
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const r = await sw.evaluate(async () => {
        const api = self.GitLabReferencePermissions;
        if (api) {
          const c = api.createPermissionController(chrome);
          await c.syncRegisteredScripts();
        }
        const scripts = await chrome.scripting.getRegisteredContentScripts();
        return scripts.map((s) => ({ id: s.id, matches: s.matches }));
      });
      registered = r;
      console.log(`  register attempt ${attempt}: ${registered.length} script(s)`);
      if (registered.length === 2) break;
      await delay(500);
    }
    if (registered.length !== 2) throw new Error(`content scripts failed to register: ${JSON.stringify(registered)}`);

    // --- Fixture page (light scheme forced) ---
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.goto(`${origin}/acme/platform/-/issues/8`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.reload({ waitUntil: 'networkidle0' });
    await delay(900);
    await page.waitForFunction(() => document.querySelector('#gitlab-reference-badge-host'), { timeout: 15000 });
    console.log('badge host injected');

    const triggerPoint = async () => page.evaluate(() => {
      const host = document.querySelector('#gitlab-reference-badge-host');
      const trigger = host?.shadowRoot?.querySelector('[data-reference-trigger]');
      if (!trigger) return null;
      const r = trigger.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });

    // Shot 1: main panel (open the floating panel, default Open-only view)
    console.log('shot 1: main panel');
    const tp1 = await triggerPoint();
    await hoverAt(page, tp1.x, tp1.y);
    await page.waitForFunction(() => {
      const host = document.querySelector('#gitlab-reference-badge-host');
      const panel = host?.shadowRoot?.querySelector('[data-open-items-panel]');
      return panel && !panel.hidden;
    }, { timeout: 8000 });
    await delay(600);
    await capture(page, 'issue11-01-main-panel.png');

    // Shot 2: panel expanded with ALL states (click "All states" to show
    // merged/closed rows too — a visibly different view from shot 1).
    console.log('shot 2: panel expanded (all states)');
    await page.evaluate(() => {
      const host = document.querySelector('#gitlab-reference-badge-host');
      const btn = host?.shadowRoot?.querySelector('[data-item-state-filter="all"]');
      btn?.click();
    });
    await delay(700);
    const allRows = await page.evaluate(() => {
      const host = document.querySelector('#gitlab-reference-badge-host');
      const panel = host?.shadowRoot?.querySelector('[data-open-items-panel]');
      return panel?.querySelectorAll('[data-open-item]').length || 0;
    });
    console.log('  all-states row count:', allRows);
    await capture(page, 'issue11-02-panel-expanded.png');

    // Shot 3: badge while scrolled (panel closed), page scrolled down
    console.log('shot 3: badge scroll');
    await page.mouse.move(400, 700); // move away to close panel
    await delay(400);
    await page.evaluate(() => window.scrollTo(0, 900));
    await delay(700);
    const badgeVisible = await page.evaluate(() => {
      const host = document.querySelector('#gitlab-reference-badge-host');
      const badge = host?.shadowRoot?.querySelector('[data-reference-badge]');
      if (!badge) return false;
      const r = badge.getBoundingClientRect();
      return r.top >= 0 && r.top < window.innerHeight;
    });
    console.log('  badge visible while scrolled:', badgeVisible);
    await capture(page, 'issue11-03-badge-scroll.png');

    // Shot 4: focus-visible state (focus the trigger, show focus ring)
    console.log('shot 4: focus-visible');
    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(500);
    await page.evaluate(() => {
      const host = document.querySelector('#gitlab-reference-badge-host');
      const trigger = host?.shadowRoot?.querySelector('[data-reference-trigger]');
      trigger?.focus();
    });
    await delay(400);
    await capture(page, 'issue11-04-focus-visible.png');

    console.log('issue11-capture-raw: done');
  } finally {
    if (browser) await browser.close();
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
    server.closeAllConnections?.(); server.close();
  }
}

main().catch((e) => { console.error('capture error:', e.stack || e.message); process.exit(1); });
