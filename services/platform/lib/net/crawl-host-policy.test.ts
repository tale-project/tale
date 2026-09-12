import { afterEach, describe, expect, it } from 'vitest';

import {
  crawlHostRefusal,
  CrawlTargetError,
  crawlTargetResolutionRefusal,
  parseCrawlTarget,
} from './crawl-host-policy';
import { setSafeFetchResolverForTests } from './safe-fetch';

/**
 * A registered website is a server-side fetch target the crawler dials
 * from inside the operator's network. The regression under test: the
 * doors accepted `localhost`, `127.0.0.1`, `169.254.169.254` and
 * `file:///etc/passwd` (read as the host `file`) as crawl targets, and the
 * crawler's own allowlist then suspended `safeFetch`'s private-range
 * refusal for exactly those hosts.
 */

describe('crawlHostRefusal', () => {
  it.each([
    'localhost',
    'LOCALHOST.',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.9',
    '192.168.1.1',
    '169.254.169.254',
    '[::1]',
    'fd00::1',
    '100.64.0.1',
    '100.127.255.254',
    'metadata.google.internal',
    'metadata',
    'db',
    'intranet.corp',
    'wiki.example.internal',
    'printer.home.arpa',
    'files.local',
  ])('refuses %s', (host) => {
    expect(crawlHostRefusal(host, { allowPrivate: false })).not.toBeNull();
  });

  it.each([
    'example.com',
    'www.example.com',
    'docs.tale.dev',
    '93.184.216.34',
    '100.63.255.255',
    '100.128.0.1',
    'a.b',
  ])('allows %s', (host) => {
    expect(crawlHostRefusal(host, { allowPrivate: false })).toBeNull();
  });

  it('lifts the private-network refusals on the opt-in, never the metadata block', () => {
    expect(crawlHostRefusal('10.1.2.3', { allowPrivate: true })).toBeNull();
    expect(crawlHostRefusal('wiki.corp', { allowPrivate: true })).toBeNull();
    expect(
      crawlHostRefusal('169.254.169.254', { allowPrivate: true }),
    ).not.toBeNull();
    expect(
      crawlHostRefusal('metadata.google.internal.', { allowPrivate: true }),
    ).not.toBeNull();
  });

  it('reads the deployment knob when no option is given', () => {
    const before = process.env.TALE_ALLOW_PRIVATE_CRAWL_HOSTS;
    try {
      delete process.env.TALE_ALLOW_PRIVATE_CRAWL_HOSTS;
      expect(crawlHostRefusal('10.0.0.1')).not.toBeNull();
      process.env.TALE_ALLOW_PRIVATE_CRAWL_HOSTS = '1';
      expect(crawlHostRefusal('10.0.0.1')).toBeNull();
    } finally {
      if (before === undefined)
        delete process.env.TALE_ALLOW_PRIVATE_CRAWL_HOSTS;
      else process.env.TALE_ALLOW_PRIVATE_CRAWL_HOSTS = before;
    }
  });
});

describe('parseCrawlTarget', () => {
  const opts = { allowPrivate: false };

  it.each([
    ['example.com', 'example.com'],
    ['  Example.COM/path?q=1 ', 'example.com'],
    ['https://www.example.com/docs', 'www.example.com'],
    ['http://example.com:8080', 'example.com'],
    ['example.com:8443', 'example.com'],
  ])('reads %s as the host %s', (input, host) => {
    expect(parseCrawlTarget(input, opts)).toBe(host);
  });

  it.each([
    'file:///etc/passwd',
    'ftp://example.com',
    'javascript:alert(1)',
    'https://',
    'a b',
    '::',
    '',
  ])('refuses %j as no http(s) host at all', (input) => {
    expect(() => parseCrawlTarget(input, opts)).toThrow(CrawlTargetError);
    try {
      parseCrawlTarget(input, opts);
    } catch (error) {
      expect(error).toMatchObject({ code: 'WEBSITE_DOMAIN_INVALID' });
    }
  });

  it.each([
    'localhost',
    'http://localhost:3000',
    '127.0.0.1',
    'https://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'intranet',
  ])('refuses %s as not crawlable', (input) => {
    try {
      parseCrawlTarget(input, opts);
      throw new Error('accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(CrawlTargetError);
      expect(error).toMatchObject({ code: 'WEBSITE_DOMAIN_NOT_CRAWLABLE' });
    }
  });
});

describe('crawlTargetResolutionRefusal', () => {
  afterEach(() => {
    setSafeFetchResolverForTests(null);
  });

  function answering(addresses: { address: string; family: 4 | 6 }[] | Error) {
    setSafeFetchResolverForTests(() =>
      addresses instanceof Error
        ? Promise.reject(addresses)
        : Promise.resolve(addresses),
    );
  }

  it('refuses a public-looking name whose record points at a private or metadata address', async () => {
    answering([{ address: '127.0.0.1', family: 4 }]);
    await expect(
      crawlTargetResolutionRefusal('127.0.0.1.nip.io', { allowPrivate: false }),
    ).resolves.toContain('127.0.0.1');
    answering([{ address: '169.254.169.254', family: 4 }]);
    await expect(
      crawlTargetResolutionRefusal('169.254.169.254.nip.io', {
        allowPrivate: true,
      }),
    ).resolves.toContain('metadata');
  });

  it('admits a public answer, an admitted private answer, and a name DNS cannot answer', async () => {
    answering([{ address: '93.184.216.34', family: 4 }]);
    await expect(
      crawlTargetResolutionRefusal('example.com', { allowPrivate: false }),
    ).resolves.toBeNull();
    answering([{ address: '10.0.0.7', family: 4 }]);
    await expect(
      crawlTargetResolutionRefusal('intranet.example', { allowPrivate: true }),
    ).resolves.toBeNull();
    answering(new Error('ENOTFOUND'));
    await expect(
      crawlTargetResolutionRefusal('nowhere.example', { allowPrivate: false }),
    ).resolves.toBeNull();
  });

  it('never resolves an IP literal — the string policy judged it already', async () => {
    answering(new Error('must not be called'));
    await expect(
      crawlTargetResolutionRefusal('93.184.216.34', { allowPrivate: false }),
    ).resolves.toBeNull();
  });
});
