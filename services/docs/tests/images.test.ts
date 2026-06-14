import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { parseFrontmatter } from './lib/markdown';
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
 *      is an accessibility hole (the conventions in
 *      `.agents/docs/SCREENSHOTS.md` require a full descriptive sentence).
 *   3. The file is under ~200KB. WebP screenshots compress well; a heavier
 *      file is almost always an un-optimised PNG that slipped through.
 *
 * Scope: only image links whose target starts with `/images/` are checked —
 * those are the convention-managed screenshots. Logos, favicons, and other
 * site chrome under `public/` are out of scope. Fenced code blocks are
 * stripped so an example reference inside a code sample does not trip the
 * check.
 *
 * Today no page references `/images/...`, so this test passes vacuously. It is
 * written to be correct the moment the first screenshot reference lands.
 */

const PUBLIC_ROOT = path.join(REPO_ROOT, 'services', 'docs', 'public');
const MAX_BYTES = 200 * 1024;

const FENCE_OPEN_OR_CLOSE = /^(\s*)(`{3,}|~{3,})/;
/** `![alt](target)` — captures the alt text and the target path. The target
 *  stops at the first whitespace so an optional `"title"` is excluded. */
const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;

interface ImageRef {
  file: string;
  line: number;
  alt: string;
  target: string;
}

/** Replace every fenced code block with blank lines so example image
 *  references inside code samples are not scanned. Line numbers stay stable. */
function stripFences(body: string): string {
  const out: string[] = [];
  let open: string | null = null;
  for (const line of body.split('\n')) {
    const m = FENCE_OPEN_OR_CLOSE.exec(line);
    if (m) {
      const marker = m[2];
      if (open === null) open = marker;
      else if (marker[0] === open[0] && marker.length >= open.length)
        open = null;
      out.push('');
      continue;
    }
    out.push(open !== null ? '' : line);
  }
  return out.join('\n');
}

/** Every `/images/...` image reference in one page, with 1-based line numbers
 *  that account for the frontmatter offset. */
function extractImageRefs(relFile: string): ImageRef[] {
  const raw = fs
    .readFileSync(path.join(CONTENT_ROOT, relFile), 'utf8')
    .replaceAll('\r\n', '\n');
  const { body } = parseFrontmatter(raw);
  const frontmatterLines =
    raw.length === body.length
      ? 0
      : raw.slice(0, raw.length - body.length).split('\n').length - 1;
  const lines = stripFences(body).split('\n');
  const out: ImageRef[] = [];
  for (let i = 0; i < lines.length; i++) {
    IMAGE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMAGE.exec(lines[i])) !== null) {
      const [, alt, target] = m;
      if (!target.startsWith('/images/')) continue;
      out.push({
        file: relFile,
        line: frontmatterLines + i + 1,
        alt: alt.trim(),
        target,
      });
    }
  }
  return out;
}

/** Resolve a `/images/...` target to its on-disk path under `public/`. */
function resolvePublic(target: string): string {
  return path.join(PUBLIC_ROOT, target.replace(/^\//, ''));
}

describe('docs image references', () => {
  it('every /images/... reference resolves, has alt text, and is reasonably sized', () => {
    const findings: Finding[] = [];
    for (const rel of walkDocs()) {
      for (const ref of extractImageRefs(rel)) {
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
});
