/**
 * Per-take review sheet: one static HTML page under `.state/review/` with
 * two thumbnails per scene (entry + mid-narration), the planned vs actual
 * timing, and the narration text — so the human QA pass starts from
 * evidence instead of scrubbing three locales end-to-end blind. The sheet
 * never replaces the final watch-through; it makes the fast iteration loop
 * (draft → look → adjust) cheap.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { AudioPlan } from './audio-plan';
import type { EpisodeSpec, Locale } from './episode';
import { narrationFor } from './episode';
import { ffmpegBin, runFfmpeg } from './ffmpeg';
import { formatClock } from './format';
import type { RecordedTimeline } from './recorder';
import { stripAudioTags } from './vtt';

interface ReviewSheetInput {
  readonly episode: EpisodeSpec;
  readonly locale: Locale;
  readonly mp4Path: string;
  readonly recorded: RecordedTimeline;
  readonly audioPlan: AudioPlan;
  readonly stateDir: string;
  readonly draft: boolean;
  readonly durationMs: number;
  readonly sizeMb: number;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function extractThumb(
  mp4Path: string,
  atMs: number,
  outPath: string,
): Promise<void> {
  await runFfmpeg(
    ffmpegBin(),
    [
      '-y',
      '-ss',
      (Math.max(0, atMs) / 1000).toFixed(3),
      '-i',
      mp4Path,
      '-frames:v',
      '1',
      '-vf',
      'scale=480:-2',
      '-q:v',
      '3',
      outPath,
    ],
    60_000,
  );
}

/** Write the sheet and its thumbnails; returns the index.html path. */
export async function writeReviewSheet(
  input: ReviewSheetInput,
): Promise<string> {
  const { episode, locale, recorded, audioPlan } = input;
  const dir = path.join(input.stateDir, 'review', `${episode.id}.${locale}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const maxThumbMs = Math.max(0, input.durationMs - 150);
  const rows: string[] = [];
  for (const scene of recorded.planned.scenes) {
    const audio = audioPlan.scenes.find((s) => s.id === scene.id);
    const narrationMs = audio?.durationMs ?? 0;
    const spec = episode.scenes.find((s) => s.id === scene.id);
    const entryAtMs = Math.min(
      scene.startMs + Math.min(600, scene.budgetMs * 0.2),
      maxThumbMs,
    );
    const midAtMs = Math.min(
      narrationMs > 0
        ? scene.narrationStartMs + narrationMs * 0.5
        : scene.startMs + scene.budgetMs * 0.7,
      maxThumbMs,
    );
    const entryThumb = `${scene.id}-entry.jpg`;
    const midThumb = `${scene.id}-mid.jpg`;
    await extractThumb(input.mp4Path, entryAtMs, path.join(dir, entryThumb));
    await extractThumb(input.mp4Path, midAtMs, path.join(dir, midThumb));

    const actualMs = recorded.actualStartsMs[scene.id];
    const driftMs = actualMs === undefined ? null : actualMs - scene.startMs;
    const narration = spec
      ? stripAudioTags(narrationFor(episode, scene.id, locale))
      : '';
    const chapter = spec?.chapterByLocale?.[locale];
    rows.push(`<tr>
      <td class="id">${escapeHtml(scene.id)}${chapter ? `<span class="chapter">${escapeHtml(chapter)}${spec?.chapterTransition === 'cut' ? ' · cut' : ''}</span>` : ''}</td>
      <td class="num">${formatClock(scene.startMs)}</td>
      <td class="num">${(scene.budgetMs / 1000).toFixed(1)}s</td>
      <td class="num">${narrationMs > 0 ? `${(narrationMs / 1000).toFixed(1)}s` : '—'}</td>
      <td class="num">${driftMs === null ? '—' : `${driftMs > 0 ? '+' : ''}${driftMs}ms`}</td>
      <td><img src="${entryThumb}" alt="${escapeHtml(scene.id)} at scene start" loading="lazy"></td>
      <td><img src="${midThumb}" alt="${escapeHtml(scene.id)} mid narration" loading="lazy"></td>
      <td class="narration">${escapeHtml(narration) || '<em>silent</em>'}</td>
    </tr>`);
  }

  const title = `${episode.id} · ${locale}${input.draft ? ' · DRAFT' : ''}`;
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${escapeHtml(title)} — review sheet</title>
<style>
  body { font: 14px/1.45 system-ui, sans-serif; background: #0b0e14; color: #e2e8f0; margin: 24px; }
  h1 { font-size: 18px; font-weight: 600; }
  .meta { color: #93a4bd; margin-bottom: 16px; }
  .draft { color: #f59e0b; font-weight: 700; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #1e293b; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { color: #93a4bd; font-weight: 600; position: sticky; top: 0; background: #0b0e14; }
  td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.id { font-weight: 600; white-space: nowrap; }
  .chapter { display: block; color: #60a5fa; font-size: 12px; font-weight: 500; }
  img { width: 240px; border-radius: 6px; display: block; }
  td.narration { color: #cbd5e1; max-width: 420px; }
</style>
<h1>${escapeHtml(title)}${input.draft ? ' <span class="draft">draft encode — not for shipping</span>' : ''}</h1>
<p class="meta">${(input.durationMs / 1000).toFixed(1)}s · ${input.sizeMb.toFixed(1)} MB · ${recorded.planned.scenes.length} scenes · ${escapeHtml(path.basename(input.mp4Path))}${audioPlan.estimated ? ' · <span class="draft">estimated (mock) narration</span>' : ''}</p>
<table>
  <tr><th>scene</th><th>start</th><th>budget</th><th>narration</th><th>drift</th><th>scene start</th><th>mid narration</th><th>script</th></tr>
  ${rows.join('\n')}
</table>
</html>
`;
  const indexPath = path.join(dir, 'index.html');
  writeFileSync(indexPath, html);
  return indexPath;
}
