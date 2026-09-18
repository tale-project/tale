/**
 * Markdown walker — emits one `Fragment` per prose line.
 *
 * Pipeline: read file → strip frontmatter (preserving line numbers) →
 * strip fenced-code blocks (preserving line numbers) → per-line mask
 * (inline code, link URLs, ICU placeholders). Blank lines and lines that
 * become empty after masking still emit a fragment so checks that count
 * per-line context (rare) see the full structure; callers that only care
 * about non-empty content filter trivially.
 *
 * Frontmatter is parsed for per-page opt-out fields: `noCurrencyCheck`,
 * `noEmDashCheck`, and `i18nLintExclude` (array of check ids). These are
 * surfaced on each fragment as `disabled: Set<CheckId>`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { applyMarkdownMasks, stripFences, stripFrontmatter } from './mask';
import type { Fragment, MarkdownSource } from './types';

/** Read + parse + mask a markdown source; emit one Fragment per line. */
export function scanMarkdown(
  source: MarkdownSource,
  repoRoot: string,
): Fragment[] {
  const raw = fs.readFileSync(source.path, 'utf8');
  const { frontmatter, body } = stripFrontmatter(raw);
  const disabled = parseFrontmatterDisables(frontmatter);
  const fenceless = stripFences(body);
  const lines = fenceless.split('\n');
  const relFile = path.relative(repoRoot, source.path);

  const out: Fragment[] = [];
  for (let i = 0; i < lines.length; i++) {
    const masked = applyMarkdownMasks(lines[i]);
    out.push({
      pos: { file: relFile, line: i + 1, column: 1 },
      text: masked,
      key: null,
      surface: 'markdown',
      locale: source.locale,
      disabled,
    });
  }
  return out;
}

/**
 * Extract per-check opt-outs from frontmatter YAML.
 *
 * Recognises:
 *   - `noCurrencyCheck: true`     → disables `style-currency`
 *   - `noEmDashCheck: true`       → disables `style-em-dash`
 *   - `i18nLintExclude: ["x","y"]` → disables every listed check id
 */
function parseFrontmatterDisables(
  yaml: string,
): ReadonlySet<string> | undefined {
  if (!yaml) return undefined;
  const disabled = new Set<string>();
  if (/^noCurrencyCheck\s*:\s*true\s*$/m.test(yaml))
    disabled.add('style-currency');
  if (/^noEmDashCheck\s*:\s*true\s*$/m.test(yaml))
    disabled.add('style-em-dash');
  const excludeMatch = /^i18nLintExclude\s*:\s*\[([^\]]*)\]/m.exec(yaml);
  if (excludeMatch) {
    for (const m of excludeMatch[1].matchAll(/['"]([^'"]+)['"]/g))
      disabled.add(m[1]);
  }
  // Also support YAML list form:
  // i18nLintExclude:
  //   - foo
  //   - bar
  const blockMatch = /^i18nLintExclude\s*:\s*\n((?:\s+-\s+[^\n]+\n?)+)/m.exec(
    yaml,
  );
  if (blockMatch) {
    for (const m of blockMatch[1].matchAll(
      /^\s+-\s+['"]?([^\n'"]+?)['"]?\s*$/gm,
    ))
      disabled.add(m[1]);
  }
  return disabled.size > 0 ? disabled : undefined;
}
