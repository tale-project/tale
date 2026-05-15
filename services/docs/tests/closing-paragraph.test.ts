import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONTENT_ROOT, walkDocs } from './_helpers';

/**
 * Every page should close with a real recap section, not a bare `## Next`
 * heading whose only content is a single link line.
 *
 * Two heuristics flag failures:
 *   1. The page's last heading is one of the stub names (`Next`, `Weiter`,
 *      `Suite`, `Suivant`, etc.) — closing sections should be named for what
 *      they do (`## Build one`, `## Where this gets used`).
 *   2. The body under the last heading collapses to a single link line.
 *
 * Currently runs warn-only — see opening-paragraph.test.ts for the rationale.
 */

type Finding = { file: string; reason: string };

const STUB_HEADINGS = new Set([
  'Next',
  'next',
  'Next steps',
  'What’s next',
  "What's next",
  'See also',
  'Weiter',
  'Nächste Schritte',
  'Naechste Schritte',
  'Siehe auch',
  'Suite',
  'Suivant',
  'Étapes suivantes',
  'Etapes suivantes',
  'Voir aussi',
]);

const SINGLE_LINK_LINE = /^\s*\[[^\]]+\]\([^)]+\)\.?\s*$/;

function parseFrontmatter(content: string): { body: string } {
  if (!content.startsWith('---\n')) return { body: content };
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return { body: content };
  return { body: content.slice(end + 5) };
}

function stripFences(body: string): string {
  // Remove fenced code blocks so a ``` inside the body doesn't confuse the heading walker.
  let out = '';
  let inFence = false;
  let marker: string | null = null;
  for (const line of body.split('\n')) {
    const m = /^\s*(```+|~~~+)/.exec(line);
    if (m) {
      const ch = m[1][0];
      if (!inFence) {
        inFence = true;
        marker = ch;
      } else if (ch === marker) {
        inFence = false;
        marker = null;
      }
      out += '\n';
      continue;
    }
    out += inFence ? '\n' : line + '\n';
  }
  return out;
}

function findLastHeading(
  body: string,
): { heading: string; bodyLines: string[] } | null {
  const stripped = stripFences(body);
  const lines = stripped.split('\n');
  let lastIdx = -1;
  let lastText = '';
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (m) {
      lastIdx = i;
      lastText = m[2].trim();
    }
  }
  if (lastIdx === -1) return null;
  const bodyLines = lines.slice(lastIdx + 1).filter((l) => l.trim().length > 0);
  return { heading: lastText, bodyLines };
}

const pages = walkDocs();

describe('docs closing paragraph (warn-only)', () => {
  it('found at least one page to lint', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it('warns when a page ends with a stub Next/See-also heading or a single-link closing', () => {
    const findings: Finding[] = [];
    for (const rel of pages) {
      const content = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { body } = parseFrontmatter(content);
      const last = findLastHeading(body);
      if (!last) continue;
      if (STUB_HEADINGS.has(last.heading)) {
        findings.push({
          file: rel,
          reason: `last heading is "${last.heading}" — name the closing section for what it does (e.g. "## Build one", "## Where this gets used").`,
        });
        continue;
      }
      if (
        last.bodyLines.length === 1 &&
        SINGLE_LINK_LINE.test(last.bodyLines[0])
      ) {
        findings.push({
          file: rel,
          reason: `closing section "${last.heading}" is a single link line; add a one-paragraph recap before the link.`,
        });
      }
    }
    const formatted = findings
      .map((f) => `  ${f.file}: ${f.reason}`)
      .join('\n');
    expect(
      findings,
      `closing-paragraph (${findings.length} page(s) below the bar):\n${formatted}`,
    ).toEqual([]);
  });
});
