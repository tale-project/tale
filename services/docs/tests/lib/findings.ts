import { expect } from 'vitest';

/**
 * Unified finding type + formatting for the docs test suite.
 *
 * Every test that scans pages for rule violations produces an array of
 * `Finding` records and asserts the array is empty. The formatter groups
 * findings by file so a failing test prints `<file>` once with the offending
 * lines indented underneath — much easier to scan than one finding per line
 * with the path repeated.
 *
 * Example failure output:
 *
 *   Voice findings (3):
 *   docs/en/platform/agents/concepts.md
 *       42: [softener-simply] "simply" — strike on sight; the demonstration carries it
 *       89: [softener-easy]  "easy"   — strike on sight; if it's easy, show it
 *   docs/en/develop/api-reference.md
 *       17: [softener-just]  "just"   — strike on sight; lets the reader feel rushed
 */
export interface Finding {
  /** Content-relative page path (`en/platform/agents/concepts.md`). */
  file: string;
  /** 1-based line number where the violation was found. `0` for whole-page
   *  findings (e.g. "page has no frontmatter"). */
  line: number;
  /** Short stable rule identifier, used as the bracketed prefix in the error
   *  message. Keep these dash-case and unique across the suite. */
  rule: string;
  /** Human-readable explanation. Free-form, ends with no trailing period. */
  detail: string;
}

/** Group findings by file and pretty-print them. The returned string ends
 *  with no trailing newline. */
function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return '(none)';
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }
  const lines: string[] = [];
  for (const [file, list] of byFile) {
    lines.push(file);
    list.sort((a, b) => a.line - b.line);
    for (const f of list) lines.push(`    ${f.line}: [${f.rule}] ${f.detail}`);
  }
  return lines.join('\n');
}

/**
 * Assert that the suite of findings is empty. The error message embeds the
 * formatted list and a top-line count so reviewers see the scale of the
 * failure before scrolling. Always call this through vitest's `expect` so
 * the assertion lands in the test report.
 */
export function assertNoFindings(findings: Finding[], label: string): void {
  expect(
    findings,
    `${label} (${findings.length}):\n${formatFindings(findings)}`,
  ).toEqual([]);
}
