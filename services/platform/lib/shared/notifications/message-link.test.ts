import { describe, expect, it } from 'vitest';

import { classifyMessageLink } from './message-link';

const ORG = 'org_1';

describe('the link an automation message may carry', () => {
  it.each([
    [
      '/dashboard/org_1/projects/p1/tasks?task=t1',
      {
        kind: 'app',
        path: '/dashboard/org_1/projects/p1/tasks?task=t1',
        splat: 'projects/p1/tasks',
        search: { task: 't1' },
      },
    ],
    [
      '/dashboard/org_1',
      { kind: 'app', path: '/dashboard/org_1', splat: '', search: {} },
    ],
    [
      '  /dashboard/org_1/documents/  ',
      {
        kind: 'app',
        path: '/dashboard/org_1/documents',
        splat: 'documents',
        search: {},
      },
    ],
    [
      '/dashboard/org_1/documents?q=a%20b&doc=d1&doc=d2',
      {
        kind: 'app',
        path: '/dashboard/org_1/documents?q=a+b&doc=d2',
        splat: 'documents',
        search: { q: 'a b', doc: 'd2' },
      },
    ],
    [
      'https://reports.example.com/weekly?week=41',
      {
        kind: 'web',
        url: 'https://reports.example.com/weekly?week=41',
        host: 'reports.example.com',
      },
    ],
    [
      'https://Example.com:8443/a#b',
      {
        kind: 'web',
        url: 'https://example.com:8443/a#b',
        host: 'example.com:8443',
      },
    ],
  ])('opens %s', (link, expected) => {
    expect(classifyMessageLink(link, ORG)).toEqual(expected);
  });

  it.each([
    ['another organization', '/dashboard/org_2/projects'],
    ['outside the dashboard', '/api/v1/automations'],
    ['a protocol-relative address', '//evil.example.com/x'],
    ['a backslashed path', '/dashboard/org_1\\..\\api'],
    ['a dot segment', '/dashboard/org_1/../org_2/projects'],
    ['an escaped dot segment', '/dashboard/org_1/%2e%2e/org_2'],
    ['an empty segment', '/dashboard/org_1//projects'],
    ['a fragment on an in-app path', '/dashboard/org_1/projects#top'],
    ['plaintext http', 'http://example.com/report'],
    ['a script', 'javascript:alert(1)'],
    ['a data address', 'data:text/html,<p>hi</p>'],
    ['credentials in the address', 'https://user:pass@example.com/'],
    ['a relative path', 'projects/p1'],
    ['an over-long link', `https://example.com/${'a'.repeat(2000)}`],
    ['nothing', '   '],
    ['not text', 42],
  ])('refuses %s', (_case, link) => {
    expect(classifyMessageLink(link, ORG)).toBeNull();
  });
});
