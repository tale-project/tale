/**
 * `markdown-anchor-parity` — every `#anchor` link target points to a real
 * heading. Locale-aware: slugs differ between languages.
 *
 * Report mode by default — anchor drift is structural debt, not a content
 * regression; flip to enforce once the corpus is clean.
 */

import fs from 'node:fs';
import path from 'node:path';

import { extractHeadingSlugs } from '../scanner/slug';
import type { Finding } from './types';
import { createCheck } from './types';

const LINK_WITH_ANCHOR = /\]\((\/?[^)#\s]+)?#([^)\s]+)\)/g;

export const markdownAnchorParity = createCheck({
  id: 'markdown-anchor-parity',
  scope: 'markdown',
  defaultMode: 'report',
  run(ctx) {
    if (!ctx.docsRoot) return [];
    const findings: Finding[] = [];
    // Build a lookup of file → known slugs lazily.
    const slugsByFile = new Map<string, ReadonlySet<string>>();

    for (const fragment of ctx.scanner.fragments({ surface: 'markdown' })) {
      if (fragment.disabled?.has('markdown-anchor-parity')) continue;
      // We need the raw line, but `fragment.text` is already mask-applied;
      // link URLs are masked. Re-read the file to get raw lines.
      // Cache raw file reads.
      const rawLine = readRawLine(fragment.pos.file, fragment.pos.line);
      if (!rawLine) continue;
      LINK_WITH_ANCHOR.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = LINK_WITH_ANCHOR.exec(rawLine)) !== null) {
        const targetPath = m[1] ?? '';
        const anchor = m[2];
        // Compute the target file. Empty target = same file.
        const targetFile = resolveTargetFile(
          ctx.docsRoot,
          fragment.pos.file,
          targetPath,
          fragment.locale,
        );
        if (!targetFile) continue;
        let slugs = slugsByFile.get(targetFile);
        if (!slugs) {
          if (!fs.existsSync(targetFile)) {
            slugsByFile.set(targetFile, new Set());
            continue;
          }
          const body = fs.readFileSync(targetFile, 'utf8');
          slugs = new Set(extractHeadingSlugs(body).keys());
          slugsByFile.set(targetFile, slugs);
        }
        if (!slugs.has(anchor)) {
          findings.push({
            file: fragment.pos.file,
            line: fragment.pos.line,
            column: fragment.pos.column + m.index,
            locale: fragment.locale,
            rule: 'anchor-missing',
            detail: `anchor "#${anchor}" not found in ${path.relative(ctx.docsRoot, targetFile)}`,
            suggest: 'check the heading slug; locale-specific',
          });
        }
      }
    }
    return findings;
  },
});

const rawLineCache = new Map<string, string[]>();
function readRawLine(relFile: string, line: number): string | null {
  let lines = rawLineCache.get(relFile);
  if (!lines) {
    const abs = path.resolve(process.cwd(), relFile);
    if (!fs.existsSync(abs)) return null;
    lines = fs.readFileSync(abs, 'utf8').split('\n');
    rawLineCache.set(relFile, lines);
  }
  return lines[line - 1] ?? null;
}

function resolveTargetFile(
  docsRoot: string,
  sourceRelFile: string,
  targetPath: string,
  locale: string,
): string | null {
  if (!targetPath) {
    // Same file.
    return path.resolve(process.cwd(), sourceRelFile);
  }
  // Strip leading slash and the locale prefix if present.
  const cleaned = targetPath
    .replace(/^\//, '')
    .replace(new RegExp(`^${locale}/`), '');
  const candidate = path.join(docsRoot, locale, `${cleaned}.md`);
  return candidate;
}
