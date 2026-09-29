import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import deMessages from '../../../messages/de.yml';
import enMessages from '../../../messages/en.yml';
import frMessages from '../../../messages/fr.yml';
import { listConnectorSummaries } from './connector_catalog';

/**
 * #3716: the Add credential picker offered fifteen connectors while the user
 * docs — the behaviour oracle a manual round judges against — and the manual
 * suite described thirteen. GlitchTip and Jev decisions appeared nowhere, and
 * the Instance URL guidance named only Confluence and Shopify. This holds the
 * pages to the listing the picker serves (`listConnectorSummaries`):
 *
 * - each locale's connector table names every connector the picker offers,
 *   by the name it shows, and nothing it does not;
 * - every connector whose credentials name their own instance is named
 *   where the overview explains the **Instance URL** and where the admin
 *   guide explains the instance address;
 * - the manual suite counts and lists the same picker.
 *
 * The docs pages are outside this workspace: `services/platform/turbo.json`
 * hashes them for this suite.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../..',
);

const catalogSchema = z.object({
  settings: z.object({
    connectors: z.object({
      dialog: z.object({ endpointUrl: z.string() }),
    }),
  }),
});

const LOCALES = {
  en: {
    messages: catalogSchema.parse(enMessages),
    // Where the admin guide explains the instance address.
    instanceAddress: 'Some connectors also require an instance address.',
  },
  de: {
    messages: catalogSchema.parse(deMessages),
    instanceAddress:
      'Manche Connectors benötigen zusätzlich die Adresse der Instanz.',
  },
  fr: {
    messages: catalogSchema.parse(frMessages),
    instanceAddress:
      'Certains connecteurs demandent aussi l’adresse de l’instance.',
  },
} as const;

const read = (repoPath: string) =>
  readFileSync(path.join(REPO_ROOT, repoPath), 'utf8');

/** The first cell of each row of the page's first table. */
function tableNames(page: string): string[] {
  const lines = page.split('\n');
  const separator = lines.findIndex((line) => /^\|\s*-{3,}/.test(line));
  if (separator < 1) return [];
  const names: string[] = [];
  for (const line of lines.slice(separator + 1)) {
    if (!line.startsWith('|')) break;
    names.push(line.split('|')[1]?.trim() ?? '');
  }
  return names;
}

/** The paragraph (a line of the page) that contains `needle`. */
const paragraphWith = (page: string, needle: string) =>
  page.split('\n').find((line) => line.includes(needle)) ?? '';

const shipped = listConnectorSummaries();
const byName = [...shipped].sort((a, b) => a.slug.localeCompare(b.slug));
const perCredential = shipped.filter(
  (connector) => connector.endpointMode === 'per-credential',
);

describe('the connector docs describe the catalog the picker offers', () => {
  it('lists a picker with GlitchTip and Jev decisions in it', () => {
    // A catalog that lost its files would pass the checks below vacuously.
    expect(shipped.map((connector) => connector.displayName)).toEqual(
      expect.arrayContaining(['GlitchTip', 'Jev decisions', 'Confluence']),
    );
  });

  for (const [locale, { messages, instanceAddress }] of Object.entries(
    LOCALES,
  )) {
    it(`docs/${locale}/platform/connectors/overview.md tables every offered connector`, () => {
      const page = read(`docs/${locale}/platform/connectors/overview.md`);
      expect([...tableNames(page)].sort()).toEqual(
        shipped.map((connector) => connector.displayName).sort(),
      );
    });

    it(`docs/${locale} names every per-credential connector beside its instance guidance`, () => {
      const label = messages.settings.connectors.dialog.endpointUrl;
      const overview = paragraphWith(
        read(`docs/${locale}/platform/connectors/overview.md`),
        `**${label}**`,
      );
      const admin = paragraphWith(
        read(`docs/${locale}/platform/admin/connectors.md`),
        instanceAddress,
      );
      for (const connector of perCredential) {
        expect({ page: 'overview', names: overview }).toEqual({
          page: 'overview',
          names: expect.stringContaining(connector.displayName),
        });
        expect({ page: 'admin', names: admin }).toEqual({
          page: 'admin',
          names: expect.stringContaining(connector.displayName),
        });
      }
    });
  }

  it('the manual connectors suite counts and names the same picker', () => {
    const suite = readFileSync(
      path.join(
        REPO_ROOT,
        'services/platform/tests/manual/suites/connectors.md',
      ),
      'utf8',
    );
    const offers = /picker offers \*\*(\d+)\*\* vendors:\s*([^.]+)\./.exec(
      suite,
    );
    expect(Number(offers?.[1])).toBe(shipped.length);
    const listed = (offers?.[2] ?? '')
      .replace(/\([^)]*\)/g, '')
      .split(',')
      .map((slug) => slug.trim());
    expect(listed).toEqual(byName.map((connector) => connector.slug));
    expect(suite).toContain(`${shipped.length} vendors in one list`);
  });
});
