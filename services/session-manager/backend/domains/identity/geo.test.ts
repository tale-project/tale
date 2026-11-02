import {
  InvalidLocale,
  UnknownIPLocation,
  UnknownTerritory,
} from 'camoufox-js/dist/exceptions.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FIREFOX_LANGUAGES,
  chooseLocale,
  countryOf,
  lookup,
  parseTerritoryLanguages,
  pickLocale,
} from './geo.ts';
import type { Geolocation, TerritoryLanguage } from './geo.ts';
import { GeoLookupError } from './types.ts';

// The module is imported when it is first needed, as the app sets the install
// directory of camoufox-js first.
const camoufox = vi.hoisted(() => ({ loads: 0, getGeolocation: vi.fn() }));
vi.mock('camoufox-js/dist/locale.js', () => {
  camoufox.loads += 1;
  return { getGeolocation: camoufox.getGeolocation };
});

/** A repeatable stand-in for `Math.random` (mulberry32). */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every pick the language rule can make for a country, by walking the whole range of `random`. */
function possiblePicks(country: string | null): Set<string> {
  const picks = new Set<string>();
  for (let step = 0; step < 2000; step++) {
    picks.add(pickLocale(country, () => step / 2000));
  }
  return picks;
}

afterEach(() => {
  vi.restoreAllMocks();
  camoufox.getGeolocation.mockReset();
});

/** The GeoLookupError that the promise rejects with. */
async function failureOf(promise: Promise<unknown>): Promise<GeoLookupError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GeoLookupError) return error;
    throw error;
  }
  throw new Error('expected the lookup to reject');
}

const ZURICH: Geolocation = {
  locale: { region: 'CH' },
  timezone: 'Europe/Zurich',
  latitude: 47.37,
  longitude: 8.54,
};

describe('camoufox-js', () => {
  it('is only imported when an address is looked up', async () => {
    expect(camoufox.loads).toBe(0);
    pickLocale('CH');
    await expect(lookup('not-an-ip')).rejects.toBeInstanceOf(GeoLookupError);
    expect(camoufox.loads).toBe(0);

    camoufox.getGeolocation.mockResolvedValue(ZURICH);
    const geo = await lookup('85.1.0.1', { random: () => 0 });
    expect(camoufox.loads).toBe(1);
    expect(camoufox.getGeolocation).toHaveBeenCalledExactlyOnceWith('85.1.0.1');
    expect(geo).toMatchObject({ country: 'CH', locale: 'de-CH' });

    expect(await countryOf('85.1.0.1')).toBe('CH');
    expect(camoufox.loads).toBe(1);
  });
});

describe('FIREFOX_LANGUAGES', () => {
  it('has the languages that Firefox ships as UI locales', () => {
    for (const code of ['en', 'de', 'fr', 'it', 'es', 'ja', 'zh', 'ru', 'pt']) {
      expect(FIREFOX_LANGUAGES.has(code), code).toBe(true);
    }
  });

  it('leaves out what real Firefox users almost never send', () => {
    for (const code of ['gsw', 'lmo', 'rm', 'cy', 'ga', 'und', 'zh_Hant']) {
      expect(FIREFOX_LANGUAGES.has(code), code).toBe(false);
    }
  });

  it('holds plain lowercase language codes', () => {
    expect(FIREFOX_LANGUAGES.size).toBe(58);
    for (const code of FIREFOX_LANGUAGES) expect(code).toMatch(/^[a-z]{2}$/);
  });
});

describe('pickLocale', () => {
  const draws = (country: string | null, count = 400) =>
    new Set(Array.from({ length: count }, () => pickLocale(country)));

  it('gives Switzerland one of its official Firefox languages', () => {
    // Camoufox's own pick also yields Swiss German (gsw), Lombard (lmo) and Portuguese (pt).
    expect(draws('CH')).toEqual(new Set(['de-CH', 'fr-CH', 'it-CH']));
    expect(possiblePicks('CH')).toEqual(new Set(['de-CH', 'fr-CH', 'it-CH']));
  });

  it.each([
    ['US', 'en-US'], // Spanish and Hawaiian are only official in some states
    ['GB', 'en-GB'], // Welsh, Irish and Scottish Gaelic too
    ['DE', 'de-DE'],
    ['AT', 'de-AT'],
    ['ES', 'es-ES'],
    ['TW', 'zh-TW'], // "zh_Hant" in CLDR
    ['CN', 'zh-CN'],
    ['MN', 'kk-MN'], // no official language Firefox ships: the most-spoken one that it does
    ['TF', 'fr-TF'],
    ['AQ', 'en-US'], // no language data at all
    ['BV', 'en-US'],
    ['QQ', 'en-US'], // not a territory
    ['', 'en-US'],
    [null, 'en-US'],
  ])('gives %j the language %j and nothing else', (country, locale) => {
    expect(draws(country, 50)).toEqual(new Set([locale]));
    expect(possiblePicks(country)).toEqual(new Set([locale]));
  });

  it.each([
    ['BE', ['nl-BE', 'fr-BE', 'de-BE']],
    ['CA', ['en-CA', 'fr-CA']],
    ['HK', ['zh-HK', 'en-HK']],
    ['IL', ['he-IL', 'ar-IL']],
    ['IN', ['hi-IN', 'en-IN']],
    ['LU', ['fr-LU', 'de-LU']],
    ['SG', ['en-SG', 'zh-SG', 'ms-SG', 'ta-SG']],
  ])('gives %j one of its official languages', (country, locales) => {
    expect(possiblePicks(country)).toEqual(new Set(locales));
  });

  it('keeps the country as it is given', () => {
    expect(pickLocale('ch')).toBe('en-US');
    expect(pickLocale('JP')).toBe('ja-JP');
    expect(possiblePicks('XK')).toEqual(new Set(['sq-XK', 'sr-XK']));
  });

  it('weights the pick by population share', () => {
    const random = seeded(7);
    const picked = Array.from({ length: 2000 }, () => pickLocale('CH', random));
    const count = (locale: string) => picked.filter((l) => l === locale).length;
    expect(count('de-CH')).toBeGreaterThan(count('fr-CH'));
    expect(count('fr-CH')).toBeGreaterThan(count('it-CH'));
    expect(count('it-CH')).toBeGreaterThan(0);
    // 73 : 21 : 4.3 of 98.3
    expect(count('de-CH') / 2000).toBeCloseTo(0.7426, 1);
    expect(count('fr-CH') / 2000).toBeCloseTo(0.2136, 1);
  });

  it('picks by the draw: the shares of the languages divide the range', () => {
    // 73 / 98.3 of the range is German, the next 21 / 98.3 French, the rest Italian
    const at = (draw: number) => pickLocale('CH', () => draw);
    expect(at(0)).toBe('de-CH');
    expect(at(0.74)).toBe('de-CH');
    expect(at(0.75)).toBe('fr-CH');
    expect(at(0.95)).toBe('fr-CH');
    expect(at(0.96)).toBe('it-CH');
    expect(at(0.999999)).toBe('it-CH');
  });

  it('counts the same language twice when the country lists it twice', () => {
    // Bosnia lists Bosnian in two scripts: the weights add up, the pick is one language
    const picks = possiblePicks('BA');
    expect(picks).toEqual(new Set(['bs-BA', 'hr-BA', 'sr-BA']));
  });

  it('asks the draw once for a country with several official languages', () => {
    const random = vi.fn(() => 0.5);
    pickLocale('CH', random);
    expect(random).toHaveBeenCalledTimes(1);
  });

  it('does not draw for a country without an official language it can use', () => {
    const random = vi.fn(() => 0.5);
    expect(pickLocale('MN', random)).toBe('kk-MN');
    expect(pickLocale('AQ', random)).toBe('en-US');
    expect(pickLocale(null, random)).toBe('en-US');
    expect(random).not.toHaveBeenCalled();
  });
});

describe('chooseLocale', () => {
  const language = (
    code: string,
    populationPercent: number,
    official = false,
  ): TerritoryLanguage => ({ code, populationPercent, official });

  it('draws among the official languages by their share', () => {
    const languages = [
      language('de', 70, true),
      language('en', 90),
      language('fr', 30, true),
    ];
    const at = (draw: number) => chooseLocale('XX', languages, () => draw);
    expect(at(0)).toBe('de-XX');
    expect(at(0.69)).toBe('de-XX');
    expect(at(0.71)).toBe('fr-XX');
    expect(at(0.999)).toBe('fr-XX');
  });

  it('ends at the last official language for a draw at the very end of the range', () => {
    const languages = [language('de', 1, true), language('fr', 1, true)];
    expect(chooseLocale('XX', languages, () => 1)).toBe('fr-XX');
  });

  it('draws evenly among official languages that have no share', () => {
    const languages = [language('de', 0, true), language('fr', 0, true)];
    expect(chooseLocale('XX', languages, () => 0)).toBe('de-XX');
    expect(chooseLocale('XX', languages, () => 0.49)).toBe('de-XX');
    expect(chooseLocale('XX', languages, () => 0.5)).toBe('fr-XX');
  });

  it('takes the most-spoken language without an official one, the first of equals', () => {
    const random = vi.fn(() => 0.5);
    const languages = [
      language('de', 5),
      language('fr', 9),
      language('it', 9),
      language('en', 1),
    ];
    expect(chooseLocale('XX', languages, random)).toBe('fr-XX');
    expect(
      chooseLocale('XX', [language('de', 0), language('fr', 0)], random),
    ).toBe('de-XX');
    expect(random).not.toHaveBeenCalled();
  });

  it('gives en-US to a country without languages', () => {
    expect(chooseLocale('XX', [], () => 0)).toBe('en-US');
  });
});

describe('parseTerritoryLanguages', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE territoryInfo>
<!-- a comment -->
<territoryInfo>
  <territory type="CH" literacyPercent="99" population="8860570">
    <languagePopulation type="de" populationPercent="73" officialStatus="official"/>
    <languagePopulation type="gsw" populationPercent="65" officialStatus="de_facto_official"/>
    <languagePopulation type="fr" populationPercent="21" officialStatus="de_facto_official"/>
    <languagePopulation type="es" populationPercent="9.6" officialStatus="official_regional"/>
    <languagePopulation type="zh_Hant" populationPercent="1.5"/>
    <languagePopulation type="ja"/>
  </territory>
  <territory type="AQ"><languagePopulation type="und" populationPercent="100"/></territory>
  <territory type="BV"/>
</territoryInfo>`;

  it('keeps the languages that Firefox ships, with their share and status', () => {
    const territories = parseTerritoryLanguages(xml);
    expect([...territories.keys()]).toEqual(['CH', 'AQ', 'BV']);
    expect(territories.get('CH')).toEqual([
      { code: 'de', populationPercent: 73, official: true },
      { code: 'fr', populationPercent: 21, official: true },
      { code: 'es', populationPercent: 9.6, official: false },
      { code: 'zh', populationPercent: 1.5, official: false },
      { code: 'ja', populationPercent: 0, official: false },
    ]);
  });

  it('keeps a territory without languages as an empty list', () => {
    const territories = parseTerritoryLanguages(xml);
    expect(territories.get('AQ')).toEqual([]);
    expect(territories.get('BV')).toEqual([]);
  });

  it('refuses text that is not the territory data', () => {
    expect(() => parseTerritoryLanguages('<territoryInfo><oops>')).toThrow();
    expect(() => parseTerritoryLanguages('<other/>')).toThrow();
    expect(() => parseTerritoryLanguages('')).toThrow();
  });
});

describe('lookup', () => {
  it('describes the place of the IP, with a language of its country', async () => {
    const getGeolocation = vi.fn(() => Promise.resolve(ZURICH));
    const geo = await lookup('85.1.0.1', { getGeolocation, random: () => 0 });
    expect(geo).toEqual({
      country: 'CH',
      locale: 'de-CH',
      timezone: 'Europe/Zurich',
      latitude: 47.37,
      longitude: 8.54,
    });
    expect(getGeolocation).toHaveBeenCalledExactlyOnceWith('85.1.0.1');
  });

  it('draws the language again every time', async () => {
    const getGeolocation = () => Promise.resolve(ZURICH);
    const locale = async (draw: number) =>
      (await lookup('85.1.0.1', { getGeolocation, random: () => draw })).locale;
    expect(await locale(0.1)).toBe('de-CH');
    expect(await locale(0.8)).toBe('fr-CH');
    expect(await locale(0.99)).toBe('it-CH');
  });

  it('gives en-US to a place without a country', async () => {
    const geo = await lookup('85.1.0.1', {
      getGeolocation: () => Promise.resolve({ ...ZURICH, locale: {} }),
    });
    expect(geo.country).toBeNull();
    expect(geo.locale).toBe('en-US');
  });

  it('answers an IPv6 address', async () => {
    const getGeolocation = vi.fn(() => Promise.resolve(ZURICH));
    await lookup('2001:4860:4860::8888', { getGeolocation });
    expect(getGeolocation).toHaveBeenCalledExactlyOnceWith(
      '2001:4860:4860::8888',
    );
  });

  it.each(['', 'not-an-ip', '999.1.1.1', '1.2.3', '8.8.8.8 ', '8.8.8.8/24'])(
    'does not look up %j, which is no IP address',
    async (ip) => {
      const getGeolocation = vi.fn(() => Promise.resolve(ZURICH));
      await expect(lookup(ip, { getGeolocation })).rejects.toThrow(
        new GeoLookupError(`the GeoIP database has no location for ${ip}`),
      );
      expect(getGeolocation).not.toHaveBeenCalled();
    },
  );

  it('is a GeoLookupError when the database has no location for the IP', async () => {
    const cause = new UnknownIPLocation('Unknown IP location: 1.1.1.1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failure = await failureOf(
      lookup('1.1.1.1', { getGeolocation: () => Promise.reject(cause) }),
    );
    expect(failure.name).toBe('GeoLookupError');
    expect(failure.message).toBe(
      'the GeoIP database has no location for 1.1.1.1',
    );
    expect(failure.cause).toBe(cause);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an IP that the database does not know (camoufox-js reads .country of null)',
      new TypeError("null is not an object (evaluating 'resp.country')"),
    ],
    ['a territory without data', new UnknownTerritory('Unknown territory: XX')],
    ['an invalid locale', new InvalidLocale('Invalid locale')],
  ])('expects %s, without a word in the log', async (_why, cause) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      lookup('203.0.113.1', { getGeolocation: () => Promise.reject(cause) }),
    ).rejects.toThrow('the GeoIP database has no location for 203.0.113.1');
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs what it did not expect and still answers with a GeoLookupError', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cause = new Error(
      'Failed to fetch releases from https://api.github.com/x after 5 attempts',
    );
    const failure = await failureOf(
      lookup('8.8.8.8', { getGeolocation: () => Promise.reject(cause) }),
    );
    expect(failure.message).toBe(
      'the GeoIP database has no location for 8.8.8.8',
    );
    expect(failure.cause).toBe(cause);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'GeoIP lookup of 8.8.8.8 failed: Failed to fetch releases from https://api.github.com/x after 5 attempts',
    );
  });

  it('looks up one address at a time', async () => {
    // camoufox-js reads the whole database for every lookup
    let running = 0;
    let most = 0;
    const done: string[] = [];
    const getGeolocation = async (ip: string) => {
      running += 1;
      most = Math.max(most, running);
      try {
        for (let turn = 0; turn < 5; turn++) await Promise.resolve();
        if (ip.endsWith('.13')) throw new Error('database damaged');
        done.push(ip);
        return ZURICH;
      } finally {
        running -= 1;
      }
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ips = Array.from({ length: 6 }, (_, n) => `85.1.0.${10 + n}`);
    const outcomes = await Promise.allSettled(
      ips.map((ip) => lookup(ip, { getGeolocation })),
    );
    expect(most).toBe(1);
    // the lookup that failed did not hold up those after it
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'rejected',
      'fulfilled',
      'fulfilled',
    ]);
    expect(done).toEqual(ips.filter((ip) => !ip.endsWith('.13')));
  });

  it('also copes with a lookup that throws at once or rejects with a non-error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      lookup('8.8.8.8', {
        getGeolocation: () => {
          throw new Error('boom');
        },
      }),
    ).rejects.toBeInstanceOf(GeoLookupError);
    await expect(
      lookup('8.8.8.8', { getGeolocation: () => Promise.reject('plain text') }),
    ).rejects.toBeInstanceOf(GeoLookupError);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(
      'GeoIP lookup of 8.8.8.8 failed: plain text',
    );
  });
});

describe('countryOf', () => {
  it('is the country of the IP', async () => {
    expect(
      await countryOf('85.1.0.1', {
        getGeolocation: () => Promise.resolve(ZURICH),
      }),
    ).toBe('CH');
  });

  it('is null for a place without a country', async () => {
    expect(
      await countryOf('85.1.0.1', {
        getGeolocation: () => Promise.resolve({ ...ZURICH, locale: {} }),
      }),
    ).toBeNull();
  });

  it('is null, and says why at info level, when the database cannot place the IP', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const getGeolocation = () =>
      Promise.reject(new UnknownIPLocation('Unknown IP location: 1.1.1.1'));
    expect(await countryOf('1.1.1.1', { getGeolocation })).toBeNull();
    expect(info).toHaveBeenCalledExactlyOnceWith(
      'no GeoIP country for 1.1.1.1: the GeoIP database has no location for 1.1.1.1',
    );
  });

  it('is null for something that is no IP address', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const getGeolocation = vi.fn(() => Promise.resolve(ZURICH));
    expect(await countryOf('proxy.example', { getGeolocation })).toBeNull();
    expect(getGeolocation).not.toHaveBeenCalled();
  });

  it('never rejects, whatever goes wrong', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const failure of [
      () => Promise.reject(new Error('database download failed')),
      () => Promise.reject('plain text'),
      () => Promise.reject(undefined),
      () => {
        throw new TypeError('broken');
      },
    ]) {
      expect(
        await countryOf('8.8.8.8', { getGeolocation: failure }),
      ).toBeNull();
    }
  });
});
