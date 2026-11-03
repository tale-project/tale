// The GeoIP database of the installed Camoufox build, as camoufox-js reads it.
// Run with CAMOUFOX_INSTALL_DIR set to a directory that holds the database
// (never the default one, which belongs to other programs); it is downloaded
// into it when missing:
//
//   CAMOUFOX_INSTALL_DIR=/tmp/cf-spike/camoufox-install \
//     bunx --bun vitest --run --config vitest.camoufox.config.ts geo.camoufox

import { describe, expect, it } from 'vitest';

import { countryOf, lookup } from './geo.ts';
import { GeoLookupError } from './types.ts';

// Addresses of the documentation ranges (RFC 5737) and of loopback belong to
// nobody: the database has no record for them.
const UNKNOWN_IPS = ['192.0.2.1', '198.51.100.7', '203.0.113.1', '127.0.0.1'];

describe.skipIf(!process.env.CAMOUFOX_INSTALL_DIR)(
  'the GeoIP database of the installed build',
  () => {
    it('places a US address', async () => {
      const geo = await lookup('8.8.8.8');
      expect(geo.country).toBe('US');
      expect(geo.locale).toBe('en-US');
      expect(() =>
        Intl.DateTimeFormat('en', { timeZone: geo.timezone }),
      ).not.toThrow();
      expect(geo.latitude).toBeGreaterThan(24);
      expect(geo.latitude).toBeLessThan(72);
      expect(geo.longitude).toBeLessThan(-66);
    });

    it('places a Swiss address, in one of the languages of Switzerland', async () => {
      const languages = new Set<string>();
      for (let n = 0; n < 60; n++) {
        const geo = await lookup('85.1.0.1');
        expect(geo.country).toBe('CH');
        expect(geo.timezone).toBe('Europe/Zurich');
        expect(geo.latitude).toBeGreaterThan(45);
        expect(geo.latitude).toBeLessThan(48);
        languages.add(geo.locale);
      }
      // never Swiss German (gsw), which camoufox-js picks itself
      expect(
        [...languages].every((l) => ['de-CH', 'fr-CH', 'it-CH'].includes(l)),
      ).toBe(true);
      expect(languages.has('de-CH')).toBe(true);
    });

    it('places an IPv6 address', async () => {
      const geo = await lookup('2001:4860:4860::8888');
      expect(geo.country).toBe('US');
    });

    it.each(UNKNOWN_IPS)(
      'has no location for %s, an address that nobody has',
      async (ip) => {
        const failure = await lookup(ip).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(GeoLookupError);
        expect(failure).toHaveProperty(
          'message',
          `the GeoIP database has no location for ${ip}`,
        );
      },
    );

    it('has no location for an address that the database lists without one', async () => {
      await expect(lookup('1.1.1.1')).rejects.toThrow(
        'the GeoIP database has no location for 1.1.1.1',
      );
    });

    it.each(['not-an-ip', '999.1.1.1', ''])(
      'has no location for %j, which is no address',
      async (ip) => {
        await expect(lookup(ip)).rejects.toBeInstanceOf(GeoLookupError);
      },
    );

    it('gives the country of an address, or null', async () => {
      expect(await countryOf('8.8.8.8')).toBe('US');
      expect(await countryOf('85.1.0.1')).toBe('CH');
      for (const ip of [...UNKNOWN_IPS, '1.1.1.1', 'proxy.example']) {
        expect(await countryOf(ip), ip).toBeNull();
      }
    });

    it('answers many lookups at once', async () => {
      const countries = await Promise.all(
        Array.from({ length: 24 }, (_, n) =>
          countryOf(n % 2 ? '8.8.8.8' : '85.1.0.1'),
        ),
      );
      expect(countries).toEqual(
        Array.from({ length: 24 }, (_, n) => (n % 2 ? 'US' : 'CH')),
      );
    });
  },
);
