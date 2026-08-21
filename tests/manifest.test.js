const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(projectRoot, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

test('declares a loadable Manifest V3 extension', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.name, /\S/);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});

test('declares a default locale with matching _locales messages', () => {
  assert.equal(manifest.default_locale, 'en');
  const enPath = path.join(projectRoot, '_locales', 'en', 'messages.json');
  const zhPath = path.join(projectRoot, '_locales', 'zh_CN', 'messages.json');
  assert.equal(fs.statSync(enPath).isFile(), true);
  assert.equal(fs.statSync(zhPath).isFile(), true);

  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'en and zh_CN must expose the same message keys');
  for (const [key, value] of Object.entries(en)) {
    assert.equal(typeof value.message, 'string', `en message "${key}" must be a string`);
  }
});

test('requests optional host permissions and dynamically registers scripts', () => {
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.permissions || [], ['storage', 'scripting']);
  assert.deepEqual(manifest.optional_host_permissions || [], ['http://*/*', 'https://*/*']);
  assert.equal(manifest.background?.service_worker, 'src/background.js');

  assert.equal(fs.statSync(path.join(projectRoot, 'src/background.js')).isFile(), true);
  assert.equal(fs.statSync(path.join(projectRoot, 'src/permissions.js')).isFile(), true);
});

test('registers content scripts in parser → config → i18n → ui → content order at document_start', () => {
  const permissionsSource = fs.readFileSync(path.join(projectRoot, 'src/permissions.js'), 'utf8');
  assert.match(permissionsSource, /CONTENT_SCRIPT_FILES[\s\S]*?'src\/parser\.js'[\s\S]*?'src\/config\.js'[\s\S]*?'src\/i18n\.js'[\s\S]*?'src\/ui\.js'[\s\S]*?'src\/content\.js'/);
  const order = ['src/parser.js', 'src/config.js', 'src/i18n.js', 'src/ui.js', 'src/content.js']
    .map((name) => permissionsSource.indexOf(`'${name}'`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'script files must be listed in order');
  assert.match(permissionsSource, /document_start/);
});

test('registers the navigation hook in the MAIN world at document_start', () => {
  const permissionsSource = fs.readFileSync(path.join(projectRoot, 'src/permissions.js'), 'utf8');
  assert.match(permissionsSource, /NAVIGATION_HOOK_SCRIPT_ID/);
  assert.match(permissionsSource, /'src\/navigation-hook\.js'/);
  assert.match(permissionsSource, /world:\s*'MAIN'/);
  assert.equal(fs.statSync(path.join(projectRoot, 'src/navigation-hook.js')).isFile(), true);
});

test('provides a keyboard-accessible settings page', () => {
  assert.equal(manifest.options_ui?.page, 'src/options.html');
  assert.equal(manifest.options_ui?.open_in_tab, true);

  const optionsHtml = fs.readFileSync(path.join(projectRoot, 'src/options.html'), 'utf8');
  assert.match(optionsHtml, /<form id="settings-form"/);
  assert.match(optionsHtml, /<script src="config\.js"><\/script>/);
  assert.match(optionsHtml, /<script src="permissions\.js"><\/script>/);
  assert.match(optionsHtml, /<script src="i18n\.js"><\/script>/);
  assert.match(optionsHtml, /<script src="options\.js"><\/script>/);
  assert.match(optionsHtml, /id="origin-input"/);
  assert.match(optionsHtml, /id="grant-origin"/);
  assert.match(optionsHtml, /id="granted-origins"/);
  assert.equal(fs.statSync(path.join(projectRoot, 'src/options.css')).isFile(), true);
});

test('provides correctly sized RGBA PNG icons', () => {
  assert.deepEqual(manifest.icons, {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  });

  for (const [sizeText, iconPath] of Object.entries(manifest.icons)) {
    const size = Number(sizeText);
    const png = fs.readFileSync(path.join(projectRoot, iconPath));

    assert.deepEqual(
      [...png.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      `${iconPath} must have a PNG signature`,
    );
    assert.equal(png.toString('ascii', 12, 16), 'IHDR');
    assert.equal(png.readUInt32BE(16), size, `${iconPath} width`);
    assert.equal(png.readUInt32BE(20), size, `${iconPath} height`);
    assert.equal(png[24], 8, `${iconPath} bit depth`);
    assert.equal(png[25], 6, `${iconPath} color type must be RGBA`);
  }
});
