'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { serializeDomTree } = require('./browser-helpers');
const {
  SPA_FIXTURE_SOURCE,
  diffDomDumps,
  badgeRelevantChanges,
} = require('./scenario5-spa-harness');

function stubElement(tagName, overrides = {}) {
  return {
    tagName,
    className: '',
    attributes: [],
    children: [],
    computedStyle: {},
    ...overrides,
  };
}

function badgeTree(heading) {
  return stubElement('BODY', {
    children: [
      stubElement('DIV', {
        className: 'glr-badge',
        attributes: [{ name: 'id', value: 'glr-badge' }],
        computedStyle: { display: 'block', position: 'fixed', 'z-index': '30', opacity: '1' },
      }),
      stubElement('MAIN', {
        attributes: [{ name: 'id', value: 'content' }],
        children: [stubElement('H1', { children: [], className: '', attributes: [], computedStyle: {} })],
      }),
    ],
  });
}

test('fixture source contains SPA navigation hooks and a badge node', () => {
  assert.match(SPA_FIXTURE_SOURCE, /history\.pushState/);
  assert.match(SPA_FIXTURE_SOURCE, /popstate/);
  assert.match(SPA_FIXTURE_SOURCE, /id="glr-badge"/);
});

test('diffDomDumps reports content change and not badge change', () => {
  const before = serializeDomTree(badgeTree('issues list'));
  const after = serializeDomTree(badgeTree('after navigate'));
  const changes = diffDomDumps(before, after);

  // H1 text is not serialized, so identical trees produce no changes.
  assert.deepEqual(changes, []);

  const mutated = serializeDomTree(badgeTree('x'));
  mutated[mutated.length - 1] = JSON.stringify({
    ...JSON.parse(mutated[mutated.length - 1]),
    class: 'changed',
  });
  const changed = diffDomDumps(before, mutated);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].kind, 'changed');
});

test('diffDomDumps detects added and removed nodes', () => {
  const root = badgeTree('a');
  const before = serializeDomTree(root);
  root.children.push(stubElement('ASIDE'));
  const after = serializeDomTree(root);

  const changes = diffDomDumps(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'added');
  assert.match(changes[0].path, /ASIDE/);

  const back = diffDomDumps(after, before);
  assert.equal(back[0].kind, 'removed');
});

test('badgeRelevantChanges filters to badge nodes only', () => {
  const changes = [
    { path: '/BODY/MAIN/H1[0]', kind: 'changed' },
    { path: '/BODY/DIV[0]', kind: 'changed', before: { attrs: { id: 'glr-badge' } } },
    { path: '/BODY/ASIDE[2]', kind: 'added', after: { class: 'glr-badge-helper' } },
  ];
  const relevant = badgeRelevantChanges(changes);
  assert.equal(relevant.length, 2);
});
