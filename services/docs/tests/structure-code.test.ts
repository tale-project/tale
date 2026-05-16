import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { extractCodeFences, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { walkDocs } from './lib/walk';

/**
 * Every fenced code block must declare a language identifier.
 *
 * From `.claude/skills/docs/SKILL.md` mechanics:
 *
 *   > Always carry a language identifier. ```bash, ```typescript, ```json —
 *   > never a bare ```. The renderer's syntax highlighter is keyed on the
 *   > identifier.
 *
 * A bare fence renders as unhighlighted monospace, which is fine for ASCII
 * diagrams but looks broken next to highlighted samples.
 *
 * Accepted: any non-empty identifier following the opening fence. We don't
 * try to enforce a closed list — `bash`, `sh`, `shell`, `console`, `text`,
 * `plaintext`, `markdown`, `mermaid`, `tsx`, etc. are all legitimate.
 */

describe('code fences', () => {
  it('every fenced block declares a language identifier', () => {
    const findings: Finding[] = [];
    for (const rel of walkDocs()) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { body } = parseFrontmatter(raw);
      // Offset every fence line by the number of frontmatter lines so the
      // reported line numbers point at the right place in the raw file.
      const frontmatterLines = raw.startsWith('---\n')
        ? raw.slice(0, raw.indexOf('\n---\n', 4) + 5).split('\n').length - 1
        : 0;
      for (const fence of extractCodeFences(body)) {
        if (!fence.lang) {
          findings.push({
            file: rel,
            line: fence.line + frontmatterLines,
            rule: 'code-fence-no-language',
            detail:
              'fenced code block opens without a language identifier (use ```bash, ```typescript, ```text — never bare ```)',
          });
        }
      }
    }
    assertNoFindings(findings, 'Code-fence issues');
  });
});
