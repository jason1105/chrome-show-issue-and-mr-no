#!/usr/bin/env node
/**
 * Quick test of pre-grant-via-puppeteer.mjs before running full acceptance test.
 */
'use strict';

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function main() {
  // Create fixture server
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><body>Test</body></html>');
  });
  
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  
  console.log(`Test origin: ${origin}`);
  
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-pre-grant-'));
  console.log(`Test profile: ${profileDir}`);
  
  const preGrantScript = path.join(projectRoot, 'scripts', 'pre-grant-via-puppeteer.mjs');
  
  console.log('\n==== Running pre-grant script ====\n');
  
  const proc = spawn('node', [preGrantScript, origin, profileDir], {
    stdio: 'inherit',
  });
  
  const exitCode = await new Promise((resolve) => proc.on('close', resolve));
  
  console.log(`\n==== Pre-grant exited with code ${exitCode} ====\n`);
  
  server.close();
  
  // Clean up
  try {
    fs.rmSync(profileDir, { recursive: true, force: true });
  } catch {}
  
  if (exitCode !== 0) {
    console.error('❌ Pre-grant test FAILED');
    process.exit(1);
  }
  
  console.log('✅ Pre-grant test PASSED');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
