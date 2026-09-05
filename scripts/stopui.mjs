'use strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const pup = await import('puppeteer-core');
const projectRoot='/tmp/edge-dev2-worktree';
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(),'edge-read-'));
const browser = await pup.launch({executablePath:process.env.CHROME_PATH,headless:false,userDataDir:profileDir,
  args:[`--disable-extensions-except=${projectRoot}`,`--load-extension=${projectRoot}`,'--no-first-run','--no-default-browser-check','--disable-sync']});
await new Promise(r=>setTimeout(r,2500));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const res={clean:null,before:null,afterReclaim:null,reclaimed:false};
const sw=()=>browser.targets().find(t=>t.type()==='service_worker'&&t.url().includes('background.js'));
const readInPage=async(page)=>{
  // read badge from within a live extension page context (survives SW reclaim)
  return page.evaluate(()=>new Promise(r=>chrome.action.getBadgeText({},r)));
};
try{
  const s0=sw(); const w=await s0.worker(); const extId=new URL(s0.url()).host;
  res.clean=await w.evaluate(async()=>new Promise(r=>chrome.action.getBadgeText({},r)));
  await w.evaluate(async()=>{ await new Promise(r=>chrome.action.setBadgeText({text:'!'},r)); });
  res.before=await w.evaluate(async()=>new Promise(r=>chrome.action.getBadgeText({},r)));
  console.log('clean=',JSON.stringify(res.clean),'before=',JSON.stringify(res.before));

  // baseline read from an options/ext page BEFORE reclaim, to prove page-read works
  const optPg = await browser.newPage();
  await optPg.goto(`chrome-extension://${extId}/src/options.html`,{waitUntil:'domcontentloaded',timeout:12000}).catch(e=>console.log('goto-opt',e.message));
  await sleep(1800);
  const pageBefore = await readInPage(optPg).catch(e=>'ERR '+e.message);
  console.log('page-read before reclaim =', JSON.stringify(pageBefore));

  // reclaim via serviceworker-internals Stop (keeps CDP connection alive)
  const intern=await browser.newPage();
  await intern.goto('chrome://serviceworker-internals/',{waitUntil:'domcontentloaded',timeout:12000}).catch(()=>{});
  await sleep(1500);
  const scope=`chrome-extension://${extId}/`;
  const clicked=await intern.evaluate((scope)=>{
    const walk=(el)=>{
      if(el.shadowRoot){ for(const c of el.shadowRoot.children){const r=walk(c); if(r)return r;} } 
      if(el.textContent&&el.textContent.includes(scope)){
        const q=el.shadowRoot?el.shadowRoot:el;
        for(const b of q.querySelectorAll('cr-button,button')){ if(/^Stop$/i.test((b.textContent||'').trim())) return b; }
        for(const b of el.querySelectorAll('cr-button,button')){ if(/^Stop$/i.test((b.textContent||'').trim())) return b; }
      }
      for(const c of (el.children?el.children:[])){ if(c.shadowRoot||(c.children&&c.children.length)){const r=walk(c); if(r)return r;} }
      return null;
    };
    const b=walk(document.body);
    if(b){ b.click(); return true; } return false;
  }, scope);
  console.log('Stop clicked=',clicked); res.reclaimed=!!clicked;
  await sleep(5000);

  // read from the ALREADY-OPEN options page (a live, non-SW extension context).
  // If badge is truly browser-held state it MUST show "!" even though SW was
  // reclaimed and the SW respawn is flaky.
  const pageAfter = await readInPage(optPg).catch(e=>'ERR '+e.message);
  console.log('page-read AFTER real SW reclaim =', JSON.stringify(pageAfter));
  res.afterReclaim = pageAfter;
}catch(e){ console.log('ERR',e.message); }
try{ const p=browser.process(); if(p)p.kill('SIGKILL'); }catch(e){}
console.log('RESULT',JSON.stringify(res));
process.exit(0);
