#!/usr/bin/env node
/**
 * Automated pre-grant script for acceptance test.
 * Uses Puppeteer to grant permissions in a real browser, then saves the profile.
 * 
 * Usage:
 *   node scripts/pre-grant-via-puppeteer.mjs <origin> <profileDir>
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const chromeForTestingRoot = path.join(
  os.homedir(),
  'Library/Caches/chrome-for-testing/150.0.7871.124',
);
const defaultChromePath = path.join(
  chromeForTestingRoot,
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);

async function main() {
  const [origin, profileDirectory] = process.argv.slice(2);
  
  if (!origin || !profileDirectory) {
    console.error('Usage: node pre-grant-via-puppeteer.mjs <origin> <profileDir>');
    process.exit(1);
  }

  const chromePath = process.env.CHROME_PATH || defaultChromePath;
  
  if (!fs.existsSync(chromePath)) {
    console.error(`Chrome not found: ${chromePath}`);
    console.error('Set CHROME_PATH to the Chrome executable.');
    process.exit(1);
  }

  console.log(`[pre-grant] Origin: ${origin}`);
  console.log(`[pre-grant] Profile: ${profileDirectory}`);
  console.log(`[pre-grant] Chrome: ${chromePath}`);

  // Dynamic import puppeteer from the main project root (handles worktree case)
  let puppeteer;
  try {
    // Try importing from projectRoot/node_modules first
    const puppeteerPath = path.join(projectRoot, 'node_modules', 'puppeteer-core', 'lib', 'esm', 'puppeteer', 'puppeteer-core.js');
    if (fs.existsSync(puppeteerPath)) {
      puppeteer = await import(`file://${puppeteerPath}`);
    } else {
      // Fallback to regular import (works if cwd has node_modules)
      puppeteer = await import('puppeteer-core');
    }
  } catch (error) {
    console.error('[pre-grant] ERROR: puppeteer-core not installed or cannot be loaded.');
    console.error('[pre-grant] Error:', error.message);
    console.error('[pre-grant] Run: npm install --save-dev puppeteer-core');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false, // Puppeteer can handle permissions in headful mode
    userDataDir: profileDirectory,
    args: [
      `--disable-extensions-except=${projectRoot}`,
      `--load-extension=${projectRoot}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--window-size=1280,800',
    ],
  });

  try {
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();

    // Wait for extension to load
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get extension ID
    const targets = await browser.targets();
    const extensionTarget = targets.find(
      (target) => target.type() === 'service_worker' && target.url().includes('background.js')
    );

    if (!extensionTarget) {
      throw new Error('Extension service worker not found');
    }

    const extensionId = new URL(extensionTarget.url()).host;
    console.log(`[pre-grant] Extension ID: ${extensionId}`);

    // Navigate to options page
    const optionsUrl = `chrome-extension://${extensionId}/src/options.html`;
    await page.goto(optionsUrl, { waitUntil: 'networkidle0' });

    // Fill origin input
    await page.waitForSelector('#origin-input');
    await page.type('#origin-input', origin);

    // Setup permission grant handler BEFORE clicking
    // Puppeteer can't auto-accept native permission bubbles, but in headful mode
    // the ChromeDriver auto-accept behavior may work. If not, we need to instruct
    // the user or use a different approach.
    
    // Try to grant via button click
    const grantButton = await page.$('#grant-origin');
    if (!grantButton) {
      throw new Error('Grant button not found on options page');
    }

    console.log('[pre-grant] Clicking grant button...');
    
    // In Puppeteer headful mode with a real user profile, permissions.request()
    // may show a bubble. We need to handle this differently.
    
    // Strategy: use page.evaluate to call chrome.permissions.request() directly
    // and grant the permission programmatically via the extension API.
    
    const grantResult = await page.evaluate(async (testOrigin) => {
      const input = document.querySelector('#origin-input');
      if (input) input.value = testOrigin;
      
      // Simulate the options.js grant flow
      const button = document.querySelector('#grant-origin');
      if (!button) return { error: 'Button not found' };
      
      button.click();
      
      // Wait for status update
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      const status = document.querySelector('#origin-status');
      return {
        statusText: status?.textContent || '',
        granted: status?.textContent?.includes('已授权') || false,
      };
    }, origin);

    console.log(`[pre-grant] Grant result:`, grantResult);

    if (!grantResult.granted) {
      // If automatic grant failed, take a screenshot and prompt user
      await page.screenshot({ path: '/tmp/pre-grant-failed.png' });
      console.error('[pre-grant] Automatic grant failed. Screenshot: /tmp/pre-grant-failed.png');
      console.error('[pre-grant] Status:', grantResult.statusText);
      
      // Give user time to manually click Allow if bubble appeared
      console.log('[pre-grant] Waiting 10 seconds for manual permission grant...');
      console.log('[pre-grant] If a permission bubble appeared, click "Allow" now.');
      await new Promise((resolve) => setTimeout(resolve, 10000));
      
      // Re-check status
      const finalCheck = await page.evaluate(() => {
        const status = document.querySelector('#origin-status');
        return {
          statusText: status?.textContent || '',
          granted: status?.textContent?.includes('已授权') || false,
        };
      });
      
      console.log(`[pre-grant] Final check:`, finalCheck);
      
      if (!finalCheck.granted) {
        throw new Error(`Permission not granted. Status: ${finalCheck.statusText}`);
      }
    }

    console.log('[pre-grant] ✓ Permission granted');

    // Verify registration happened
    const worker = await extensionTarget.worker();
    const registrations = await worker.evaluate(async () => {
      const scripts = await chrome.scripting.getRegisteredContentScripts();
      return scripts.map((s) => ({
        id: s.id,
        matches: s.matches,
        persistAcrossSessions: s.persistAcrossSessions,
      }));
    });

    console.log('[pre-grant] Registered scripts:', JSON.stringify(registrations, null, 2));

    if (registrations.length === 0) {
      throw new Error('No content scripts registered after granting permission');
    }

    console.log('[pre-grant] ✓ Content scripts registered');
    console.log('[pre-grant] SUCCESS: Profile ready for acceptance test');

  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('[pre-grant] FAILED:', error.message);
  process.exit(1);
});
