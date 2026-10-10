// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SETTINGS_KINDS } from '@tale/shared/schemas/settings-kinds';
import { describe, expect, it } from 'vitest';

/**
 * The settings over MCP page (`docs/{en,de,fr}/develop/mcp-settings.md`)
 * tables every kind of setting under the heading `{#kinds}`, in apply
 * order, one kind per row in the first column. The table is written by
 * hand, so a kind that ships or leaves without its row fails here instead
 * of the page teaching kinds the endpoint does not serve. The pages are
 * outside this workspace: `services/platform/turbo.json` hashes them for
 * this suite.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

const LOCALES = ['en', 'de', 'fr'] as const;

/** The first backticked name of each row of the first table under the
 * heading `{#kinds}`. */
function tabledKinds(page: string): string[] {
  const lines = page.split('\n');
  const heading = lines.findIndex((line) =>
    /^#{2,4} .*\{#kinds\}\s*$/.test(line),
  );
  expect(heading, 'no heading {#kinds}').toBeGreaterThanOrEqual(0);
  const start = lines.findIndex(
    (line, index) => index > heading && line.startsWith('|'),
  );
  expect(start, 'no table under {#kinds}').toBeGreaterThan(heading);
  const rows: string[] = [];
  for (const line of lines.slice(start)) {
    if (!line.startsWith('|')) break;
    rows.push(line);
  }
  // The header row and its delimiter row name no kind.
  return rows.slice(2).map((row) => {
    const firstCell = row.split('|')[1] ?? '';
    return /`([a-z-]+)`/.exec(firstCell)?.[1] ?? firstCell.trim();
  });
}

describe('the settings over MCP page tables every kind', () => {
  it.each(LOCALES.map((locale) => [locale] as const))(
    'docs/%s/develop/mcp-settings.md names exactly the kinds served, in apply order',
    (locale) => {
      const page = readFileSync(
        path.join(REPO_ROOT, 'docs', locale, 'develop/mcp-settings.md'),
        'utf8',
      );
      expect(tabledKinds(page)).toEqual(
        SETTINGS_KINDS.map((descriptor) => descriptor.kind),
      );
    },
  );
});
