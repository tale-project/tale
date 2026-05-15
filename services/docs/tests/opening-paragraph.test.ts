import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONTENT_ROOT, walkDocs } from './_helpers';

/**
 * Every page should open with at least two sentences of prose between the
 * frontmatter and the first sub-heading, list, table, or fenced code block.
 *
 * Catches the failure mode the rewrite is trying to eliminate: pages that
 * open with one sentence followed immediately by a list. See the docs skill
 * at `.agents/docs/AGENTS.md` for the rule and the worked examples.
 *
 * Pages marked `kind: index` in their frontmatter are exempt — those are the
 * locale-root landing pages whose body is a curated grid of sub-pages.
 *
 * Currently runs warn-only: the rewrite drops finding counts as it
 * progresses. The Phase 6 flip swaps `console.warn` for
 * `expect(findings).toEqual([])`.
 */

type Finding = { file: string; reason: string };

const SENTENCE_END = /[.!?](\s|$)/g;

function parseFrontmatter(content: string): {
  frontmatter: string;
  body: string;
} {
  if (!content.startsWith('---\n')) return { frontmatter: '', body: content };
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return { frontmatter: '', body: content };
  return {
    frontmatter: content.slice(4, end),
    body: content.slice(end + 5),
  };
}

function isStructuralLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return false;
  if (trimmed.startsWith('#')) return true; // any heading
  if (/^[-*+]\s+/.test(trimmed)) return true; // bullet list
  if (/^\d+\.\s+/.test(trimmed)) return true; // numbered list
  if (trimmed.startsWith('|')) return true; // table
  if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) return true;
  if (trimmed.startsWith('>')) return false; // blockquote = prose
  return false;
}

function extractOpeningProse(body: string): string {
  // Skip a leading H1 if present (matches the title pattern).
  const lines = body.split('\n');
  let i = 0;
  // Skip blank lines at the start.
  while (i < lines.length && lines[i].trim() === '') i++;
  // If first non-blank line is H1, skip it and following blanks.
  if (i < lines.length && /^#\s+\S/.test(lines[i])) {
    i++;
    while (i < lines.length && lines[i].trim() === '') i++;
  }
  // Collect lines until the first structural marker.
  const prose: string[] = [];
  while (i < lines.length) {
    if (isStructuralLine(lines[i])) break;
    prose.push(lines[i]);
    i++;
  }
  return prose.join('\n').trim();
}

function countSentences(prose: string): number {
  if (!prose) return 0;
  // Replace inline code spans so embedded periods don't count as sentence
  // boundaries (e.g. `tale deploy` or `v1.2.3`).
  const cleaned = prose.replace(/`[^`]*`/g, ' ');
  const matches = cleaned.match(SENTENCE_END);
  if (matches) return matches.length;
  // Single sentence with no terminal punctuation still counts as one.
  return cleaned.trim().length > 0 ? 1 : 0;
}

const pages = walkDocs();

describe('docs opening paragraph (warn-only)', () => {
  it('found at least one page to lint', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it('warns when a page opens with fewer than two sentences before any heading, list, table, or code block', () => {
    const findings: Finding[] = [];
    for (const rel of pages) {
      const content = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { frontmatter, body } = parseFrontmatter(content);
      // Exempt landing-grid pages.
      if (/^kind:\s*index\b/m.test(frontmatter)) continue;
      const opening = extractOpeningProse(body);
      const sentences = countSentences(opening);
      if (sentences < 2) {
        findings.push({
          file: rel,
          reason: `opening has ${sentences} sentence(s); needs at least 2 of prose before the first heading/list/table/code block.`,
        });
      }
    }
    const formatted = findings
      .map((f) => `  ${f.file}: ${f.reason}`)
      .join('\n');
    expect(
      findings,
      `opening-paragraph (${findings.length} page(s) below the bar):\n${formatted}`,
    ).toEqual([]);
  });
});
