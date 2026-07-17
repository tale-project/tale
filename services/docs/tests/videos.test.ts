import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT, REPO_ROOT } from './lib/paths';
import { BASE_LOCALES, walkDocs } from './lib/walk';

/**
 * Every tutorial video ships as a complete, manifest-declared set — or it
 * doesn't ship.
 *
 * The production pipeline (`bun run docs:videos`, source
 * `services/platform/tests/docs-videos/`) emits, per episode and locale, an
 * `.mp4`, a WebVTT `.vtt` caption track, and a `.webp` poster under
 * `public/videos/<section>/`, plus `public/videos/manifest.json` declaring
 * each file. This test locks the contract:
 *
 *   1. Every video asset on disk appears in the manifest, and every
 *      manifest entry's file exists — a hand-made video has no home here.
 *   2. Names follow `<episode>.<locale>.(mp4|vtt|webp)` with a supported
 *      locale, and an episode ships ALL base locales or none (the docs are
 *      three full mirrors; a video missing in one locale is a gap).
 *   3. Every `<Video>` embed's `src`/`poster`/`captions` resolve to files on
 *      disk, carry a captions track, and match the embedding page's locale —
 *      a German page never plays the English narration.
 *   4. Every on-disk video asset is referenced by at least one page (no
 *      orphaned megabytes), except the manifest itself.
 *   5. Budgets: an mp4 stays under 40 MB (expect 5–25 at the pipeline's
 *      encode settings — investigate before raising this), a poster under
 *      250 KB.
 *   6. Caption files are well-formed WebVTT: header, at least one cue,
 *      monotonically non-overlapping timestamps.
 *
 * When neither a manifest nor any video exists the test passes vacuously.
 */

const PUBLIC_ROOT = path.join(REPO_ROOT, 'services', 'docs', 'public');
const VIDEOS_ROOT = path.join(PUBLIC_ROOT, 'videos');
const MANIFEST_PATH = path.join(VIDEOS_ROOT, 'manifest.json');
const MANIFEST_REL = path.relative(REPO_ROOT, MANIFEST_PATH);
const PRODUCE_COMMAND = 'bun run docs:videos';

const MAX_MP4_BYTES = 40 * 1024 * 1024;
const MAX_POSTER_BYTES = 250 * 1024;

const ASSET_NAME =
  /^(?<episode>[a-z0-9-]+)\.(?<locale>[a-z-]+)\.(?<ext>mp4|vtt|webp)$/;

interface ManifestEntry {
  file: string;
  episode: string;
  locale: string;
  kind: 'video' | 'captions' | 'poster';
  durationSec?: number;
}

function readManifest(): ManifestEntry[] {
  if (!fs.existsSync(MANIFEST_PATH)) return [];
  return (
    JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as {
      entries: ManifestEntry[];
    }
  ).entries;
}

/** All video assets on disk, as `public/`-relative forward-slash paths. */
function walkVideoAssets(dir = VIDEOS_ROOT, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkVideoAssets(full, out);
      continue;
    }
    if (/\.(?:mp4|vtt|webp)$/.test(entry.name)) {
      out.push(path.relative(PUBLIC_ROOT, full).split(path.sep).join('/'));
    }
  }
  return out;
}

interface VideoEmbed {
  file: string;
  line: number;
  attrs: Record<string, string>;
}

/** Every `<Video …>` opening tag across all locales, with its attributes. */
function videoEmbeds(): VideoEmbed[] {
  const embeds: VideoEmbed[] = [];
  for (const rel of walkDocs()) {
    const raw = fs
      .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
      .replaceAll('\r\n', '\n');
    const { body } = parseFrontmatter(raw);
    const lines = body.split('\n');
    // 1-based line of the body's first line in the raw file.
    const bodyStartLine = raw.split('\n').length - lines.length + 1;
    for (const [index, lineText] of lines.entries()) {
      const open = /<Video\b([^>]*)>/i.exec(lineText);
      if (!open) continue;
      const attrs: Record<string, string> = {};
      for (const match of (open[1] ?? '').matchAll(/([a-zA-Z]+)="([^"]*)"/g)) {
        attrs[(match[1] ?? '').toLowerCase()] = match[2] ?? '';
      }
      embeds.push({ file: rel, line: bodyStartLine + index, attrs });
    }
  }
  return embeds;
}

describe('docs video contract', () => {
  it('ships every video with its manifest entry, captions, poster, locale parity, and page reference', () => {
    const findings: Finding[] = [];
    const manifest = readManifest();
    const onDisk = walkVideoAssets();
    const manifestFiles = new Set(manifest.map((entry) => entry.file));

    // 1. Disk ↔ manifest, both directions.
    for (const file of onDisk) {
      if (!manifestFiles.has(file)) {
        findings.push({
          file: MANIFEST_REL,
          line: 0,
          rule: 'video-unmanifested',
          detail: `${file} exists on disk but is not declared — produce it via \`${PRODUCE_COMMAND}\``,
        });
      }
    }
    for (const entry of manifest) {
      if (!fs.existsSync(path.join(PUBLIC_ROOT, entry.file))) {
        findings.push({
          file: MANIFEST_REL,
          line: 0,
          rule: 'video-stale-entry',
          detail: `${entry.file} is declared but missing on disk`,
        });
      }
    }

    // 2. Naming + per-episode locale parity, per asset kind.
    const byEpisodeKind = new Map<string, Set<string>>();
    for (const file of onDisk) {
      const name = file.split('/').at(-1) ?? '';
      const parsed = ASSET_NAME.exec(name);
      if (!parsed?.groups) {
        findings.push({
          file: MANIFEST_REL,
          line: 0,
          rule: 'video-bad-name',
          detail: `${file} does not follow <episode>.<locale>.(mp4|vtt|webp)`,
        });
        continue;
      }
      const { episode, locale, ext } = parsed.groups;
      if (!(BASE_LOCALES as readonly string[]).includes(locale ?? '')) {
        findings.push({
          file: MANIFEST_REL,
          line: 0,
          rule: 'video-unknown-locale',
          detail: `${file} carries locale "${locale}" — expected one of ${BASE_LOCALES.join(', ')}`,
        });
        continue;
      }
      const key = `${episode}.${ext}`;
      const locales = byEpisodeKind.get(key) ?? new Set<string>();
      locales.add(locale ?? '');
      byEpisodeKind.set(key, locales);
    }
    for (const [key, locales] of byEpisodeKind) {
      for (const locale of BASE_LOCALES) {
        if (!locales.has(locale)) {
          findings.push({
            file: MANIFEST_REL,
            line: 0,
            rule: 'video-locale-gap',
            detail: `${key} ships ${[...locales].sort().join(', ')} but not ${locale} — every episode ships all locales`,
          });
        }
      }
    }

    // 3. Embeds: assets exist, captions present, locale matches the page.
    const referenced = new Set<string>();
    for (const embed of videoEmbeds()) {
      const pageLocale = embed.file.split('/')[0] ?? '';
      for (const attr of ['src', 'poster', 'captions'] as const) {
        const value = embed.attrs[attr];
        if (!value) {
          findings.push({
            file: embed.file,
            line: embed.line,
            rule: `video-missing-${attr}`,
            detail: `<Video> has no ${attr} — src, poster and captions are all required`,
          });
          continue;
        }
        if (!value.startsWith('/videos/')) {
          findings.push({
            file: embed.file,
            line: embed.line,
            rule: 'video-foreign-src',
            detail: `${attr}="${value}" — video assets live under /videos/`,
          });
          continue;
        }
        const rel = value.slice(1);
        referenced.add(rel);
        if (!fs.existsSync(path.join(PUBLIC_ROOT, rel))) {
          findings.push({
            file: embed.file,
            line: embed.line,
            rule: 'video-target-missing',
            detail: `${attr} targets ${value}, which does not exist — run \`${PRODUCE_COMMAND}\``,
          });
        }
        const name = ASSET_NAME.exec(rel.split('/').at(-1) ?? '');
        if (name?.groups && name.groups.locale !== pageLocale) {
          findings.push({
            file: embed.file,
            line: embed.line,
            rule: 'video-locale-mismatch',
            detail: `${attr} targets the ${name.groups.locale} asset from a ${pageLocale} page`,
          });
        }
      }
      if (embed.attrs.lang && embed.attrs.lang !== pageLocale) {
        findings.push({
          file: embed.file,
          line: embed.line,
          rule: 'video-lang-mismatch',
          detail: `lang="${embed.attrs.lang}" on a ${pageLocale} page`,
        });
      }
    }

    // 4. No orphaned assets.
    for (const file of onDisk) {
      if (!referenced.has(file)) {
        findings.push({
          file: MANIFEST_REL,
          line: 0,
          rule: 'video-orphan',
          detail: `${file} is referenced by no docs page — dead megabytes in every clone`,
        });
      }
    }

    // 5. Size budgets.
    for (const file of onDisk) {
      const bytes = fs.statSync(path.join(PUBLIC_ROOT, file)).size;
      if (file.endsWith('.mp4') && bytes > MAX_MP4_BYTES) {
        findings.push({
          file: MANIFEST_REL,
          line: 0,
          rule: 'video-over-budget',
          detail: `${file} is ${(bytes / 1024 / 1024).toFixed(1)} MB (cap ${MAX_MP4_BYTES / 1024 / 1024} MB) — tighten the encode, don't raise the cap`,
        });
      }
      if (file.endsWith('.webp') && bytes > MAX_POSTER_BYTES) {
        findings.push({
          file: MANIFEST_REL,
          line: 0,
          rule: 'poster-over-budget',
          detail: `${file} is ${Math.round(bytes / 1024)} KB (cap ${MAX_POSTER_BYTES / 1024} KB)`,
        });
      }
    }

    // 6. WebVTT well-formedness.
    const TIMESTAMP = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/;
    const toMs = (ts: string): number => {
      const parts = TIMESTAMP.exec(ts);
      if (!parts) return Number.NaN;
      const [, h, m, s, ms] = parts;
      return (
        Number(h) * 3_600_000 +
        Number(m) * 60_000 +
        Number(s) * 1000 +
        Number(ms)
      );
    };
    for (const file of onDisk.filter((f) => f.endsWith('.vtt'))) {
      const text = fs.readFileSync(path.join(PUBLIC_ROOT, file), 'utf8');
      if (!text.startsWith('WEBVTT')) {
        findings.push({
          file: MANIFEST_REL,
          line: 0,
          rule: 'vtt-no-header',
          detail: `${file} does not start with WEBVTT`,
        });
        continue;
      }
      const cueLines = [...text.matchAll(/^(\S+) --> (\S+)$/gm)];
      if (cueLines.length === 0) {
        findings.push({
          file: MANIFEST_REL,
          line: 0,
          rule: 'vtt-empty',
          detail: `${file} has no cues`,
        });
        continue;
      }
      let previousEnd = -1;
      for (const cue of cueLines) {
        const start = toMs(cue[1] ?? '');
        const end = toMs(cue[2] ?? '');
        if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
          findings.push({
            file: MANIFEST_REL,
            line: 0,
            rule: 'vtt-bad-cue',
            detail: `${file}: malformed cue "${cue[0]}"`,
          });
          break;
        }
        if (start < previousEnd) {
          findings.push({
            file: MANIFEST_REL,
            line: 0,
            rule: 'vtt-overlap',
            detail: `${file}: cue starting ${cue[1]} overlaps the previous one`,
          });
          break;
        }
        previousEnd = end;
      }
    }

    assertNoFindings(findings, 'Video contract');
  });
});
