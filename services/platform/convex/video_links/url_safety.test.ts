import { describe, expect, it } from 'vitest';

import { UrlSafetyError, assertSafeUrl } from './url_safety';

/** Convenience: a stub resolver that returns a fixed list of IPs. */
function staticResolver(addresses: string[]) {
  return async () => addresses.map((address) => ({ address }));
}

/** Resolver that throws — simulates DNS timeout / NXDOMAIN. */
const throwingResolver = async (): Promise<{ address: string }[]> => {
  throw new Error('ENOTFOUND');
};

/** Resolver that resolves to an empty set. */
const emptyResolver = async (): Promise<{ address: string }[]> => [];

describe('assertSafeUrl', () => {
  describe('cheap string-level checks (run before DNS)', () => {
    it('rejects malformed URLs as invalidUrl', async () => {
      // The shared isSafeVideoUrl path catches this; we just confirm the
      // error kind so future refactors don't downgrade the reason code.
      await expect(
        assertSafeUrl('not a url at all', {
          resolver: staticResolver(['1.2.3.4']),
        }),
      ).rejects.toMatchObject({ kind: 'invalidUrl' });
    });

    it('rejects non-https protocols (http, ftp, javascript)', async () => {
      for (const url of [
        'http://youtu.be/abc',
        'ftp://example.com/x',
        // eslint-disable-next-line no-script-url
        'javascript:alert(1)',
      ]) {
        await expect(
          assertSafeUrl(url, { resolver: staticResolver(['1.2.3.4']) }),
        ).rejects.toBeInstanceOf(UrlSafetyError);
      }
    });

    it('rejects URLs with embedded credentials', async () => {
      await expect(
        assertSafeUrl('https://user:pass@youtu.be/abc', {
          resolver: staticResolver(['1.2.3.4']),
        }),
      ).rejects.toMatchObject({ kind: 'credentialedUrl' });
    });

    it('rejects bare IP literal hosts', async () => {
      // Both IPv4 dotted-quad and IPv6 bracketed forms must be rejected
      // before DNS — the shared isSafeVideoUrl gate catches these.
      await expect(
        assertSafeUrl('https://127.0.0.1/x', {
          resolver: staticResolver(['1.2.3.4']),
        }),
      ).rejects.toBeInstanceOf(UrlSafetyError);
      await expect(
        assertSafeUrl('https://[::1]/x', {
          resolver: staticResolver(['1.2.3.4']),
        }),
      ).rejects.toBeInstanceOf(UrlSafetyError);
    });

    it('rejects URLs that decode to localhost via the parser', async () => {
      // Node's WHATWG URL parser normalizes octal/hex/decimal IPv4
      // encodings to dotted-quad — `isSafeVideoUrl`'s isBareIpLiteral
      // catches the normalized form.
      await expect(
        assertSafeUrl('https://2130706433/x', {
          resolver: staticResolver(['1.2.3.4']),
        }),
      ).rejects.toBeInstanceOf(UrlSafetyError);
    });

    it('rejects localhost variants including the trailing-dot form', async () => {
      for (const url of ['https://localhost/x', 'https://localhost./x']) {
        await expect(
          assertSafeUrl(url, { resolver: staticResolver(['1.2.3.4']) }),
        ).rejects.toBeInstanceOf(UrlSafetyError);
      }
    });

    it('rejects standalone playlist URLs', async () => {
      await expect(
        assertSafeUrl(
          'https://www.youtube.com/playlist?list=PLrAXtmRdnEQy6nuLMfO6Pp4mw1l5xLnB0',
          { resolver: staticResolver(['1.2.3.4']) },
        ),
      ).rejects.toMatchObject({ kind: 'playlist' });
    });
  });

  describe('DNS-layer checks (load-bearing defense)', () => {
    it('rejects when every A/AAAA record is private (full set rebind)', async () => {
      await expect(
        assertSafeUrl('https://evil.example.com/x', {
          resolver: staticResolver(['10.0.0.5', '192.168.1.1']),
        }),
      ).rejects.toMatchObject({ kind: 'privateIpResolved' });
    });

    it('rejects when ANY A/AAAA record is private — partial-rebind defense', async () => {
      // Critical: an attacker domain returning [public, private] in a
      // single round-robin answer would bypass a check that only looked
      // at the first record. `assertSafeUrl` walks the whole set.
      await expect(
        assertSafeUrl('https://evil.example.com/x', {
          resolver: staticResolver(['8.8.8.8', '169.254.169.254']),
        }),
      ).rejects.toMatchObject({ kind: 'privateIpResolved' });
    });

    it('rejects cloud IMDS address as private', async () => {
      await expect(
        assertSafeUrl('https://evil.example.com/x', {
          resolver: staticResolver(['169.254.169.254']),
        }),
      ).rejects.toMatchObject({ kind: 'privateIpResolved' });
    });

    it('rejects IPv6 link-local and ULA ranges', async () => {
      await expect(
        assertSafeUrl('https://evil.example.com/x', {
          resolver: staticResolver(['fe80::1']),
        }),
      ).rejects.toMatchObject({ kind: 'privateIpResolved' });
      await expect(
        assertSafeUrl('https://evil.example.com/x', {
          resolver: staticResolver(['fc00::1']),
        }),
      ).rejects.toMatchObject({ kind: 'privateIpResolved' });
    });

    it('rejects when the resolver throws', async () => {
      await expect(
        assertSafeUrl('https://youtu.be/abc', { resolver: throwingResolver }),
      ).rejects.toMatchObject({ kind: 'dnsResolutionFailed' });
    });

    it('rejects when the resolver returns zero addresses', async () => {
      await expect(
        assertSafeUrl('https://youtu.be/abc', { resolver: emptyResolver }),
      ).rejects.toMatchObject({ kind: 'dnsResolutionFailed' });
    });

    it('accepts a public-only resolution set', async () => {
      await expect(
        assertSafeUrl('https://youtu.be/abc', {
          resolver: staticResolver([
            '142.250.72.46',
            '2607:f8b0:4005:80a::200e',
          ]),
        }),
      ).resolves.toBeUndefined();
    });
  });
});
