import type { FrameLogEntry } from './screencast';

/** Concat-demuxer playlist with per-frame durations, last frame held. */
export function buildConcatList(
  frames: readonly FrameLogEntry[],
  totalMs: number,
): string {
  if (frames.length === 0) throw new Error('No frames were recorded');
  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < frames.length; i++) {
    const current = frames[i];
    if (!current) continue;
    const nextTMs = frames[i + 1]?.tMs ?? Math.max(totalMs, current.tMs + 33);
    const durationSec = Math.max(nextTMs - current.tMs, 1) / 1000;
    lines.push(`file '${current.file}'`, `duration ${durationSec.toFixed(4)}`);
  }
  const last = frames.at(-1);
  if (last) lines.push(`file '${last.file}'`);
  return `${lines.join('\n')}\n`;
}
