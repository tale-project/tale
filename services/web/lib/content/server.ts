import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUPPORTED_LOCALES } from '@tale/ui/i18n/locales';

import {
  MARKETING_CONTENT_CATEGORIES,
  visibleMarketingContent,
  type MarketingContentDocument,
} from './model';
import { parseMarketingContent } from './parse';

const CONTENT_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../app/content',
);

/** File-backed view of the same model used by the client manifest. Reading
 * afresh also makes a dev artifact request reflect content publication edits. */
export function readMarketingContent(): MarketingContentDocument[] {
  return MARKETING_CONTENT_CATEGORIES.flatMap((category) =>
    SUPPORTED_LOCALES.flatMap((locale) => {
      const directory = join(CONTENT_ROOT, category, locale);
      return readdirSync(directory)
        .filter((name) => name.endsWith('.md'))
        .sort()
        .map((name) => {
          const file = join(directory, name);
          return parseMarketingContent(readFileSync(file, 'utf8'), file);
        });
    }),
  );
}

/** Discovery always excludes drafts, independent of dev preview settings. */
export function publishedMarketingContent() {
  return visibleMarketingContent(readMarketingContent());
}
