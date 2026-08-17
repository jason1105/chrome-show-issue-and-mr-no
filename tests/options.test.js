const test = require('node:test');
const assert = require('node:assert/strict');

const { createConfigStore } = require('../src/config.js');
const { createOptionsController, buildUserPatch } = require('../src/options.js');

class Field {
  constructor(value = '') {
    this.value = value;
    this.checked = false;
    this.textContent = '';
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type) {
    const event = { preventDefault() {} };
    this.listeners.get(type)?.(event);
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  focus() {
    this.focused = true;
  }
}

function createOptionsDocument() {
  const fields = {
    'list-filter': new Field(),
    'remember-search': new Field(),
    'cache-ttl': new Field(),
    'max-items': new Field(),
    'max-items-batch': new Field(),
    'request-timeout': new Field(),
    'loading-mode': new Field(),
    'show-last-refresh': new Field(),
    'touch-drag': new Field(),
    'keyboard-step': new Field(),
    status: new Field(),
    'settings-form': new Field(),
    'reset-settings': new Field(),
  };
  return {
    fields,
    getElementById(id) {
      return fields[id];
    },
  };
}

function createStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get() {
      return Promise.resolve({ gitlabReferenceConfig: data.gitlabReferenceConfig });
    },
    set(value) {
      Object.assign(data, value);
      return Promise.resolve();
    },
    remove() {
      return Promise.resolve();
    },
  };
}

test('builds a validated user patch from option controls', () => {
  const patch = buildUserPatch({
    listFilter: { value: 'issue' },
    rememberSearch: { checked: true },
    cacheTtlSeconds: { value: '120' },
    maxItemsPerType: { value: '20' },
    loadingMode: { value: 'sequential' },
    showLastRefresh: { checked: false },
    touchDrag: { checked: true },
    keyboardStep: { value: '12' },
  });

  assert.deepEqual(patch, {
    listFilter: 'issue',
    rememberSearch: true,
    cacheTtlSeconds: 120,
    maxItemsPerType: 20,
    loadingMode: 'sequential',
    showLastRefresh: false,
    touchDrag: true,
    keyboardStep: 12,
  });
});

test('omits empty numeric controls so saving does not silently clamp them', () => {
  const patch = buildUserPatch({
    listFilter: { value: 'issue' },
    rememberSearch: { checked: false },
    cacheTtlSeconds: { value: '' },
    maxItemsPerType: { value: '   ' },
    loadingMode: { value: 'parallel' },
    showLastRefresh: { checked: true },
    touchDrag: { checked: true },
    keyboardStep: { value: 'not-a-number' },
  });

  assert.deepEqual(patch, {
    listFilter: 'issue',
    rememberSearch: false,
    loadingMode: 'parallel',
    showLastRefresh: true,
    touchDrag: true,
  });
});

test('loads, saves, and resets settings through the configuration store', async () => {
  const storage = createStorage();
  const store = createConfigStore(storage);
  const document = createOptionsDocument();
  const controller = createOptionsController(document, store, 'https://git.example.test');

  await controller.init();
  assert.equal(document.fields['list-filter'].value, 'all');
  assert.equal(document.fields['remember-search'].checked, true);
  assert.equal(document.fields['cache-ttl'].value, '60');

  document.fields['list-filter'].value = 'merge-request';
  document.fields['cache-ttl'].value = '120';
  document.fields['settings-form'].dispatch('submit');
  await controller.flush();
  assert.equal(document.fields.status.textContent, '设置已保存');
  assert.equal(store.getEffective('https://git.example.test').listFilter, 'merge-request');

  document.fields['reset-settings'].dispatch('click');
  await controller.flush();
  assert.equal(document.fields.status.textContent, '已恢复默认设置');
  assert.equal(document.fields['list-filter'].value, 'all');
});

test('keeps the edited controls and reports a save failure', async () => {
  const storage = createStorage();
  storage.set = () => Promise.reject(new Error('quota exceeded'));
  const store = createConfigStore(storage);
  const document = createOptionsDocument();
  const controller = createOptionsController(document, store, 'https://git.example.test');

  await controller.init();
  document.fields['cache-ttl'].value = '120';
  document.fields['settings-form'].dispatch('submit');
  await controller.flush();

  assert.equal(document.fields['cache-ttl'].value, '120');
  assert.equal(document.fields.status.textContent, '保存失败，请检查浏览器存储空间');
});
