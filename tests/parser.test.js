const test = require('node:test');
const assert = require('node:assert/strict');

const { parseGitLabReference } = require('../src/parser.js');

test('parses a modern GitLab.com issue URL', () => {
  assert.deepEqual(
    parseGitLabReference('https://gitlab.com/acme/platform/-/issues/123'),
    {
      origin: 'https://gitlab.com',
      projectPath: 'acme/platform',
      kind: 'issue',
      iid: '123',
    },
  );
});

test('parses a modern self-hosted merge request URL over HTTP', () => {
  assert.deepEqual(
    parseGitLabReference('http://git.tsintergy.com:8080/group/project/-/merge_requests/456'),
    {
      origin: 'http://git.tsintergy.com:8080',
      projectPath: 'group/project',
      kind: 'merge-request',
      iid: '456',
    },
  );
});

test('parses HTTPS self-hosted URLs with nested groups and URL decorations', () => {
  assert.deepEqual(
    parseGitLabReference(
      'https://git.example.test/platform/frontend/web-app/-/issues/7?view=parallel#note_99',
    ),
    {
      origin: 'https://git.example.test',
      projectPath: 'platform/frontend/web-app',
      kind: 'issue',
      iid: '7',
    },
  );
});

test('decodes each project path segment exactly once', () => {
  assert.deepEqual(
    parseGitLabReference(
      'https://git.example.test/platform/frontend/web%20app/-/issues/7',
    ),
    {
      origin: 'https://git.example.test',
      projectPath: 'platform/frontend/web app',
      kind: 'issue',
      iid: '7',
    },
  );
  assert.deepEqual(
    parseGitLabReference(
      'https://git.example.test/platform/frontend/web%2520app/-/issues/8',
    ),
    {
      origin: 'https://git.example.test',
      projectPath: 'platform/frontend/web%20app',
      kind: 'issue',
      iid: '8',
    },
  );
});

test('parses legacy issue and merge request URL forms', () => {
  assert.deepEqual(
    parseGitLabReference('https://gitlab.com/acme/platform/issues/8'),
    {
      origin: 'https://gitlab.com',
      projectPath: 'acme/platform',
      kind: 'issue',
      iid: '8',
    },
  );
  assert.deepEqual(
    parseGitLabReference('https://gitlab.com/acme/subgroup/platform/merge_requests/9'),
    {
      origin: 'https://gitlab.com',
      projectPath: 'acme/subgroup/platform',
      kind: 'merge-request',
      iid: '9',
    },
  );
});

test('keeps the reference for valid issue and merge request child pages', () => {
  assert.deepEqual(
    parseGitLabReference('https://gitlab.com/acme/platform/-/merge_requests/10/diffs'),
    {
      origin: 'https://gitlab.com',
      projectPath: 'acme/platform',
      kind: 'merge-request',
      iid: '10',
    },
  );
  assert.deepEqual(
    parseGitLabReference('https://gitlab.com/acme/platform/-/issues/11/discussion'),
    {
      origin: 'https://gitlab.com',
      projectPath: 'acme/platform',
      kind: 'issue',
      iid: '11',
    },
  );
});

test('rejects list, create, edit, malformed, and non-HTTP URLs', () => {
  const invalidUrls = [
    'https://gitlab.com/acme/platform/-/issues',
    'https://gitlab.com/acme/platform/-/issues/new',
    'https://gitlab.com/acme/platform/-/issues/0',
    'https://gitlab.com/acme/platform/-/issues/-1',
    'https://gitlab.com/acme/platform/-/issues/12abc',
    'https://gitlab.com/acme/platform/-/issues/12/edit',
    'https://gitlab.com/acme/platform/-/merge_requests/13/edit',
    'https://gitlab.com/acme/platform/-/issue/14',
    'https://gitlab.com/acme/platform/-/merge_request/15',
    'https://gitlab.com/acme/-/issues/16',
    'https://git.example.test/platform/%E0%A4%A/project/-/issues/7',
    'ftp://gitlab.com/acme/platform/-/issues/17',
    'not a URL',
  ];

  for (const url of invalidUrls) {
    assert.equal(parseGitLabReference(url), null, url);
  }
});
