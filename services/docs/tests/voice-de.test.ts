import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { VOICE_BUREAUCRACY_DE } from './data/voice-bureaucracy-de';
import { VOICE_STRIKE_DE } from './data/voice-strike-de';
import { assertNoFindings, type Finding } from './lib/findings';
import { parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { runDriftRules, runStrikes } from './lib/rules';
import { localeOf, walkDocs } from './lib/walk';

/**
 * German voice — two layers:
 *
 *   1. **Strike list** (`data/voice-strike-de.ts`) — marketing softeners that
 *      fail on sight regardless of context: `einfach`, `bequem`, `nahtlos`,
 *      `intuitiv`, `Entdecke`, …
 *
 *   2. **Bureaucracy drift rules** (`data/voice-bureaucracy-de.ts`) —
 *      positional/contextual drift: `Wird X…` passive present openers,
 *      sentence-final `erfolgreich`, `Damit` sentence opener, common literal
 *      calques.
 *
 * Doctrine: `.agents/terminology/TERMINOLOGY_DE.md` §1 (strike list) and §2
 * anti-patterns 1, 2, 3, 5 (bureaucracy + calques).
 *
 * Runs against both `docs/de/**` and `docs/de-CH/**` — Swiss German inherits
 * the same voice rules with only spelling overrides on top.
 */

describe('German voice', () => {
  it('no marketing softeners or bureaucracy drift in docs/de/** and docs/de-CH/**', () => {
    const findings: Finding[] = [];
    const pages = walkDocs().filter((rel) => {
      const loc = localeOf(rel);
      return loc === 'de' || loc === 'de-CH';
    });

    for (const rel of pages) {
      const locale = localeOf(rel);
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { body } = parseFrontmatter(raw);
      findings.push(...runStrikes(VOICE_STRIKE_DE, body, rel));
      findings.push(...runDriftRules(VOICE_BUREAUCRACY_DE, body, rel, locale));
    }

    assertNoFindings(findings, 'German voice issues');
  });
});
