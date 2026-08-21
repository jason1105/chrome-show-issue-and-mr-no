const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MESSAGES, ZH_MESSAGES, getMessage, setLanguage, getLanguage, getUILanguage } = require('../src/i18n.js');

test('falls back to English when chrome.i18n is unavailable', () => {
  assert.equal(getMessage('settingsSaved'), 'Settings saved');
  assert.equal(getMessage('copied'), 'Copied');
  assert.equal(getMessage('searchPlaceholder'), 'Search number or title');
});

test('returns the key for unknown messages', () => {
  assert.equal(getMessage('does_not_exist'), 'does_not_exist');
});

test('interpolates $1 substitutions in the fallback', () => {
  assert.equal(getMessage('copyDefault', ['#123']), 'Copy #123');
  assert.equal(getMessage('summaryFound', ['3']), 'Found 3 open items');
  assert.equal(getMessage('loadMore', ['12']), 'Load more (12 loaded)');
});

test('prefers chrome.i18n.getMessage when present and falls back on empty', () => {
  const calls = [];
  globalThis.chrome = {
    i18n: {
      getMessage(key, substitutions) {
        calls.push({ key, substitutions });
        if (key === 'copied') return '已复制';
        return '';
      },
    },
  };
  try {
    assert.equal(getMessage('copied'), '已复制');
    // An empty localized result falls back to the embedded English message.
    assert.equal(getMessage('settingsSaved'), 'Settings saved');
  } finally {
    delete globalThis.chrome;
  }
  assert.equal(calls.length, 2);
});

test('embedded fallback keys and text match the en messages.json', () => {
  const enPath = path.join(__dirname, '..', '_locales', 'en', 'messages.json');
  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  assert.deepEqual(
    Object.keys(MESSAGES).sort(),
    Object.keys(en).sort(),
    'i18n.js MESSAGES keys must match _locales/en/messages.json',
  );
  for (const [key, value] of Object.entries(en)) {
    assert.equal(MESSAGES[key], value.message, `fallback text for "${key}" must match en messages.json`);
  }
});

test('embedded zh_CN keys and text match the zh_CN messages.json', () => {
  const zhPath = path.join(__dirname, '..', '_locales', 'zh_CN', 'messages.json');
  const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
  assert.deepEqual(
    Object.keys(ZH_MESSAGES).sort(),
    Object.keys(zh).sort(),
    'i18n.js ZH_MESSAGES keys must match _locales/zh_CN/messages.json',
  );
  for (const [key, value] of Object.entries(zh)) {
    assert.equal(ZH_MESSAGES[key], value.message, `zh text for "${key}" must match zh_CN messages.json`);
  }
});

test('language override selects the zh_CN mirror and interpolates', () => {
  setLanguage('zh_CN');
  try {
    assert.equal(getLanguage(), 'zh_CN');
    assert.equal(getMessage('copied'), '已复制');
    assert.equal(getMessage('copyDefault', ['#123']), '复制 #123');
    assert.equal(getMessage('summaryFound', ['3']), '找到 3 个 Open items');
  } finally {
    setLanguage(null);
  }
  assert.equal(getLanguage(), getUILanguage() === 'en' ? 'en' : getLanguage());
});

test('language override rejects unknown locales and falls back to browser UI language', () => {
  setLanguage('fr');
  assert.equal(getLanguage(), /^zh/i.test(getUILanguage()) ? 'zh_CN' : 'en');
  assert.equal(getMessage('copied'), /^zh/i.test(getUILanguage()) ? '已复制' : 'Copied');
  setLanguage(null);
});
