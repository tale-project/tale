import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { VOICE_STRIKE_EN } from './data/voice-strike-en';
import { assertNoFindings, type Finding } from './lib/findings';
import { parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { runStrikes } from './lib/rules';
import { localeOf, walkDocs } from './lib/walk';

/**
 * English voice — strike list of marketing softeners.
 *
 * From `.claude/skills/docs/SKILL.md` §"Twelve words to strike":
 *   simply, easy, powerful, seamless, just, please, feel free to,
 *   discover, unleash, effortlessly, straightforward, intuitive.
 *
 * Plus the auxiliary forms (`easily`, `seamlessly`) from
 * `.agents/terminology/TERMINOLOGY_EN.md`.
 *
 * Scans only `docs/en/**`. The strike list is English-specific — the DE
 * and FR equivalents live in their own test files.
 */

describe('English voice', () => {
  it('no marketing softeners in docs/en/**', () => {
    const findings: Finding[] = [];
    const pages = walkDocs().filter((rel) => localeOf(rel) === 'en');

    for (const rel of pages) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { body } = parseFrontmatter(raw);
      findings.push(...runStrikes(VOICE_STRIKE_EN, body, rel));
    }

    assertNoFindings(findings, 'English voice issues');
  });
});
