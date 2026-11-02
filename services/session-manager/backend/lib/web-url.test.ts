import { describe, expect, it } from 'vitest';

import {
  addressBarUrl,
  layoutFromJson,
  layoutToJson,
  restorableUrl,
  sameLayout,
  webUrl,
} from './web-url.ts';

describe('webUrl', () => {
  it.each([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['example.com', 'https://example.com'],
    ['  www.google.com/search?q=x ', 'https://www.google.com/search?q=x'],
    ['example.com:8443/path', 'https://example.com:8443/path'],
    ['localhost:3000/x', 'http://localhost:3000/x'],
    ['127.0.0.1:8080', 'http://127.0.0.1:8080'],
    ['[::1]:80', 'http://[::1]:80'],
    ['münchen.de/straße', 'https://münchen.de/straße'],
    ['пример.рф', 'https://пример.рф'],
    ['example.com:80/a', 'http://example.com:80/a'],
    [
      `https://login.example.com/cb?t=${'x'.repeat(5000)}`,
      `https://login.example.com/cb?t=${'x'.repeat(5000)}`,
    ],
  ])('accepts the web address %j', (text, url) => {
    expect(webUrl(text)).toBe(url);
  });

  it.each([
    '',
    '   ',
    'hello world',
    'foo',
    'https://',
    'http://x:99999',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'ftp://example.com',
    'about:blank',
    'https://exa mple.com',
    'x'.repeat(20_000),
    '999.999.999.999',
    '1.2.3',
    `https://example.com/${'x'.repeat(20_000)}`,
    'a..b.com',
    '[zz::1]',
  ])('rejects everything else: %j', (text) => {
    expect(webUrl(text)).toBeNull();
  });
});

describe('addressBarUrl', () => {
  it('searches for what is not an address', () => {
    expect(addressBarUrl('example.com')).toBe('https://example.com');
    expect(addressBarUrl('best pizza & wine')).toBe(
      'https://www.google.com/search?q=best+pizza+%26+wine',
    );
    expect(addressBarUrl('javascript:alert(1)')).toMatch(
      /^https:\/\/www\.google\.com\/search\?q=javascript/,
    );
    expect(addressBarUrl('   ')).toBeNull();
  });

  it('does not send an address that cannot be opened to a search engine', () => {
    expect(addressBarUrl('ftp://example.com/file')).toBeNull();
    expect(addressBarUrl('file:///etc/passwd')).toBeNull();
    expect(addressBarUrl('https://exa mple.com/?token=secret')).toBeNull();
    expect(
      addressBarUrl(`https://example.com/?token=${'x'.repeat(20_000)}`),
    ).toBeNull();
  });
});

describe('restorableUrl', () => {
  it('reopens only web pages', () => {
    expect(restorableUrl('https://example.com/a')).toBe(
      'https://example.com/a',
    );
    expect(restorableUrl('about:blank')).toBeNull();
    expect(restorableUrl('about:preferences')).toBeNull();
    expect(restorableUrl('file:///tmp/x.html')).toBeNull();
  });

  it('brings a page that failed to load back as the page the user wanted', () => {
    expect(
      restorableUrl(
        'about:neterror?e=dnsNotFound&u=https%3A//nope.example/x&c=UTF-8',
      ),
    ).toBe('https://nope.example/x');
    expect(restorableUrl('about:neterror?e=dnsNotFound')).toBeNull();
    expect(
      restorableUrl('about:certerror?u=https%3A%2F%2Fbad.example%2F&e=x'),
    ).toBe('https://bad.example/');
  });
});

describe('TabLayout', () => {
  it('survives JSON', () => {
    const layout = {
      urls: ['https://a.example', 'https://b.example'],
      active: 1,
    };
    expect(layoutFromJson(layoutToJson(layout))).toEqual(layout);
  });

  it('never breaks a start: unusable entries are dropped, the active tab falls back to the first', () => {
    expect(
      layoutFromJson('{"urls": ["https://a.example", 5, null], "active": 9}'),
    ).toEqual({ urls: ['https://a.example'], active: 0 });
    expect(layoutFromJson('[]')).toEqual({ urls: [], active: 0 });
    expect(layoutFromJson('{"urls": "x", "active": 1.5}')).toEqual({
      urls: [],
      active: 0,
    });
  });

  it('compares layouts by content', () => {
    const layout = { urls: ['https://a.example'], active: 0 };
    expect(sameLayout(layout, { urls: ['https://a.example'], active: 0 })).toBe(
      true,
    );
    expect(sameLayout(layout, { urls: ['https://b.example'], active: 0 })).toBe(
      false,
    );
    expect(sameLayout(layout, { urls: [], active: 0 })).toBe(false);
  });
});
