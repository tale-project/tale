import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type OutboundProxy,
  parseOutboundProxyUrls,
} from '@tale/shared/net/outbound-proxies';
import { describe, expect, it } from 'vitest';

/**
 * OUTBOUND_PROXY_URLS has two readers: `@tale/shared/net/outbound-proxies`
 * in the backend, and the sandbox egress service's `outbound-proxies.awk`,
 * which turns the same value into squid's peers. A value they read
 * differently would send the backend's requests and the sessions' through
 * different proxies, or let one start where the other refuses — so both run
 * here over the same entries and must agree on every verdict, every refusal
 * and every proxy, under whichever awk this machine has (CI's is mawk; the
 * image's is busybox).
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const AWK_PROGRAM = path.join(
  REPO_ROOT,
  'services/sandbox-egress/outbound-proxies.awk',
);

/** What the egress reader prints for a value, and how it exits. */
function readByEgress(value: string): { status: number; lines: string[] } {
  const result = spawnSync('awk', ['-f', AWK_PROGRAM], {
    input: `${value}\n`,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LC_ALL: 'C' },
  });
  return {
    status: result.status ?? -1,
    lines: result.stdout.split('\n').filter((line) => line !== ''),
  };
}

/** The squid peer the egress reader prints for one proxy. */
function peerLine(proxy: OutboundProxy, position: number): string {
  const line = `cache_peer ${proxy.host} parent ${proxy.port} 0 no-query no-digest round-robin connect-timeout=10 connect-fail-limit=2 name=outbound-${position}`;
  return proxy.credentials === null
    ? line
    : `${line} login=${proxy.credentials}`;
}

/** What the backend makes of a value: the peers it implies, or its refusal. */
function readByBackend(
  value: string,
): { status: 0; lines: string[] } | { status: 1; lines: [string] } {
  try {
    return {
      status: 0,
      lines: parseOutboundProxyUrls(value).map((proxy, index) =>
        peerLine(proxy, index + 1),
      ),
    };
  } catch (error) {
    return {
      status: 1,
      lines: [error instanceof Error ? error.message : String(error)],
    };
  }
}

const ENTRIES = [
  // Accepted.
  'http://p.example',
  'http://p.example/',
  'HTTP://P.Example:3128',
  'http://alice:s3cret@203.0.113.7:8080',
  "http://us-1.u_~:a!b$c&d'e(f)g*h+i;j=k:l%2Cm%40n%25o@p.webshare.io:80",
  'http://user:pass:with:colons@p.example:1',
  'http://0x7f.example',
  'http://p.0xg',
  'http://1.2.3.4',
  'http://0.0.0.0:65535',
  'http://a-b.c-d.example',
  // Refused.
  'https://p.example',
  'socks5h://p.example:1080',
  'p.example:8080',
  'http:/p.example',
  'http://p.example:8080/path',
  'http://p.example?x',
  'http://p.example#x',
  'http://p.example//',
  'http://al@ice:pw@p.example',
  'http://alice:pw%2@p.example',
  'http://alice:pw%zz@p.example',
  'http://alice:"pw"@p.example',
  'http://alice:p\\w@p.example',
  'http://alice:pw%00x@p.example',
  'http://alice:pw%1F@p.example',
  'http://alice:pw%7F@p.example',
  'http://alice:pw%FF@p.example',
  'http://alice:pw%C3%A9@p.example',
  'http://alice:a%20b%7E@p.example',
  `http://a:${'p'.repeat(126)}@p.example`,
  `http://a:${'p'.repeat(127)}@p.example`,
  `http://a:${'%41'.repeat(126)}@p.example`,
  `http://a:${'%41'.repeat(127)}@p.example`,
  `http://${'u'.repeat(64)}:${'p'.repeat(64)}@p.example`,
  'http://*:pw@p.example',
  'http://*user:pw@p.example',
  'http://%2Auser:pw@p.example',
  'http://NEGOTIATE:pw@p.example',
  'http://NEGOTIATEuser:pw@p.example',
  'http://%4EEGOTIATE:pw@p.example',
  'http://negotiate:pw@p.example',
  'http://user*:pw@p.example',
  'http://alice@p.example',
  'http://alice:@p.example',
  'http://:pw@p.example',
  'http://@p.example',
  'http://[2001:db8::1]:8080',
  'http://',
  'http://:8080',
  'http://p_x.example',
  'http://-p.example',
  'http://p-.example',
  'http://p.example.',
  'http://p..example',
  'http://prøxy.example',
  'http://p\u212Aroxy.example',
  'http://256.1.1.1',
  'http://10.1',
  'http://0x7f.0.0.1',
  'http://p.0x7f',
  'http://p.123',
  'http://xn--a.example',
  'http://p.xn--abc',
  'http://xn--bcher-kva.example',
  'http://axn--b.example',
  'http://010.0.0.1',
  'http://1.2.3.4.5',
  `http://${'a'.repeat(64)}.example`,
  `http://${Array.from({ length: 51 }, () => 'abcd').join('.')}`,
  'http://p.example:0',
  'http://p.example:65536',
  'http://p.example:080',
  'http://p.example:',
  'http://p.example:8a',
  'http://p.example:123456',
  'http://p.example:80:80',
];

describe('the two readers of OUTBOUND_PROXY_URLS', () => {
  it.each(ENTRIES)('agree on %j', (entry) => {
    expect(readByEgress(entry)).toEqual(readByBackend(entry));
  });

  it.each([
    'http://a.example, http://b.example',
    ' http://a.example\thttp://b.example\nhttp://c.example ,, ',
    'http://a.example\fhttp://b.example\vhttp://c.example',
    // A no-break space separates nothing for either reader.
    'http://a.example\u00a0http://b.example',
    'http://a.example, https://b.example, http://c.example',
    'http://a.example, http://a.example',
    ' , ',
    '',
  ])('agree on the list %j', (value) => {
    expect(readByEgress(value)).toEqual(readByBackend(value));
  });
});

describe('the documents that name OUTBOUND_PROXY_URLS', () => {
  const read = (relative: string) =>
    readFileSync(path.join(REPO_ROOT, relative), 'utf8');

  it('.env.example shows it, commented out', () => {
    expect(read('.env.example')).toMatch(/^# OUTBOUND_PROXY_URLS=/m);
  });

  it.each(['en', 'de', 'fr'])(
    'the %s environment reference has a row for it and for the video override',
    (locale) => {
      const reference = read(
        `docs/${locale}/self-hosted/configuration/environment-reference.md`,
      );
      expect(reference).toMatch(/^\| `OUTBOUND_PROXY_URLS` \|/m);
      const video = reference
        .split('\n')
        .find((line) => line.startsWith('| `VIDEO_INGEST_PROXY_URL` |'));
      expect(video).toContain('`OUTBOUND_PROXY_URLS`');
    },
  );
});
