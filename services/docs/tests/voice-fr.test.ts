import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { VOICE_STRIKE_FR } from './data/voice-strike-fr';
import { assertNoFindings, type Finding } from './lib/findings';
import { parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { runStrikes } from './lib/rules';
import { localeOf, walkDocs } from './lib/walk';

/**
 * French voice — strike list of marketing softeners.
 *
 * Doctrine: `.agents/terminology/TERMINOLOGY_FR.md` §1 strike-on-sight table.
 *
 * No "bureaucracy drift" equivalent for French — the FR drift modes
 * (nominal stacks, vous-slips) are caught by other tests: `vous` lands in
 * `terminology-pronouns.test.ts`, and nominal stacking is too contextual
 * for a regex.
 *
 * Scans only `docs/fr/**`.
 */

describe('French voice', () => {
  it('no marketing softeners in docs/fr/**', () => {
    const findings: Finding[] = [];
    const pages = walkDocs().filter((rel) => localeOf(rel) === 'fr');

    for (const rel of pages) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { body } = parseFrontmatter(raw);
      findings.push(...runStrikes(VOICE_STRIKE_FR, body, rel));
    }

    assertNoFindings(findings, 'French voice issues');
  });
});
