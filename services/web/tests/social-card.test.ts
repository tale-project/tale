import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { socialCardTagMismatches } from '@tale/ui/testing/social-card';
import { describe, expect, it } from 'vitest';

const SHELL = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html');

describe('social card tags', () => {
  it('name the shared card at the size it is made at', () => {
    expect(socialCardTagMismatches(readFileSync(SHELL, 'utf8'))).toEqual([]);
  });
});
