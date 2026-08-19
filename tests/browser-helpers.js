'use strict';

// Browser test helpers shared by scenario tests.
//
// dumpDom contract (agreed in issue #9, see manager's finalized review):
//   - one line of JSON per node
//   - fields: path / tag / class / attrs / style
//   - style keys limited to display, position, z-index, opacity
//   - for human review only; not used in assertions
//
// The serializer is written as a plain function of a DOM-like root so it can
// run inside the page (via CDP Runtime.evaluate) and be unit-tested in Node
// against stub nodes.

const STYLE_KEYS = ['display', 'position', 'z-index', 'opacity'];

function serializeDomTree(root, selector) {
  const scope = selector ? root.querySelector(selector) : root;
  if (!scope) return null;

  const lines = [];

  const describe = (element, path) => {
    const attrs = {};
    for (const attribute of element.attributes || []) {
      attrs[attribute.name] = attribute.value;
    }

    const computed = element.computedStyle || {};
    const style = {};
    for (const key of STYLE_KEYS) {
      const value = computed[key];
      style[key] = value === undefined ? '' : value;
    }

    const line = {
      path,
      tag: element.tagName,
      class: element.className || '',
      attrs,
      style,
    };
    lines.push(JSON.stringify(line));

    const children = element.children || [];
    for (let index = 0; index < children.length; index += 1) {
      describe(children[index], `${path}/${children[index].tagName}[${index}]`);
    }
  };

  describe(scope, scope === root ? `/${scope.tagName}` : `${selector}`);
  return lines;
}

// Source of the in-page dumpDom(selector) evaluated through CDP.
// Returns an array of one-line JSON strings (or null when the selector does
// not match), so the value survives returnByValue round-trips.
const dumpDomSource = `function dumpDom(selector) {
  const scope = selector ? document.querySelector(selector) : document.body;
  if (!scope) return null;
  const STYLE_KEYS = ['display', 'position', 'z-index', 'opacity'];
  const lines = [];
  const describe = (element, path) => {
    const attrs = {};
    for (const attribute of element.attributes || []) {
      attrs[attribute.name] = attribute.value;
    }
    const computed = getComputedStyle(element);
    const style = {};
    for (const key of STYLE_KEYS) {
      style[key] = computed.getPropertyValue(key);
    }
    lines.push(JSON.stringify({
      path,
      tag: element.tagName,
      class: element.className || '',
      attrs,
      style,
    }));
    const children = element.children || [];
    for (let index = 0; index < children.length; index += 1) {
      describe(children[index], path + '/' + children[index].tagName + '[' + index + ']');
    }
  };
  describe(scope, selector ? selector : '/' + scope.tagName);
  return lines;
}`;

function dumpDomScript(selector) {
  return `(${dumpDomSource})(${JSON.stringify(selector ?? null)})`;
}

module.exports = {
  serializeDomTree,
  dumpDomSource,
  dumpDomScript,
  STYLE_KEYS,
};
