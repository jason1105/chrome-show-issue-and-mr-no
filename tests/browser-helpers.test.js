'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { serializeDomTree, dumpDomScript, STYLE_KEYS } = require('./browser-helpers');

function stubElement(tagName, options = {}) {
  return {
    tagName,
    className: options.className || '',
    attributes: options.attributes || [],
    computedStyle: options.computedStyle || {},
    children: options.children || [],
    ...(options.querySelector ? { querySelector: options.querySelector } : {}),
  };
}

test('serializeDomTree emits one JSON line per node with the agreed fields', () => {
  const root = stubElement('DIV', {
    className: 'host',
    attributes: [{ name: 'id', value: 'gitlab-reference-badge-host' }],
    computedStyle: { display: 'block', position: 'fixed', 'z-index': '2147483647', opacity: '1' },
    children: [
      stubElement('BUTTON', {
        className: 'trigger',
        attributes: [{ name: 'aria-expanded', value: 'false' }],
        computedStyle: { display: 'inline-block', position: 'relative' },
      }),
    ],
  });

  const lines = serializeDomTree(root);
  assert.equal(lines.length, 2);
  const [hostLine, buttonLine] = lines.map((line) => JSON.parse(line));

  assert.deepEqual(Object.keys(hostLine), ['path', 'tag', 'class', 'attrs', 'style']);
  assert.equal(hostLine.path, '/DIV');
  assert.equal(hostLine.tag, 'DIV');
  assert.equal(hostLine.class, 'host');
  assert.deepEqual(hostLine.attrs, { id: 'gitlab-reference-badge-host' });
  assert.deepEqual(hostLine.style, {
    display: 'block',
    position: 'fixed',
    'z-index': '2147483647',
    opacity: '1',
  });

  assert.equal(buttonLine.path, '/DIV/BUTTON[0]');
  assert.deepEqual(buttonLine.style, {
    display: 'inline-block',
    position: 'relative',
    'z-index': '',
    opacity: '',
  });
});

test('serializeDomTree scopes to a selector match and returns null when absent', () => {
  const target = stubElement('SPAN', { className: 'panel' });
  const root = stubElement('DIV', {
    attributes: [{ name: 'id', value: 'host' }],
    children: [target],
    querySelector: (rule) => (rule === 'SPAN' ? target : null),
  });

  const scoped = serializeDomTree(root, 'SPAN');
  assert.equal(scoped.length, 1);
  assert.equal(JSON.parse(scoped[0]).path, 'SPAN');

  assert.equal(serializeDomTree(root, '.missing'), null);
});

test('dumpDomScript wraps the in-page source with a JSON-encoded selector', () => {
  const script = dumpDomScript('#gitlab-reference-badge-host');
  assert.ok(script.includes('function dumpDom(selector)'));
  assert.ok(script.endsWith('("#gitlab-reference-badge-host")'));
  assert.ok(script.includes('gitlab-reference-badge-host'));
  assert.deepEqual(STYLE_KEYS, ['display', 'position', 'z-index', 'opacity']);
});
