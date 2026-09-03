/**
 * The e2e specs build locators from message keys (`tests/e2e/helpers/i18n.ts`),
 * so a key that is not in `messages/en.yml` fails inside Playwright — three
 * retries, a screenshot, and `messages key is not a string: <key>` buried in a
 * shard log. The `usage-missing` check in `messages.test.ts` cannot see these:
 * it only reads `t` aliases bound by `useT`/`useTranslation` to a known
 * namespace, and the e2e helper's `t` takes a whole key path instead.
 *
 * So resolve every static literal the specs pass to `t()` through the specs'
 * OWN resolver. Same function, same catalog — a missing key is named here in
 * milliseconds instead of costing a Playwright shard.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { t } from '../../tests/e2e/helpers/i18n';

const E2E_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../tests/e2e',
);

/** Static single-quoted `t('a.b')` arguments — dotted keys only. */
const T_CALL_RE = /\bt\(\s*'([a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)'/g;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && full.endsWith('.ts') ? [full] : [];
  });
}

const references = walk(E2E_DIR).flatMap((file) =>
  [...fs.readFileSync(file, 'utf8').matchAll(T_CALL_RE)].map((match) => ({
    key: match[1],
    file: path.relative(E2E_DIR, file),
  })),
);

describe('e2e message keys', () => {
  // A regex that stops matching would make every assertion below vacuous, so
  // pin a floor: the suite referenced far more than this when it was written.
  it('finds the specs’ key references', () => {
    expect(references.length).toBeGreaterThan(50);
  });

  it('resolves every referenced key against the base catalog', () => {
    const missing = [
      ...new Set(
        references
          .filter(({ key }) => {
            try {
              t(key);
              return false;
            } catch {
              return true;
            }
          })
          .map(({ key, file }) => `${key}  (${file})`),
      ),
    ].sort();

    expect(
      missing,
      `${missing.length} e2e locator key(s) missing from messages/en.yml — the spec would fail in Playwright as "messages key is not a string":\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });
});
