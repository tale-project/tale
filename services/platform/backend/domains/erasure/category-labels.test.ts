/**
 * An erasure receipt counts what each pass of the cascade removed under the
 * pass's own name (`counts[name]`), and the request drawer labels each count
 * from the catalog (`dataSubjectRequests.categories.<name>`), showing the
 * bare name where no label exists. Every pass the cascade runs needs its
 * label, in every full locale.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MESSAGES = path.resolve(HERE, '../../../messages');

const PASSES = [
  ...readFileSync(path.join(HERE, 'service.ts'), 'utf8').matchAll(
    /await pass\('([A-Za-z]+)'/g,
  ),
].map((match) => match[1] ?? '');

const catalogSchema = z.object({
  dataSubjectRequests: z.object({
    categories: z.record(z.string(), z.string()),
  }),
});

describe('the erasure receipt’s categories', () => {
  it('are the passes the cascade runs', () => {
    expect(PASSES.length).toBeGreaterThan(10);
    expect(PASSES).toContain('threads');
    expect(PASSES).toContain('auditScrub');
  });

  it.each(['en', 'de', 'fr'])('are each labelled in %s', (locale) => {
    const { categories } = catalogSchema.parse(
      parse(
        readFileSync(path.join(MESSAGES, locale, 'governance.yml'), 'utf8'),
      ),
    ).dataSubjectRequests;
    expect(PASSES.filter((name) => !(name in categories))).toEqual([]);
  });
});
