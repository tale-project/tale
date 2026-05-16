import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { extractOpeningProse, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { walkDocs } from './lib/walk';

/**
 * Every page opens with at least two sentences of prose between the
 * frontmatter and the first structural element (heading, list, table, fence).
 *
 * From `.claude/skills/docs/SKILL.md` Rule 2:
 *
 *   > The block of prose between the frontmatter and the first sub-heading,
 *   > list, table, or fenced code block contains at least two complete
 *   > sentences, and answers three questions: what is this, who is this for,
 *   > why does it exist.
 *
 * Sentence count is a heuristic — terminal punctuation in masked prose. Inline
 * code spans are masked first so embedded periods (`v1.2.3`, `tale deploy`)
 * don't count as sentence boundaries.
 *
 * Pages marked `kind: index` in frontmatter are exempt — these are locale-
 * root landing pages whose body is a curated grid of sub-pages.
 */

const SENTENCE_END = /[.!?](\s|$)/g;

function countSentences(prose: string): number {
  if (!prose) return 0;
  const cleaned = prose.replace(/`[^`]*`/g, ' ');
  const matches = cleaned.match(SENTENCE_END);
  if (matches) return matches.length;
  return cleaned.trim().length > 0 ? 1 : 0;
}

describe('opening paragraph', () => {
  it('every page opens with ≥2 sentences of prose before any heading/list/table/code', () => {
    const findings: Finding[] = [];
    for (const rel of walkDocs()) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { frontmatter, body } = parseFrontmatter(raw);
      if (/^kind:\s*index\b/m.test(frontmatter)) continue;
      const opening = extractOpeningProse(body);
      const sentences = countSentences(opening);
      if (sentences < 2) {
        findings.push({
          file: rel,
          line: 0,
          rule: 'opening-too-short',
          detail: `opening has ${sentences} sentence(s); needs ≥ 2 of prose before the first heading/list/table/code (covering what/who/why)`,
        });
      }
    }
    assertNoFindings(findings, 'Opening-paragraph issues');
  });
});
