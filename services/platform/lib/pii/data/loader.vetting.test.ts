// @vitest-environment node

/**
 * The registry vets every shipped national-ID pattern at boot and DROPS the
 * ones that fail — a compile error or a safe-regex2 rejection — so one bad
 * spec cannot take the whole registry down. Fail-open is the right runtime
 * posture, but it makes a broken spec invisible: the detector simply never
 * fires, and the only trace is a `console.warn` on a stream the dev loop used
 * to collapse. `es/co-cc` had been dropped that way, unnoticed.
 *
 * The runtime keeps failing open. This is the build-time half: a spec that
 * would be dropped fails here, where someone is looking. A spec we have
 * decided to ship dropped has to say so, in `KNOWN_DROPPED`, with its reason.
 */

import safe from 'safe-regex2';
import { describe, expect, it } from 'vitest';

import { loadPiiData } from './loader';

/**
 * Specs the registry drops today, ACCEPTED as dropped until someone decides
 * otherwise. Every entry is a detector that ships and never fires.
 *
 * `es/co-cc` — Colombian cédula, `\b\d{1,3}(?:\.\d{3}){2,3}\b`. safe-regex2
 * counts the nested bounded repeat and refuses it, though nothing in the
 * pattern can backtrack catastrophically. It cannot simply be rewritten:
 *   - the alternation form `(?:\d{1,3}\.\d{3}\.\d{3}\.\d{3}|\d{1,3}\.\d{3}\.\d{3})`
 *     passes safe-regex2, but it matches `14.159.265` inside a version string
 *     like `3.14.159.265` — `\b` cannot see the dot to its left;
 *   - the left boundary needs a lookbehind, and safe-regex2 rejects EVERY
 *     lookbehind, including `(?<!x)abc`.
 * So under this gate a correct cédula pattern is not expressible, and masking
 * version numbers would be worse than the detector staying dark. Resolving it
 * is a policy call — relax the gate for provably bounded patterns, move to a
 * real ReDoS analyser, or drop the detector on purpose — not a rewrite.
 */
const KNOWN_DROPPED = new Set(['es/co-cc']);

describe('the shipped pii locale data', () => {
  const { locales } = loadPiiData();

  it('ships at least one locale, so an empty read cannot pass silently', () => {
    expect(locales.length).toBeGreaterThan(0);
  });

  it('drops no national-ID pattern we have not accounted for', () => {
    const dropped: string[] = [];
    for (const locale of locales) {
      for (const spec of locale.nationalIds) {
        const key = `${locale.locale}/${spec.id}`;
        try {
          void new RegExp(spec.pattern);
        } catch {
          dropped.push(`${key}: does not compile`);
          continue;
        }
        if (!safe(spec.pattern)) dropped.push(`${key}: fails safe-regex2`);
      }
    }

    expect(dropped.map((d) => d.split(':')[0])).toEqual([...KNOWN_DROPPED]);
  });

  it('keeps KNOWN_DROPPED honest — every entry is really still dropped', () => {
    // An entry that starts passing must be removed from the list, or the list
    // stops describing the shipped state and starts hiding the next drop.
    for (const key of KNOWN_DROPPED) {
      const [code, id] = key.split('/');
      const spec = locales
        .find((l) => l.locale === code)
        ?.nationalIds.find((s) => s.id === id);
      expect(spec, `${key} is listed but no longer ships`).toBeDefined();
      expect(
        safe(spec!.pattern),
        `${key} passes now — drop it from the list`,
      ).toBe(false);
    }
  });
});
