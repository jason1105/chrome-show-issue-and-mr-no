'use strict';
// #22 idle-evidence probe v2 (dev2). KEY FIX vs v1: never attach a CDP session to
// the service worker (an attached session is itself a keep-alive factor, v1 hung
// 480s because of s0.worker()). All badge reads/writes go through the persistent
// options page; SW liveness is only observed via browser.targets() enumeration.
// Sequences:
// S1 boot with empty pending -> badge "" (baseline)
// S2 seed pending=["https://gitlab.example.com/"] + badge "!" (page-written, app-shaped)
// S3 natural idle eviction: poll SW target presence (zero attach), max 8 min
// S3.5 badge still "!" while SW dead (boundary 1: browser-held) then CLEAR it
//     from the live page -> "" (so any later "!" must come from re-derivation)
// S4 wake via runtime.sendMessage -> SW respawns -> boot re-derivation re-lights "!"
//     (decisive: badge was "" pre-wake, pending non-empty in storage)
// S5 convergence: pending=[], page-set "!" ghost, Stop SW via serviceworker-internals
//     (real reclaim, keeps CDP alive), wake -> boot converges badge to "" (no ghost)
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const pup = await import('puppeteer-core');
const projectRoot = '/tmp/r22-load'; // #22 branch __r22tmp @ aef9ec7 (boot re-derivation present)
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-idle-'));
const KEY = 'gitlabReferencePendingOrigins';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await pup.launch({
  executablePath: process.env.CHROME_PATH, headless: false, userDataDir: profileDir,
  args: [`--disable-extensions-except=${projectRoot}`, `--load-extension=${projectRoot}`,
    '--no-first-run', '--no-default-browser-check', '--disable-sync'],
});
const out = { phases: {}, timings: {} };
// presence-only observation: Target.getTargets enumeration, NO session attach
const swAlive = () => browser.targets().some((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
try {
  await sleep(2500);
  if (!swAlive()) throw new Error('no SW target at boot');
  // extension id without touching the worker target: read it from the targets list URL
  const swUrl = browser.targets().find((t) => t.type() === 'service_worker').url();
  const extId = new URL(swUrl).host;
  out.extensionId = extId;

  // persistent options page = read/write/wake face (chrome.action usable from any ext page)
  const opt = await browser.newPage();
  await opt.goto(`chrome-extension://${extId}/src/options.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await sleep(1500);
  const readBadge = () => opt.evaluate(() => new Promise((r) => chrome.action.getBadgeText({}, r)));
  const writeBadge = (text) => opt.evaluate((t) => new Promise((r) => chrome.action.setBadgeText({ text: t }, () => r(true))), text);
  const getPending = () => opt.evaluate((k) => new Promise((r) => chrome.storage.local.get([k], (m) => r(m?.[k] ?? null))), KEY);
  const setPending = (v) => opt.evaluate((arr) => new Promise((r) => chrome.storage.local.set({ gitlabReferencePendingOrigins: arr }, () => r(true))), v);
  const wake = () => opt.evaluate(() => new Promise((res) => {
    try { chrome.runtime.sendMessage({ type: 'idle-probe-wake' }, () => { void chrome.runtime.lastError; res(true); }); } catch (e) { res(false); }
  }));

  // S1
  out.phases.s1_bootEmptyBadge = await readBadge();            // expect ""
  out.phases.s1_pendingBefore = await getPending();            // expect null

  // S2: page-side write, zero SW attach
  await setPending(['https://gitlab.example.com/']);
  await writeBadge('!');
  out.phases.s2_badgeAfterSeed = await readBadge();            // expect "!"

  // S3: natural idle eviction poll (max 8 min), presence-only
  const t0 = Date.now(); let evicted = false;
  while (Date.now() - t0 < 480000) {
    await sleep(5000);
    if (!swAlive()) { evicted = true; break; }
  }
  out.timings.idleEvictionMs = Date.now() - t0;
  out.phases.s3_naturalEviction = evicted;                     // expect true
  if (!evicted) throw new Error('SW not evicted within 480s (check keep-alive factors)');

  // S3.5 boundary-1 read while dead, then clear -> later "!" can only be re-derived
  out.phases.s3_badgeWhileDead = await readBadge();            // expect "!" (browser-held)
  await writeBadge('');
  out.phases.s3b_badgeClearedPreWake = await readBadge();      // expect ""

  // S4 wake -> boot re-derivation (DECISIVE for #22)
  const t1 = Date.now(); await wake();
  let alive = false;
  for (let i = 0; i < 24 && !alive; i++) { await sleep(500); alive = swAlive(); }
  out.timings.wakeToAliveMs = Date.now() - t1;
  out.phases.s4_swRespawned = alive;                           // expect true
  await sleep(3000); // let boot re-derivation promise settle
  out.phases.s4_badgeAfterWake = await readBadge();            // expect "!"

  // S5 convergence: empty pending + artificial "!" ghost -> Stop -> wake -> ""
  await setPending([]);
  await writeBadge('!');                                       // artificial ghost
  const intern = await browser.newPage();
  await intern.goto('chrome://serviceworker-internals/', { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => {});
  await sleep(1500);
  const scope = `chrome-extension://${extId}/`;
  const stopped = await intern.evaluate((scope) => {
    const walk = (el) => {
      if (el.shadowRoot) { for (const c of el.shadowRoot.children) { const r = walk(c); if (r) return r; } }
      if (el.textContent && el.textContent.includes(scope)) {
        const q = el.shadowRoot ? el.shadowRoot : el;
        for (const b of q.querySelectorAll('cr-button,button')) { if (/^Stop$/i.test((b.textContent || '').trim())) return b; }
        for (const b of el.querySelectorAll('cr-button,button')) { if (/^Stop$/i.test((b.textContent || '').trim())) return b; }
      }
      for (const c of (el.children ? el.children : [])) { if (c.shadowRoot || (c.children && c.children.length)) { const r = walk(c); if (r) return r; } }
      return null;
    };
    const b = walk(document.body);
    if (b) { b.click(); return true; } return false;
  }, scope);
  await sleep(3000);
  await intern.close().catch(() => {});
  out.phases.s5_swStopped = stopped;                           // expect true
  out.phases.s5_badgeAfterStop = await readBadge();            // expect "!" (browser-held through stop)
  await wake(); await sleep(3000);
  out.phases.s5_badgeConvergedEmpty = await readBadge();       // expect "" (ghost removed by boot)
} catch (e) { out.error = e.message; }
try { const p = browser.process(); if (p) p.kill('SIGKILL'); } catch (e) {}
fs.writeFileSync('/tmp/edge-idle-evidence.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
