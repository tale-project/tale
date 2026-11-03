// Identities against the real Camoufox build: that an identity resolves to the
// very same config on every launch is what these tests are for. Run with
// CAMOUFOX_INSTALL_DIR set to a directory that holds the build (never the
// default one, which belongs to other programs):
//
//   CAMOUFOX_INSTALL_DIR=/tmp/cf-spike/camoufox-install \
//     bunx --bun vitest --run --config vitest.camoufox.config.ts fingerprints

import { FingerprintGenerator } from 'fingerprint-generator';
import type { Fingerprint } from 'fingerprint-generator';
import { describe, expect, it } from 'vitest';

import {
  createIdentity,
  drawIdentity,
  resolvedConfig,
  signatures,
  summarize,
} from './fingerprints.ts';
import type { IdentityDeps } from './fingerprints.ts';
import { identityFromJson, identityToJson } from './types.ts';
import type { Identity, IdentityOs } from './types.ts';

const BOUND: [number, number] = [1728, 1117];
const OSES: readonly IdentityOs[] = ['windows', 'macos', 'linux'];
const PLATFORMS: Record<IdentityOs, RegExp> = {
  windows: /^Win32$/u,
  macos: /^MacIntel$/u,
  linux: /^Linux /u, // "Linux x86_64"
};
const SYSTEMS: Record<IdentityOs, RegExp> = {
  windows: /Windows NT/u,
  macos: /Macintosh/u,
  linux: /X11;.*Linux/u, // also "X11; Ubuntu; Linux x86_64"
};

/** Camoufox as it launches without anything of the identity pinned: everything it draws is drawn again. */
const unpinned: IdentityDeps = {
  launchOptions: async (options) => {
    const { launchOptions } = await import('camoufox-js');
    return launchOptions({ ...options, config: {}, webgl_config: undefined });
  },
};

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe.skipIf(!process.env.CAMOUFOX_INSTALL_DIR)(
  'identities with the installed Camoufox build',
  () => {
    describe.each(OSES)('a %s identity', (os) => {
      it('resolves to the same config on every launch, also as stored', async () => {
        const identity = await drawIdentity(os, BOUND);
        const stored = identityFromJson(identityToJson(identity));
        const first = await resolvedConfig(identity);
        for (let launch = 0; launch < 5; launch++) {
          expect(await resolvedConfig(stored)).toEqual(first);
          expect(await resolvedConfig(identity)).toEqual(first);
        }
        expect(signatures(await resolvedConfig(stored))).toEqual(
          signatures(first),
        );
      });

      it('is what it says it is', async () => {
        const { identity, summary } = await createIdentity(os, new Set(), {
          maxScreen: BOUND,
        });
        expect(identity.os).toBe(os);
        expect(summary.platform).toMatch(PLATFORMS[os]);
        expect(summary.userAgent).toMatch(SYSTEMS[os]);
        expect(summary.userAgent).toMatch(
          /rv:(\d+)\.0\) Gecko\/20100101 Firefox\/\1\.0$/u,
        );
        expect(summary.gpu).toBeTruthy();
        const [width, height] = (summary.screen ?? '').split('x').map(Number);
        expect(width).toBeLessThanOrEqual(BOUND[0]);
        expect(height).toBeLessThanOrEqual(BOUND[1]);
      });

      it('has pinned what Camoufox would draw on every launch', async () => {
        const identity = await drawIdentity(os, BOUND);
        expect(Object.keys(identity.pinned).sort()).toEqual([
          'audio:seed',
          'canvas:aaOffset',
          'canvas:seed',
          'fonts:spacing_seed',
          'window.history.length',
          'window.screenY',
        ]);
        const config = await resolvedConfig(identity);
        for (const [key, value] of Object.entries(identity.pinned)) {
          expect(config[key], key).toBe(value);
        }
        expect([config['webGl:vendor'], config['webGl:renderer']]).toEqual(
          identity.webgl,
        );
      });

      it('leaves nothing that Camoufox draws at random unpinned', async () => {
        // A future camoufox-js that draws one more value on every launch shows here.
        const identity = await drawIdentity(os, BOUND);
        const launches = await Promise.all(
          Array.from({ length: 40 }, () => resolvedConfig(identity, unpinned)),
        );
        const varying = Object.keys(launches[0]).filter(
          (key) =>
            new Set(launches.map((config) => JSON.stringify(config[key])))
              .size > 1,
        );
        expect(varying.length).toBeGreaterThan(0);
        for (const key of varying) {
          // the WebGL values all follow from the pair
          expect(key in identity.pinned || key.startsWith('webGl'), key).toBe(
            true,
          );
        }
        const pinned = await Promise.all(
          Array.from({ length: 40 }, () => resolvedConfig(identity)),
        );
        for (const config of pinned) expect(config).toEqual(pinned[0]);
      });

      it('would be another every launch without that', async () => {
        const identity = await drawIdentity(os, BOUND);
        const launches = await Promise.all(
          Array.from({ length: 10 }, () => resolvedConfig(identity, unpinned)),
        );
        const drawnAgain = (key: string) =>
          new Set(launches.map((config) => JSON.stringify(config[key]))).size >
          1;
        for (const key of [
          'audio:seed',
          'canvas:seed',
          'fonts:spacing_seed',
          'canvas:aaOffset',
        ]) {
          expect(drawnAgain(key), key).toBe(true);
        }
        // what is not drawn at random follows from the fingerprint
        expect(
          new Set(launches.map((config) => config['navigator.userAgent'])).size,
        ).toBe(1);
      });
    });

    it('differs from the other identities of its OS', async () => {
      const a = await createIdentity('windows', new Set(), {
        maxScreen: BOUND,
      });
      const b = await createIdentity(
        'windows',
        new Set([a.visibleSignature, a.fullSignature]),
        { maxScreen: BOUND },
      );
      expect(a.fullSignature).not.toBe(b.fullSignature);
      expect(a.visibleSignature).not.toBe(b.visibleSignature);
      expect(a.identity.pinned).not.toEqual(b.identity.pinned);
    });

    it('gives sessions drawn one after the other signatures that all differ', async () => {
      const taken = new Set<string>();
      for (let n = 0; n < 15; n++) {
        const created = await createIdentity(
          n % 3 === 0 ? 'macos' : 'windows',
          taken,
          { maxScreen: BOUND },
        );
        expect(taken.has(created.visibleSignature)).toBe(false);
        expect(taken.has(created.fullSignature)).toBe(false);
        taken.add(created.visibleSignature);
        taken.add(created.fullSignature);
      }
      expect(taken.size).toBe(30);
    });

    it('redraws when a signature is taken', async () => {
      const first = await drawIdentity('windows', BOUND);
      const other = await drawIdentity('windows', BOUND);
      const taken = new Set(signatures(await resolvedConfig(first)));
      const draws = [first, first, other];
      const created = await createIdentity('windows', taken, {
        maxScreen: BOUND,
        deps: { draw: () => Promise.resolve(draws.shift() ?? other) },
      });
      expect(created.identity).toEqual(other);
      expect(draws).toEqual([]);
    });

    it('keeps its language, which is no part of the signatures', async () => {
      const identity = await drawIdentity('windows', BOUND);
      const swiss: Identity = { ...identity, locale: 'de-CH' };
      const config = await resolvedConfig(swiss);
      expect(config).toMatchObject({
        'locale:language': 'de',
        'locale:region': 'CH',
      });
      for (let launch = 0; launch < 3; launch++) {
        expect(await resolvedConfig(swiss)).toEqual(config);
      }
      expect(signatures(config)).toEqual(
        signatures(await resolvedConfig(identity)),
      );
      expect(
        Object.keys(await resolvedConfig(identity)).filter((key) =>
          key.startsWith('locale:'),
        ),
      ).toEqual([]);
    });

    it('does not change the identity it resolves', async () => {
      const identity = await drawIdentity('linux', BOUND);
      const before = structuredClone(identity);
      await resolvedConfig(deepFreeze(structuredClone(identity)));
      expect(identity).toEqual(before);
      expect(summarize(await resolvedConfig(identity)).platform).toMatch(
        /^Linux /u,
      );
    });

    describe('a window on a second monitor', () => {
      // Camoufox draws its vertical position anew on every launch.
      function offscreen(): Fingerprint {
        const generator = new FingerprintGenerator({
          browsers: ['firefox'],
          operatingSystems: ['linux', 'macos', 'windows'],
        });
        const { fingerprint } = generator.getFingerprint({
          screen: { maxWidth: BOUND[0], maxHeight: BOUND[1] },
          operatingSystems: ['windows'],
        });
        fingerprint.screen = {
          ...fingerprint.screen,
          width: 1600,
          height: 900,
          screenX: 2552,
          availHeight: 900,
          outerHeight: 916,
        };
        return fingerprint;
      }

      it('keeps its position', async () => {
        const identity = await drawIdentity('windows', BOUND, {
          generate: offscreen,
        });
        expect(typeof identity.pinned['window.screenY']).toBe('number');
        const positions = new Set<unknown>();
        for (let launch = 0; launch < 10; launch++) {
          positions.add((await resolvedConfig(identity))['window.screenY']);
        }
        expect(positions).toEqual(new Set([identity.pinned['window.screenY']]));
      });

      it('would take another every launch without that', async () => {
        const identity = await drawIdentity('windows', BOUND, {
          generate: offscreen,
        });
        const positions = new Set<unknown>();
        for (let launch = 0; launch < 10; launch++) {
          positions.add(
            (await resolvedConfig(identity, unpinned))['window.screenY'],
          );
        }
        expect(positions.size).toBeGreaterThan(1);
      });
    });

    it('refuses a screen that no fingerprint fits', async () => {
      await expect(drawIdentity('windows', [1280, 720])).rejects.toThrow(
        'could not draw a windows fingerprint that fits a 1280x720 screen',
      );
    });
  },
);
