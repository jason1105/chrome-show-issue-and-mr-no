#!/usr/bin/env node
// Minimal diagnostic: does an unpacked --load-extension MV3 extension's badge
// state + storage survive a full browser restart on the same profile in Edge?
// Distinguishes "Edge-specific badge loss" from "unpacked-load restarts reset id"
'use strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME_PATH = process.env.CHROME_PATH;
const PENDING_KEY = 'gitlabReferencePendingOrigins';

async function loadPpte() {
  const c = path.join(root, 'node_modules','puppeteer-core','lib','esm','puppeteer','puppeteer-core.js');
  return fs.existsSync(c) ? import(`file://${c}`) : import('puppeteer-core');
}
function launchArgs(profileDir) {
  return { executablePath: CHROME_PATH, headless:false, userDataDir: profileDir,
    args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`,
      '--no-first-run','--no-default-browser-check','--disable-sync'] };
}
async function getState(browser) {
  // poll up to ~12s for the background SW (boot/profiling varies)
  let ext = null;
  for (let i=0;i<24;i++){
    ext = (await browser.targets()).find(t=>t.type()==='service_worker'&&t.url().includes('/src/background.js'));
    if (ext) break;
    await new Promise(r=>setTimeout(r,500));
  }
  if (!ext) return null;
  const id = new URL(ext.url()).host;
  const w = await ext.worker();
  const badge = await w.evaluate(()=>new Promise(r=>chrome.action.getBadgeText({},r)));
  const pending = await w.evaluate((k)=>new Promise(r=>chrome.storage.local.get([k],(x)=>r(x[k]??null))), PENDING_KEY);
  return { id, badge, pending };
}
async function main(){
  const ppte = await loadPpte();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(),'edge-diag-'));
  const b1 = await ppte.launch(launchArgs(profileDir));
  const s1 = await getState(b1);
  console.log('S1 (boot):', JSON.stringify(s1));
  // set badge "!" and inject pending
  const targets = await b1.targets();
  const extTarget = targets.find(t=>t.type()==='service_worker'&&t.url().includes('/src/background.js'));
  const w = extTarget ? await extTarget.worker() : null;
  if (!w) throw new Error('no SW to write state');
  await w.evaluate(async()=>{await new Promise(r=>chrome.action.setBadgeText({text:'!'},r));});
  await w.evaluate(async([k])=>{await new Promise(r=>chrome.storage.local.set({[k]:['https://gitlab.example.com/*']},r));},[PENDING_KEY]);
  const s2 = await getState(b1);
  console.log('S2 (write):', JSON.stringify(s2));
  await b1.close();
  await new Promise(r=>setTimeout(r,1500));
  const b2 = await ppte.launch(launchArgs(profileDir));
  const s3 = await getState(b2);
  console.log('S3 (restart):', JSON.stringify(s3));
  await b2.close();
  console.log('DONE');
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
