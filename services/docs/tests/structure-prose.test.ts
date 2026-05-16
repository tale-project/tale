import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { STATUS_CHATTER } from './data/status-chatter';
import { assertNoFindings, type Finding } from './lib/findings';
import { iterProseLines, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { walkDocs } from './lib/walk';

/**
 * Prose-level mechanics that apply across every locale:
 *
 *   1. **No exclamation marks in prose.** From `.claude/skills/docs/SKILL.md`:
 *      "Outside literal code (`!important`, `1 != 2`), an exclamation belongs
 *      in a marketing splash." Inline code is masked by `iterProseLines`, so
 *      the only `!` that survives is one in plain prose.
 *
 *   2. **No status chatter.** `Updated:`, `New in vX:`, `Coming soon:`,
 *      `TODO:`, `Note that…`, `Please note:` and locale equivalents. Each
 *      pattern in `data/status-chatter.ts` is anchored at line start.
 *
 * Both checks operate on already-masked prose (inline-code, URLs, fenced
 * blocks removed), so legitimate uses of `!` inside ` `1 != 2` ` or status
 * keywords inside fenced code samples don't trip the rule.
 */

const ALLOWED_BANG_CONTEXTS = [
  /!\s*=/, // != as in 1 != 2 (already inline-code-masked but defensive)
  /!important/i, // CSS-style declaration
  /\[![^\]]*\]/, // markdown image alt-text [!NOTE], [!WARNING] callouts
];

describe('prose mechanics', () => {
  it('no exclamation marks in prose', () => {
    const findings: Finding[] = [];
    for (const rel of walkDocs()) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { body } = parseFrontmatter(raw);
      for (const { line, text } of iterProseLines(body)) {
        if (!text.includes('!')) continue;
        if (ALLOWED_BANG_CONTEXTS.some((p) => p.test(text))) continue;
        // `!` followed by `[` is the link-image syntax — masked URLs will
        // still leave the `![alt]` prefix, which is not a real exclamation.
        if (/!\[/.test(text)) continue;
        findings.push({
          file: rel,
          line,
          rule: 'prose-exclamation',
          detail:
            'exclamation mark in prose — strike (belongs in marketing copy, not docs)',
        });
      }
    }
    assertNoFindings(findings, 'Exclamation-mark issues');
  });

  it('no status-chatter prefixes', () => {
    const findings: Finding[] = [];
    for (const rel of walkDocs()) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { body } = parseFrontmatter(raw);
      for (const { line, text } of iterProseLines(body)) {
        for (const entry of STATUS_CHATTER) {
          if (entry.pattern.test(text)) {
            findings.push({
              file: rel,
              line,
              rule: entry.id,
              detail: `status-chatter opener — ${entry.rationale}`,
            });
            break;
          }
        }
      }
    }
    assertNoFindings(findings, 'Status-chatter issues');
  });
});
