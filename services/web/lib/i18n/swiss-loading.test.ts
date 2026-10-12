import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  initServiceI18n,
  type PackageMessages,
} from '@tale/ui/i18n/init-service';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
type Bundle = Record<string, Record<string, unknown>>;
function catalog(dir: string, locale: string): Bundle {
  return parse(
    readFileSync(path.join(ROOT, dir, `${locale}.yml`), 'utf8'),
  ) as Bundle;
}
function packageMessages(dir: string): PackageMessages {
  return {
    bundles: Object.fromEntries(
      ['en', 'de', 'fr', 'de-CH'].map((locale) => [
        locale,
        catalog(dir, locale),
      ]),
    ),
  };
}

describe('Swiss catalog loading', () => {
  it.each([
    [
      'services/web/messages',
      [
        [
          'home:tagline.pillars.selfHosted.title',
          'Standardmässig selbst gehostet',
        ],
        ['home:demos.arena.replyA3', null],
        ['home:faq.onPrem.a', null],
      ],
    ],
  ] as const)('resolves %s through de-CH → de → en', async (dir, controls) => {
    const instance = initServiceI18n({
      bundles: {
        en: catalog(dir, 'en'),
        de: catalog(dir, 'de'),
        fr: catalog(dir, 'fr'),
      },
      regional: { '../../messages/de-CH.yml': catalog(dir, 'de-CH') },
      packages: [packageMessages('packages/ui/src/i18n/messages')],
    });
    await instance.changeLanguage('de-CH');
    for (const [key, label] of controls) {
      const german = instance.t(key, { lng: 'de' });
      expect(german).toContain('ß');
      expect(instance.t(key)).toBe(german.replaceAll('ß', 'ss'));
      if (label) expect(instance.t(key)).toBe(label);
    }
    // Array overrides replace the entire list. Retain its other cards and
    // every field while correcting the entries that need Swiss spelling.
    for (const key of [
      'platformAgents:tour.stages',
      'platformAutomations:capabilities.items',
      'platformGovernance:capabilities.items',
      'platformGovernance:faq.items',
      'platformProjects:faq.items',
    ]) {
      const german = instance.t(key, { lng: 'de', returnObjects: true });
      expect(instance.t(key, { returnObjects: true })).toEqual(
        JSON.parse(JSON.stringify(german).replaceAll('ß', 'ss')),
      );
    }
  });
});
