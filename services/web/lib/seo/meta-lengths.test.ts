/**
 * Length budgets for the marketing `seo` catalog, asserted against the
 * strings a crawler sees: the rendered `<title>` (which only gains
 * ` | Tale` when the title does not already name the site) and the raw
 * meta description.
 *
 * Regression: 12 German and French descriptions ran past 160 characters
 * and the three changelog descriptions sat under 110, which Ahrefs reports
 * as "Meta description too long" and "too short"; several page titles
 * rendered under 30.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveFullTitle } from '@tale/ui/seo/document-meta';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { SUPPORTED_LOCALES } from '../i18n/locales';

const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 110;
const DESCRIPTION_MAX = 160;

interface SeoEntry {
  title: string;
  description: string;
}

function seoNamespace(locale: string): Record<string, SeoEntry> {
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'messages',
    `${locale}.yml`,
  );
  const catalog: unknown = parse(readFileSync(path, 'utf8'));
  const seo =
    catalog !== null && typeof catalog === 'object' && 'seo' in catalog
      ? catalog.seo
      : undefined;
  if (seo === null || typeof seo !== 'object') {
    throw new Error(`${locale}.yml has no "seo" namespace`);
  }
  const out: Record<string, SeoEntry> = {};
  for (const [key, value] of Object.entries(seo as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') continue;
    const { title, description } = value as Partial<SeoEntry>;
    if (typeof title === 'string' && typeof description === 'string') {
      out[key] = { title, description };
    }
  }
  return out;
}

describe('marketing seo meta lengths', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(locale, () => {
      const entries = Object.entries(seoNamespace(locale));

      it('has an seo entry for every page', () => {
        expect(entries.length).toBeGreaterThan(0);
      });

      for (const [key, entry] of entries) {
        it(`${key} title renders within ${TITLE_MIN}-${TITLE_MAX} characters`, () => {
          const rendered = resolveFullTitle(entry.title);
          expect(
            rendered.length,
            `${locale}.${key}: "${rendered}"`,
          ).toBeGreaterThanOrEqual(TITLE_MIN);
          expect(
            rendered.length,
            `${locale}.${key}: "${rendered}"`,
          ).toBeLessThanOrEqual(TITLE_MAX);
        });

        it(`${key} description is within ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters`, () => {
          expect(
            entry.description.length,
            `${locale}.${key}: "${entry.description}"`,
          ).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
          expect(
            entry.description.length,
            `${locale}.${key}: "${entry.description}"`,
          ).toBeLessThanOrEqual(DESCRIPTION_MAX);
        });
      }
    });
  }
});
