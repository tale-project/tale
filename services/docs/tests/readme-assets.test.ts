import fs from 'node:fs';
import path from 'node:path';

import {
  FIXED_IMAGE_WIDTHS,
  IMAGE_MAX_BYTES,
} from '@tale/ui/images/responsive';
import { describe, expect, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { README_PATTERN, REPO_ROOT } from './lib/paths';
import { webpSize } from './lib/webp-size';

/**
 * The README gallery tiles under `.github/assets/` (`readme-*.webp`) are made
 * by `bun run readme:assets` from the docs screenshots, at the one width the
 * shared image policy names for them and within its byte budget. GitHub shows
 * a README image as is, with no `srcset`, so every reader downloads the file
 * the README names. Each tile must:
 *
 *   - be a WebP exactly `FIXED_IMAGE_WIDTHS.readmeTile` wide, the width the
 *     command writes (two tiles per row of GitHub's README column, at DPR 2);
 *   - stay within `IMAGE_MAX_BYTES`;
 *   - be shown by every root README, which mirror each other, and every tile a
 *     README shows must exist.
 */

const ASSETS = '.github/assets';
const TILE = /^readme-[a-z0-9-]+\.webp$/;
const REFERENCE = /\.github\/assets\/(readme-[^"')\s]+)/g;
const PRODUCE_COMMAND = 'bun run readme:assets';

function tiles(): string[] {
  return fs
    .readdirSync(path.join(REPO_ROOT, ASSETS))
    .filter((name) => TILE.test(name))
    .sort();
}

/** Each root README with the README tiles it shows. */
function readmeReferences(): { readme: string; shown: Set<string> }[] {
  return fs
    .readdirSync(REPO_ROOT)
    .filter((name) => README_PATTERN.test(name))
    .sort()
    .map((readme) => {
      const text = fs.readFileSync(path.join(REPO_ROOT, readme), 'utf8');
      const shown = new Set(
        [...text.matchAll(REFERENCE)].map((match) => match[1] ?? ''),
      );
      return { readme, shown };
    });
}

describe('README gallery tiles', () => {
  it('ships every tile at the policy width and within the byte budget', () => {
    const findings: Finding[] = [];
    const files = tiles();
    expect(files.length, `no ${ASSETS}/readme-*.webp`).toBeGreaterThan(0);
    for (const name of files) {
      const file = path.join(REPO_ROOT, ASSETS, name);
      const rel = `${ASSETS}/${name}`;
      const size = webpSize(file);
      if (!size) {
        findings.push({
          file: rel,
          line: 0,
          rule: 'readme-tile-not-webp',
          detail: `not a well-formed WebP — run \`${PRODUCE_COMMAND}\``,
        });
        continue;
      }
      if (size.width !== FIXED_IMAGE_WIDTHS.readmeTile) {
        findings.push({
          file: rel,
          line: 0,
          rule: 'readme-tile-width',
          detail: `${size.width} px wide, the policy's README tile is ${FIXED_IMAGE_WIDTHS.readmeTile} px — run \`${PRODUCE_COMMAND}\``,
        });
      }
      const bytes = fs.statSync(file).size;
      if (bytes > IMAGE_MAX_BYTES) {
        findings.push({
          file: rel,
          line: 0,
          rule: 'readme-tile-over-budget',
          detail: `${bytes} bytes, above the ${IMAGE_MAX_BYTES}-byte budget`,
        });
      }
    }
    assertNoFindings(findings, 'README tile');
  });

  it('shows every tile in every README, and only tiles that exist', () => {
    const findings: Finding[] = [];
    const files = new Set(tiles());
    const readmes = readmeReferences();
    expect(readmes.length).toBeGreaterThan(1);
    for (const { readme, shown } of readmes) {
      for (const name of shown) {
        if (!files.has(name)) {
          findings.push({
            file: readme,
            line: 0,
            rule: 'readme-tile-missing',
            detail: `shows ${ASSETS}/${name}, which does not exist — run \`${PRODUCE_COMMAND}\``,
          });
        }
      }
      for (const name of files) {
        if (!shown.has(name)) {
          findings.push({
            file: readme,
            line: 0,
            rule: 'readme-tile-unshown',
            detail: `does not show ${ASSETS}/${name} — the READMEs mirror each other; show it or drop it from \`${PRODUCE_COMMAND}\``,
          });
        }
      }
    }
    assertNoFindings(findings, 'README tile');
  });
});
