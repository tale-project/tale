// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The reviews that wait on a person who lost project access are handed on by
 * a step that the boot sequence installs (`installReviewHandoverHook`) into
 * the removal cascade and the role door. `auth/membership.ts` and
 * `domains/members/service.ts` are the low-level layer that the sign-in code,
 * the CLI's type-check program and the UI suites' hashed inputs all reach, so
 * a static import of the tasks domain from either drags the tasks,
 * collaboration and governance modules into all three. Two things keep that
 * honest: the layer stays free of the tasks domain, and every process that
 * runs those doors installs the step. A door without it removes the access
 * and leaves the reviews waiting on someone who can no longer take them.
 */

const BACKEND = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../backend',
);

const read = (file: string): string =>
  readFileSync(path.join(BACKEND, file), 'utf8');

describe('the access-loss hook', () => {
  it.each(['auth/membership.ts', 'domains/members/service.ts'])(
    'keeps %s free of the tasks domain',
    (file) => {
      const imports = [...read(file).matchAll(/from\s+'([^']+)'/g)].map(
        (match) => match[1] ?? '',
      );
      expect(imports.filter((source) => /(^|\/)tasks\//.test(source))).toEqual(
        [],
      );
    },
  );

  it.each(['main.ts', 'integration-check.ts'])(
    'is installed by %s before it serves or runs a lane',
    (file) => {
      const source = read(file);
      expect(source).toMatch(
        /import \{[^}]*\binstallReviewHandoverHook\b[^}]*\} from '\.\/domains\/tasks\/reviews\.ts'/,
      );
      expect(source).toContain('installReviewHandoverHook();');
    },
  );
});
