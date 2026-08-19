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

test('injects parser, configuration, and badge scripts on HTTP and HTTPS pages', () => {
  assert.equal(manifest.content_scripts.length, 2);

  const [mainWorldScript, contentScript] = manifest.content_scripts;
  assert.deepEqual(mainWorldScript.matches, ['http://*/*', 'https://*/*']);
  assert.deepEqual(mainWorldScript.js, ['src/navigation-hook.js']);
  assert.equal(mainWorldScript.run_at, 'document_start');
  assert.equal(mainWorldScript.world, 'MAIN');

  assert.deepEqual(contentScript.matches, ['http://*/*', 'https://*/*']);
  assert.deepEqual(contentScript.js, ['src/parser.js', 'src/config.js', 'src/ui.js', 'src/content.js']);
  assert.equal(contentScript.run_at, 'document_start');
  assert.equal(contentScript.world, 'ISOLATED');

  for (const scriptPath of [...mainWorldScript.js, ...contentScript.js]) {
    assert.equal(fs.statSync(path.join(projectRoot, scriptPath)).isFile(), true);
  }
});

test('only requests storage permission for local preferences and control position', () => {
  assert.deepEqual(manifest.permissions || [], ['storage']);
  assert.deepEqual(manifest.optional_permissions || [], []);
  assert.deepEqual(manifest.host_permissions || [], []);
  assert.deepEqual(manifest.optional_host_permissions || [], []);
});

test('provides a keyboard-accessible settings page', () => {
  assert.equal(manifest.options_ui?.page, 'src/options.html');
  assert.equal(manifest.options_ui?.open_in_tab, true);

  const optionsHtml = fs.readFileSync(path.join(projectRoot, 'src/options.html'), 'utf8');
  assert.match(optionsHtml, /<form id="settings-form"/);
  assert.match(optionsHtml, /<script src="config\.js"><\/script>/);
  assert.match(optionsHtml, /<script src="options\.js"><\/script>/);
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
