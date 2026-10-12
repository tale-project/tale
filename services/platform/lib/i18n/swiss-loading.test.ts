import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  initServiceI18n,
  type PackageMessages,
} from '@tale/ui/i18n/init-service';
import { catalogsByLocale } from '@tale/ui/i18n/topic-catalogs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
type Bundle = Record<string, Record<string, unknown>>;
const platformCatalogs = catalogsByLocale(
  import.meta.glob<Record<string, unknown>>('../../messages/*/*.yml', {
    eager: true,
    import: 'default',
  }),
);
function catalog(dir: string, locale: string): Bundle {
  if (dir === 'services/platform/messages') {
    return platformCatalogs[locale] ?? {};
  }
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
      'services/platform/messages',
      [
        ['chat:budgetWarningDismiss', 'Schliessen'],
        ['conversations:bulk.close', 'Schliessen'],
        ['notifications:expand', 'Vergrössern'],
        ['common:flow.zoomIn', 'Vergrössern'],
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
  });
});
