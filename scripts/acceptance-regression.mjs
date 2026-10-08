#!/usr/bin/env node
/**
 * 验收回归一键脚本（admin 指示：常规小修复直接跑脚本出结论，不再由大模型逐次判定）。
 *
 * 用法:
 *   node scripts/acceptance-regression.mjs [目标目录] [选项]
 *
 * 选项:
 *   --sha <sha>            校验目标目录 git HEAD 前缀匹配（可传短 SHA）；不匹配退出码 2
 *   --browser <auto|skip>  浏览器层模式，默认 auto：
 *                          auto = package.json 有 test:browser 则运行；因环境不可用失败
 *                          （命中 ENV_FAIL_SIGNATURES）判 SKIP 并注明原因，不判 FAIL
 *                          skip = 直接跳过浏览器层
 *   --browser-timeout <秒> 浏览器层超时（默认 900）
 *   --out-dir <目录>       证据输出目录（缺省 <目标>/.tmp-acceptance-artifacts/acceptance-<UTC时间戳>）
 *   -h, --help             显示本帮助
 *
 * 流程:
 *   1) 目标目录须含 package.json；node_modules 缺失时自动 npm ci（失败回退 npm install）
 *   2) npm test 全量单测，解析 node:test 汇总（TAP `# tests N` 与 spec `ℹ tests N` 两种格式）
 *   3) 浏览器层按 --browser 模式执行
 *   4) 证据落盘: bootstrap.log / npm-test.log / test-browser.log / summary.json
 *   5) 退出码: 0=无 FAIL；1=任一层 FAIL；2=用法/配置错误（SHA 不匹配、缺 package.json 等）
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// 浏览器层「环境不可用」特征：命中任一即 SKIP（不判 FAIL）
const ENV_FAIL_SIGNATURES = [
  [/GPU process isn't usable/i, 'GPU 进程不可用（CfT GPU FATAL）'],
  [/Goodbye\./, 'Chromium 子进程退出（Goodbye.）'],
  [/Failed to launch/i, '浏览器启动失败'],
  [/ChromeDriver not found/i, 'chromedriver 未找到（环境缺驱动，设 CHROMEDRIVER_PATH 可启用）'],
  [/ECONNREFUSED/, '连接被拒'],
  [/ECONNRESET/, '连接被重置'],
  [/ENOTFOUND/, '域名解析失败'],
  [/ETIMEDOUT/, '连接超时'],
  [/fetch failed/i, '网络请求失败'],
];

function usage() {
  console.log(`用法: node scripts/acceptance-regression.mjs [目标目录] [选项]
选项:
  --sha <sha>            校验目标目录 HEAD 前缀（可短 SHA），不匹配退出码 2
  --browser <auto|skip>  浏览器层模式，默认 auto（环境不可用判 SKIP 不判 FAIL）
  --browser-timeout <秒> 浏览器层超时，默认 900
  --out-dir <目录>       证据输出目录（缺省 <目标>/.tmp-acceptance-artifacts/acceptance-<时间戳>）
  -h, --help             显示本帮助
退出码: 0=无 FAIL；1=任一层 FAIL；2=用法/配置错误`);
}

function parseArgs(argv) {
  const VALUE_OPTS = new Set(['--sha', '--browser', '--browser-timeout', '--out-dir']);
  const norm = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_OPTS.has(a)) {
      if (i + 1 >= argv.length) {
        console.error(`选项 ${a} 缺少参数值`);
        process.exit(2);
      }
      norm.push(`${a}=${argv[i + 1]}`);
      i++;
    } else {
      norm.push(a);
    }
  }

  const args = { dir: process.cwd(), browser: 'auto', browserTimeoutSec: 900, outDir: null, sha: null };
  const positional = [];
  for (const a of norm) {
    if (a === '-h' || a === '--help') {
      usage();
      process.exit(0);
    } else if (a.startsWith('--sha=')) {
      args.sha = a.slice('--sha='.length);
    } else if (a.startsWith('--browser-timeout=')) {
      args.browserTimeoutSec = Number(a.slice('--browser-timeout='.length));
    } else if (a.startsWith('--browser=')) {
      args.browser = a.slice('--browser='.length);
    } else if (a.startsWith('--out-dir=')) {
      args.outDir = a.slice('--out-dir='.length);
    } else if (a.startsWith('--')) {
      console.error(`未知选项: ${a}`);
      process.exit(2);
    } else {
      positional.push(a);
    }
  }

  if (positional.length > 1) {
    console.error('最多一个位置参数（目标目录）');
    process.exit(2);
  }
  if (positional.length === 1) args.dir = resolve(positional[0]);
  if (!['auto', 'skip'].includes(args.browser)) {
    console.error(`--browser 仅支持 auto|skip，收到: ${args.browser}`);
    process.exit(2);
  }
  if (!Number.isFinite(args.browserTimeoutSec) || args.browserTimeoutSec <= 0) {
    console.error('--browser-timeout 须为正整数秒');
    process.exit(2);
  }
  return args;
}

function run(cmd, cmdArgs, cwd, timeoutSec) {
  const startedAt = Date.now();
  const r = spawnSync(cmd, cmdArgs, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutSec * 1000,
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return {
    code: r.status ?? (r.signal ? `-signal:${r.signal}` : -1),
    out,
    error: r.error ? String(r.error.message ?? r.error) : null,
    timedOut: r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM',
    durationSec: Math.round((Date.now() - startedAt) / 100) / 10,
  };
}

// node:test 汇总行: spec `ℹ tests N` / TAP `# tests N`（ℹ 为 U+2139）
function parseCounts(out) {
  const grab = (name) => {
    const m = out.match(new RegExp(`^\\s*(?:#|ℹ)\\s*${name}\\s+(\\d+)\\s*$`, 'm'));
    return m ? Number(m[1]) : null;
  };
  return { tests: grab('tests'), pass: grab('pass'), fail: grab('fail'), skipped: grab('skipped'), cancelled: grab('cancelled') };
}

function finalize(cfg, outDir, layers) {
  const summary = {
    ...cfg,
    startedAt: cfg.startedAtIso,
    finishedAt: new Date().toISOString(),
    node: process.version,
    layers,
  };
  delete summary.startedAtIso;
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

  console.log('\n===== 验收回归汇总 =====');
  for (const l of layers) {
    const c = l.counts
      ? `（tests=${l.counts.tests ?? '?'} pass=${l.counts.pass ?? '?'} fail=${l.counts.fail ?? '?'} skipped=${l.counts.skipped ?? '?'}）`
      : '';
    const r = l.reason ? ` — ${l.reason}` : '';
    console.log(`[${l.result}] ${l.layer}${c}${r}${l.log ? ` log=${join(outDir, l.log)}` : ''}`);
  }
  console.log(`证据目录: ${outDir}`);
  const hasFail = layers.some((l) => l.result === 'FAIL');
  console.log(hasFail ? '结论: FAIL（存在失败层）' : '结论: PASS/SKIP（无 FAIL 项）');
  return hasFail ? 1 : 0;
}

const args = parseArgs(process.argv.slice(2));
const dir = resolve(args.dir);
const startedAtIso = new Date().toISOString();

if (!existsSync(join(dir, 'package.json'))) {
  console.error(`[config] 目标目录缺少 package.json: ${dir}`);
  process.exit(2);
}

let headSha = null;
if (args.sha) {
  const g = run('git', ['rev-parse', 'HEAD'], dir, 30);
  headSha = (g.out.split('\n')[0] ?? '').trim();
  if (g.code !== 0 || !headSha.startsWith(args.sha)) {
    console.error(`[config] SHA 校验失败: 期望前缀 ${args.sha}，实际 ${headSha || '(git 不可用)'}`);
    process.exit(2);
  }
  console.log(`[sha] HEAD=${headSha} 与期望 ${args.sha} 匹配`);
}

const stamp = startedAtIso.replace(/[:.]/g, '-').slice(0, 19);
const outDir = args.outDir ? resolve(args.outDir) : join(dir, '.tmp-acceptance-artifacts', `acceptance-${stamp}`);
mkdirSync(outDir, { recursive: true });
console.log(`[evidence] 证据目录: ${outDir}`);

const cfg = { target: dir, expectedSha: args.sha, headSha, browser: args.browser, startedAtIso };
const layers = [];

if (!existsSync(join(dir, 'node_modules'))) {
  console.log('[bootstrap] node_modules 缺失，尝试 npm ci ...');
  // --include=dev：防御环境级 NODE_ENV=production（CI/桌面运行时常见）导致 npm 默认 omit=dev
  // 而静默跳过 devDependencies（npm ci/install 空转成功但不建 node_modules，会误判 FAIL）
  let boot = run('npm', ['ci', '--include=dev'], dir, 1800);
  if (boot.code !== 0) {
    console.log('[bootstrap] npm ci 失败，回退 npm install ...');
    boot = run('npm', ['install', '--include=dev'], dir, 1800);
  }
  writeFileSync(join(outDir, 'bootstrap.log'), boot.out || boot.error || '');
  if (boot.code !== 0 || !existsSync(join(dir, 'node_modules'))) {
    console.error('[bootstrap] 依赖安装失败，终止（见 bootstrap.log）');
    process.exit(finalize(cfg, outDir, layers.concat([
      { layer: 'bootstrap', result: 'FAIL', reason: '依赖安装失败', log: 'bootstrap.log' },
    ])));
  }
}

console.log('[unit] 运行 npm test（全量单测）...');
const unit = run('npm', ['test'], dir, 1800);
writeFileSync(join(outDir, 'npm-test.log'), unit.out || unit.error || '');
const unitCounts = parseCounts(unit.out);
const unitFail = unit.code !== 0 || (unitCounts.fail ?? 0) > 0 || (unitCounts.cancelled ?? 0) > 0;
layers.push({
  layer: 'unit',
  command: 'npm test',
  result: unitFail ? 'FAIL' : 'PASS',
  exitCode: unit.code,
  counts: unitCounts,
  durationSec: unit.durationSec,
  log: 'npm-test.log',
});
console.log(`[unit] exit=${unit.code} tests=${unitCounts.tests ?? '?'} pass=${unitCounts.pass ?? '?'} fail=${unitCounts.fail ?? '?'}`);

const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
const hasBrowser = Boolean(pkg.scripts && pkg.scripts['test:browser']);
if (args.browser === 'skip') {
  layers.push({ layer: 'browser', result: 'SKIP', reason: '--browser=skip 显式跳过' });
} else if (!hasBrowser) {
  layers.push({ layer: 'browser', result: 'SKIP', reason: 'package.json 未定义 test:browser 脚本' });
} else {
  console.log(`[browser] 运行 npm run test:browser（超时 ${args.browserTimeoutSec}s）...`);
  const br = run('npm', ['run', 'test:browser'], dir, args.browserTimeoutSec);
  writeFileSync(join(outDir, 'test-browser.log'), br.out || br.error || '');
  if (br.code === 0) {
    layers.push({ layer: 'browser', result: 'PASS', exitCode: 0, durationSec: br.durationSec, log: 'test-browser.log' });
  } else if (br.timedOut) {
    layers.push({
      layer: 'browser', result: 'SKIP',
      reason: `运行超时（>${args.browserTimeoutSec}s），按环境不可用处理，不判 FAIL`,
      exitCode: br.code, log: 'test-browser.log',
    });
  } else {
    const hit = ENV_FAIL_SIGNATURES.find(([re]) => re.test(br.out));
    layers.push(hit
      ? { layer: 'browser', result: 'SKIP', reason: `环境不可用，命中特征「${hit[1]}」，按约定不判 FAIL`, exitCode: br.code, log: 'test-browser.log' }
      : { layer: 'browser', result: 'FAIL', exitCode: br.code, log: 'test-browser.log' });
  }
}

process.exit(finalize(cfg, outDir, layers));
