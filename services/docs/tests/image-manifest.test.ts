import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { extractImageRefs, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT, REPO_ROOT } from './lib/paths';
import { walkDocs } from './lib/walk';
import { webpSize } from './lib/webp-size';

/**
 * Every screenshot ships with its manifest entry, its page reference, and
 * the DPR-2 dimension contract — or it doesn't ship.
 *
 * The capture pipeline (`bun run docs:screenshots`,
 * source `services/platform/tests/docs-screenshots/`) emits
 * `services/docs/public/images/manifest.json` as `{ entries: [...] }`: one
 * entry per image mapping the `public/`-relative file to the shot name,
 * route, viewport, and DPR it was captured with. The manifest is what makes
 * a screenshot reproducible — when the UI changes, grep the manifest for the
 * route and regenerate. This test locks the contract from four sides:
 *
 *   1. Every `*.webp` on disk under `public/images/` appears in the
 *      manifest. A hand-made image has no home here — by design; capture it
 *      through the pipeline instead.
 *   2. Every manifest entry's file exists on disk (no stale entries).
 *   3. Every on-disk image is referenced by at least one docs page — an
 *      orphaned screenshot is dead weight in every clone.
 *   4. Dimensions honour the DPR-2 contract: actual width ≤ 2880 and even
 *      (2× a whole CSS pixel), and the manifest's width/height match the
 *      file's real WebP header (`lib/webp-size.ts`).
 *
 * Scope: `*.webp` only. The logo SVGs already under `public/images/` are
 * site chrome, not captured screenshots. When neither a manifest nor any
 * `.webp` exists (today's state) the test passes vacuously; per-reference
 * existence/alt/size checks live in `images.test.ts`.
 */

const PUBLIC_ROOT = path.join(REPO_ROOT, 'services', 'docs', 'public');
const IMAGES_ROOT = path.join(PUBLIC_ROOT, 'images');
const MANIFEST_PATH = path.join(IMAGES_ROOT, 'manifest.json');
const MANIFEST_REL = path.relative(REPO_ROOT, MANIFEST_PATH);
const CAPTURE_COMMAND = 'bun run docs:screenshots';
/** DPR-2 capture of a 1440-wide viewport. */
const MAX_WIDTH = 2880;

/** All `*.webp` files under `public/images/`, as `public/`-relative
 *  forward-slash paths (`images/<section>/<shot>.webp`) matching the
 *  manifest's `file` field and the pages' `/images/...` targets. */
function walkWebp(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkWebp(full, out);
      continue;
    }
    if (entry.name.endsWith('.webp')) {
      out.push(path.relative(PUBLIC_ROOT, full).split(path.sep).join('/'));
    }
  }
  return out;
}

/** Every `/images/...` target referenced by any docs page in any locale, as
 *  `public/`-relative paths. Shares the extraction with `images.test.ts` so
 *  "referenced" means the same thing in both sweeps. */
function referencedImageTargets(): Set<string> {
  const out = new Set<string>();
  for (const rel of walkDocs()) {
    const raw = fs
      .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
      .replaceAll('\r\n', '\n');
    const { body } = parseFrontmatter(raw);
    for (const ref of extractImageRefs(body)) {
      if (ref.target.startsWith('/images/')) out.add(ref.target.slice(1));
    }
  }
  return out;
}

interface ManifestEntry {
  file: string;
  width: number | undefined;
  height: number | undefined;
  /** The CSS viewport the shot declared, and the scale it was taken at — the
   *  width budget is 2× this, not a flat 2880 (a shot may widen its viewport). */
  viewportWidth: number | undefined;
  dpr: number | undefined;
}

/** Parse the manifest defensively — a malformed entry becomes a finding, not
 *  a crash. Returns the well-formed entries plus findings for the rest. */
function readManifest(): { entries: ManifestEntry[]; findings: Finding[] } {
  const findings: Finding[] = [];
  const entries: ManifestEntry[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (error) {
    findings.push({
      file: MANIFEST_REL,
      line: 0,
      rule: 'manifest-unparsable',
      detail: `manifest.json is not valid JSON (${String(error)}) — regenerate via \`${CAPTURE_COMMAND}\``,
    });
    return { entries, findings };
  }
  // Canonical shape is `{ entries: [...] }` (what the pipeline writes); a
  // bare top-level array is tolerated so a hand-repair doesn't hard-fail.
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(list)) {
    findings.push({
      file: MANIFEST_REL,
      line: 0,
      rule: 'manifest-not-array',
      detail: `manifest.json must be { entries: [...] } — regenerate via \`${CAPTURE_COMMAND}\``,
    });
    return { entries, findings };
  }
  for (const [i, raw] of list.entries()) {
    const entry = raw as Record<string, unknown>;
    if (typeof entry?.file !== 'string' || entry.file.length === 0) {
      findings.push({
        file: MANIFEST_REL,
        line: 0,
        rule: 'manifest-entry-invalid',
        detail: `entry ${i} has no string "file" field — regenerate via \`${CAPTURE_COMMAND}\``,
      });
      continue;
    }
    const viewport = entry.viewport as { width?: unknown } | undefined;
    entries.push({
      file: entry.file,
      width: typeof entry.width === 'number' ? entry.width : undefined,
      height: typeof entry.height === 'number' ? entry.height : undefined,
      viewportWidth:
        typeof viewport?.width === 'number' ? viewport.width : undefined,
      dpr: typeof entry.dpr === 'number' ? entry.dpr : undefined,
    });
  }
  return { entries, findings };
}

describe('screenshot manifest', () => {
  it('every webp is manifest-listed, page-referenced, and DPR-2 sized', () => {
    const webps = walkWebp(IMAGES_ROOT);
    const manifestExists = fs.existsSync(MANIFEST_PATH);

    // Today's state: no screenshots captured yet — nothing to gate.
    if (!manifestExists && webps.length === 0) return;

    const findings: Finding[] = [];

    if (!manifestExists) {
      findings.push({
        file: MANIFEST_REL,
        line: 0,
        rule: 'manifest-missing',
        detail: `${webps.length} .webp file(s) exist under public/images/ but manifest.json does not — capture screenshots through the pipeline (\`${CAPTURE_COMMAND}\`), never by hand`,
      });
      assertNoFindings(findings, 'Screenshot-manifest issues');
      return;
    }

    const manifest = readManifest();
    findings.push(...manifest.findings);
    const byFile = new Map(manifest.entries.map((e) => [e.file, e]));

    for (const entry of manifest.entries) {
      if (!fs.existsSync(path.join(PUBLIC_ROOT, entry.file))) {
        findings.push({
          file: MANIFEST_REL,
          line: 0,
          rule: 'manifest-file-missing',
          detail: `manifest entry "${entry.file}" has no file on disk — regenerate via \`${CAPTURE_COMMAND}\` or drop the entry`,
        });
      }
    }

    const referenced = referencedImageTargets();
    for (const rel of webps) {
      const file = `services/docs/public/${rel}`;

      const entry = byFile.get(rel);
      if (!entry) {
        findings.push({
          file,
          line: 0,
          rule: 'image-not-in-manifest',
          detail: `no manifest entry — hand-made images have no home here; capture via \`${CAPTURE_COMMAND}\``,
        });
      }

      if (!referenced.has(rel)) {
        findings.push({
          file,
          line: 0,
          rule: 'image-unreferenced',
          detail: `no docs page references /${rel} — delete the orphan (and its manifest entry) or embed it`,
        });
      }

      const size = webpSize(path.join(PUBLIC_ROOT, rel));
      if (size === null) {
        findings.push({
          file,
          line: 0,
          rule: 'image-invalid-webp',
          detail: `not a parseable WebP file — re-export via \`${CAPTURE_COMMAND}\``,
        });
        continue;
      }
      // The cap is "a DPR-2 capture of the viewport this shot DECLARES", not a
      // flat 2880: a shot may legitimately widen its viewport (the task board
      // renders six columns and does not fit 1440). The manifest records that
      // viewport, so the entry is the budget — and a shot without an entry still
      // answers to the 1440 default.
      const declaredWidth = entry?.viewportWidth;
      const declaredDpr = entry?.dpr;
      const widthBudget =
        declaredWidth !== undefined && declaredDpr !== undefined
          ? declaredWidth * declaredDpr
          : MAX_WIDTH;
      if (size.width > widthBudget) {
        findings.push({
          file,
          line: 0,
          rule: 'image-width-over-budget',
          detail: `width ${size.width}px exceeds ${widthBudget}px (DPR-${declaredDpr ?? 2} capture of a ${declaredWidth ?? 1440}px viewport)`,
        });
      }
      if (size.width % 2 !== 0) {
        findings.push({
          file,
          line: 0,
          rule: 'image-width-odd',
          detail: `width ${size.width}px is odd — a DPR-2 capture is 2× a whole CSS pixel, so width must be even`,
        });
      }
      if (
        entry &&
        (entry.width !== size.width || entry.height !== size.height)
      ) {
        findings.push({
          file,
          line: 0,
          rule: 'manifest-dimensions-drift',
          detail: `manifest says ${entry.width}×${entry.height} but the file is ${size.width}×${size.height} — regenerate via \`${CAPTURE_COMMAND}\``,
        });
      }
    }

    assertNoFindings(findings, 'Screenshot-manifest issues');
  });
});
