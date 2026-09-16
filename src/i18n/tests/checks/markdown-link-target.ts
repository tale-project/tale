/**
 * `markdown-link-target` — every relative or absolute-path link target
 * resolves to a file that exists on disk. Catches links to pages that were
 * planned-but-not-yet-written, removed without sweeping callers, or
 * mistyped slugs.
 *
 * Matches `](/path/to/page)` and `](/path/to/page#anchor)`. External URLs
 * (`http(s)://`, `mailto:`, anchor-only `(#x)`) are skipped. Links to
 * non-`.md` assets are skipped — this check is about docs page targets,
 * not arbitrary attachments.
 */

import fs from 'node:fs';
import path from 'node:path';

import { escapeRegex } from '../internals/regex';
import type { Finding } from './types';
import { createCheck } from './types';

const LINK = /\]\(([^)\s]+?)(#[^)\s]*)?\)/g;

export const markdownLinkTarget = createCheck({
  id: 'markdown-link-target',
  scope: 'markdown',
  defaultMode: 'enforce',
  run(ctx) {
    if (!ctx.docsRoot) return [];
    const findings: Finding[] = [];
    const existsCache = new Map<string, boolean>();

    for (const fragment of ctx.scanner.fragments({ surface: 'markdown' })) {
      if (fragment.disabled?.has('markdown-link-target')) continue;
      const rawLine = readRawLine(fragment.pos.file, fragment.pos.line);
      if (!rawLine) continue;
      LINK.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = LINK.exec(rawLine)) !== null) {
        const url = m[1];
        if (!isDocsPageLink(url)) continue;
        const targetFile = resolveTargetFile(
          ctx.docsRoot,
          url,
          fragment.locale,
        );
        if (!targetFile) continue;
        let exists = existsCache.get(targetFile);
        if (exists === undefined) {
          exists = fs.existsSync(targetFile);
          existsCache.set(targetFile, exists);
        }
        if (!exists) {
          findings.push({
            file: fragment.pos.file,
            line: fragment.pos.line,
            column: fragment.pos.column + m.index,
            locale: fragment.locale,
            rule: 'link-target-missing',
            detail: `link target "${url}" resolves to ${path.relative(ctx.docsRoot, targetFile)} which does not exist`,
            suggest: 'write the page or remove the link',
          });
        }
      }
    }
    return findings;
  },
});

/**
 * Only check links that look like docs page slugs:
 *   - relative or absolute paths (not external URLs, not anchor-only)
 *   - no file extension (the docs site rewrites `/path` to `/path.md`)
 */
function isDocsPageLink(url: string): boolean {
  if (url.startsWith('http://') || url.startsWith('https://')) return false;
  if (url.startsWith('mailto:')) return false;
  if (url.startsWith('#')) return false;
  // Skip links with file extensions (e.g. `screenshots/x.png`, `foo.svg`).
  // Markdown links to `.md` files are unusual in this corpus; the convention
  // is extension-less slugs.
  if (/\.[a-z0-9]{1,5}$/i.test(url)) return false;
  return true;
}

function resolveTargetFile(
  docsRoot: string,
  targetPath: string,
  locale: string,
): string | null {
  // Strip leading slash and locale prefix if present so `/de/cloud/billing`
  // and `cloud/billing` both resolve to `<docsRoot>/<locale>/cloud/billing.md`.
  const cleaned = targetPath
    .replace(/^\//, '')
    .replace(new RegExp(`^${escapeRegex(locale)}/`), '');
  if (!cleaned) return null;
  return path.join(docsRoot, locale, `${cleaned}.md`);
}

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
