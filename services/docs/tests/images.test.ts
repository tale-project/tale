import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import {
  extractImageRefs,
  iterProseLines,
  parseFrontmatter,
} from './lib/markdown';
import { CONTENT_ROOT, REPO_ROOT } from './lib/paths';
import { walkDocs } from './lib/walk';

/**
 * Every Markdown image that points into the shared image store must resolve to
 * a real, descriptive, reasonably-sized asset.
 *
 * Screenshots live under `services/docs/public/images/<section>/` and are
 * embedded as `![sentence-case alt](/images/<section>/<file>.webp)`. The docs
 * site serves `public/` at the site root, so `/images/...` in a page resolves
 * to `services/docs/public/images/...`. This test enforces the three things a
 * stale or sloppy reference gets wrong:
 *
 *   1. The referenced file exists under `public/`. A typo'd path renders a
 *      broken image in production.
 *   2. The alt text is non-empty. Screenshots carry information; a blank alt
 *      is an accessibility hole (the conventions in the write-docs skill —
 *      `builtin-configs/skills/write-docs/SCREENSHOTS.md` — and the repo
 *      facts in `docs/AGENTS.md` require a full descriptive sentence).
 *   3. The file is under ~200KB. WebP screenshots compress well; a heavier
 *      file is almost always an un-optimised PNG that slipped through.
 *
 * A second check bans raw `<img>` tags outright: images must use Markdown
 * `![alt](/images/...)` syntax (inside `<Frame>`) so the alt/size/existence
 * checks above — and the manifest sweep in `image-manifest.test.ts` — can't
 * be bypassed by an HTML tag the scanners don't parse.
 *
 * Scope: only image links whose target starts with `/images/` are checked
 * for existence/alt/size — those are the convention-managed screenshots.
 * Logos, favicons, and other site chrome under `public/` are out of scope.
 * Fenced code blocks are stripped so an example reference inside a code
 * sample does not trip either check.
 */

const PUBLIC_ROOT = path.join(REPO_ROOT, 'services', 'docs', 'public');
const MAX_BYTES = 200 * 1024;

interface PageImageRef {
  file: string;
  line: number;
  alt: string;
  target: string;
}

/** Number of raw-file lines the frontmatter block occupies (0 when absent),
 *  so body-relative line numbers can be reported against the raw page. */
function frontmatterOffset(raw: string, body: string): number {
  return raw.length === body.length
    ? 0
    : raw.slice(0, raw.length - body.length).split('\n').length - 1;
}

/** Every `/images/...` image reference in one page, with 1-based line numbers
 *  that account for the frontmatter offset. */
function extractPageImageRefs(relFile: string): PageImageRef[] {
  const raw = fs
    .readFileSync(path.join(CONTENT_ROOT, relFile), 'utf8')
    .replaceAll('\r\n', '\n');
  const { body } = parseFrontmatter(raw);
  const offset = frontmatterOffset(raw, body);
  return extractImageRefs(body)
    .filter((ref) => ref.target.startsWith('/images/'))
    .map((ref) => ({
      file: relFile,
      line: offset + ref.line,
      alt: ref.alt,
      target: ref.target,
    }));
}

/** Resolve a `/images/...` target to its on-disk path under `public/`. */
function resolvePublic(target: string): string {
  return path.join(PUBLIC_ROOT, target.replace(/^\//, ''));
}

describe('docs image references', () => {
  it('every /images/... reference resolves, has alt text, and is reasonably sized', () => {
    const findings: Finding[] = [];
    for (const rel of walkDocs()) {
      for (const ref of extractPageImageRefs(rel)) {
        if (ref.alt.length === 0) {
          findings.push({
            file: ref.file,
            line: ref.line,
            rule: 'image-empty-alt',
            detail: `image "${ref.target}" has empty alt text — write a full descriptive sentence`,
          });
        }

        const abs = resolvePublic(ref.target);
        if (!fs.existsSync(abs)) {
          findings.push({
            file: ref.file,
            line: ref.line,
            rule: 'image-target-missing',
            detail: `image target "${ref.target}" has no file at ${path.relative(REPO_ROOT, abs)}`,
          });
          continue;
        }

        const bytes = fs.statSync(abs).size;
        if (bytes > MAX_BYTES) {
          findings.push({
            file: ref.file,
            line: ref.line,
            rule: 'image-too-large',
            detail: `image "${ref.target}" is ${Math.round(bytes / 1024)}KB; optimise to under ${MAX_BYTES / 1024}KB (export as WebP)`,
          });
        }
      }
    }
    assertNoFindings(findings, 'Image-reference issues');
  });

  it('no raw <img> tags — images use markdown syntax inside <Frame>', () => {
    const findings: Finding[] = [];
    for (const rel of walkDocs()) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { body } = parseFrontmatter(raw);
      const offset = frontmatterOffset(raw, body);
      // iterProseLines strips fences/comments and masks inline code, so a
      // code sample or `<img>` mention in backticks doesn't trip the rule.
      for (const { line, text } of iterProseLines(body)) {
        if (!/<img\b/i.test(text)) continue;
        findings.push({
          file: rel,
          line: offset + line,
          rule: 'image-raw-img-tag',
          detail:
            'raw <img> tag — use markdown `![alt](/images/...)` inside <Frame> so alt/size/existence checks apply',
        });
      }
    }
    assertNoFindings(findings, 'Raw <img> tag issues');
  });
});
