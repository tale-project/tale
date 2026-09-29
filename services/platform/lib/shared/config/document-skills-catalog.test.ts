// @vitest-environment node

/**
 * A new project agent preselects the document skills by slug. Those slugs
 * only mean something while the builtin custom catalog ships a bundle under
 * each of them, so renaming or removing one of those bundles must fail here
 * rather than quietly leave new agents with nothing ticked.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DOCUMENT_SKILL_SLUGS } from '@/app/features/projects/lib/document-skills';

const BUILTIN_SKILLS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../configs/platform/custom/skills',
);

describe('DOCUMENT_SKILL_SLUGS', () => {
  it.each(DOCUMENT_SKILL_SLUGS)(
    'names a bundle the builtin custom catalog carries: %s',
    (slug) => {
      expect(existsSync(path.join(BUILTIN_SKILLS, slug, 'SKILL.md'))).toBe(
        true,
      );
    },
  );
});
