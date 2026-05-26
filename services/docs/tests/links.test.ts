import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { BASE_LOCALES, walkDocs } from './lib/walk';

/**
 * Every relative or absolute-path Markdown link in the docs corpus must
 * resolve to a real `.md`/`.mdx` file. Catches links to pages that were
 * planned-but-not-written, removed without sweeping callers, or mistyped.
 *
 * Scope rules:
 *   - External URLs (`http(s)://`, `mailto:`) are skipped.
 *   - Anchor-only links (`#section`) are skipped — that's
 *     `markdown-anchor-parity` territory.
 *   - Links with file extensions (e.g. `screenshots/x.png`, `foo.svg`)
 *     are skipped; this check is about docs page slugs, not arbitrary
 *     assets.
 *   - Fenced code blocks are stripped so example links in code samples
 *     don't trip the check.
 *
 * Absolute paths are interpreted relative to `docs/<locale>/`, matching
 * how the docs site resolves them at runtime (`/cloud/billing` in an
 * `en/` page resolves to `docs/en/cloud/billing.md`).
 */

const FENCE_OPEN_OR_CLOSE = /^(\s*)(`{3,}|~{3,})/;
const LINK = /\]\(([^)\s]+?)(?:#[^)\s]*)?\)/g;

interface LinkRef {
  file: string;
  line: number;
  url: string;
}

function stripFences(body: string): string {
  const out: string[] = [];
  let openMarker: string | null = null;
  for (const line of body.split('\n')) {
    const m = FENCE_OPEN_OR_CLOSE.exec(line);
    if (m) {
      const marker = m[2];
      if (openMarker === null) {
        openMarker = marker;
        out.push('');
        continue;
      }
      if (marker[0] === openMarker[0] && marker.length >= openMarker.length) {
        openMarker = null;
        out.push('');
        continue;
      }
      out.push('');
      continue;
    }
    out.push(openMarker !== null ? '' : line);
  }
  return out.join('\n');
}

function isDocsPageLink(url: string): boolean {
  if (url.startsWith('http://') || url.startsWith('https://')) return false;
  if (url.startsWith('mailto:')) return false;
  if (url.startsWith('#')) return false;
  if (/\.[a-z0-9]{1,5}$/i.test(url)) return false;
  return true;
}

function resolveTargetFile(url: string, locale: string): string {
  // Strip leading slash and locale prefix so `/de/cloud/billing` and
  // `cloud/billing` both resolve to `docs/<locale>/cloud/billing`.
  const cleaned = url.replace(/^\//, '').replace(new RegExp(`^${locale}/`), '');
  return path.join(CONTENT_ROOT, locale, cleaned);
}

function targetExists(base: string): boolean {
  return (
    fs.existsSync(`${base}.md`) ||
    fs.existsSync(`${base}.mdx`) ||
    fs.existsSync(path.join(base, 'index.md')) ||
    fs.existsSync(path.join(base, 'index.mdx'))
  );
}

function extractLinks(relFile: string): LinkRef[] {
  const abs = path.join(CONTENT_ROOT, relFile);
  const raw = fs.readFileSync(abs, 'utf8');
  const { body } = parseFrontmatter(raw);
  const cleanBody = stripFences(body);
  const out: LinkRef[] = [];
  const lines = cleanBody.split('\n');
  // Body starts after frontmatter; track the offset so line numbers match
  // the raw file.
  const frontmatterLines =
    raw.length === body.length
      ? 0
      : raw.slice(0, raw.length - body.length).split('\n').length - 1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    LINK.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LINK.exec(line)) !== null) {
      const url = m[1];
      if (!isDocsPageLink(url)) continue;
      out.push({
        file: relFile,
        line: frontmatterLines + i + 1,
        url,
      });
    }
  }
  return out;
}

describe('markdown link targets', () => {
  it.each(BASE_LOCALES)(
    'every relative-path link under %s/ resolves to a real page',
    (locale) => {
      const localePrefix = locale + path.sep;
      const pages = walkDocs().filter((p) => p.startsWith(localePrefix));
      const findings: Finding[] = [];
      for (const page of pages) {
        for (const link of extractLinks(page)) {
          const target = resolveTargetFile(link.url, locale);
          if (targetExists(target)) continue;
          findings.push({
            file: link.file,
            line: link.line,
            rule: 'link-target-missing',
            detail: `link target "${link.url}" resolves to ${path.relative(CONTENT_ROOT, target)} which does not exist`,
          });
        }
      }
      assertNoFindings(findings, `Broken page links under ${locale}/`);
    },
  );
});
