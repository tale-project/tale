/**
 * WebVTT caption generation for the docs video pipeline. Captions come for
 * free: the narration script text and its planned offsets are known, so every
 * video ships subtitles in its own locale (the docs a11y bar) without a
 * transcription step.
 *
 * Pure module — no Playwright, no fs.
 */

/** Longest comfortable caption line (industry-standard ~42 chars). */
const MAX_LINE_CHARS = 42;
/** A cue shows at most two lines. */
const MAX_CUE_CHARS = MAX_LINE_CHARS * 2;
/** Never flash a cue shorter than this. */
const MIN_CUE_MS = 700;

interface CaptionCue {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

/**
 * Remove ElevenLabs delivery tags (`[warmly] …`) — they direct the voice,
 * never the reader. Collapses the whitespace the removal leaves behind.
 */
export function stripAudioTags(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split narration into sentences (authored prose — `.`, `!`, `?` enders). */
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  return (matches ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/** Break a sentence into cue-sized chunks at clause/word boundaries. */
function chunkSentence(sentence: string): string[] {
  if (sentence.length <= MAX_CUE_CHARS) return [sentence];
  const words = sentence.split(/\s+/);
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > MAX_CUE_CHARS && current) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
    // Prefer breathing at a clause boundary once the chunk is sizeable.
    if (current.length >= MAX_LINE_CHARS && /[,;:]$/.test(current)) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Balance a cue's text onto at most two lines. */
function wrapCueText(text: string): string {
  if (text.length <= MAX_LINE_CHARS) return text;
  const words = text.split(/\s+/);
  // Break closest to the middle so the two lines read balanced.
  const middle = Math.ceil(text.length / 2);
  let line = '';
  let breakIndex = words.length - 1;
  for (let i = 0; i < words.length; i++) {
    const candidate = line ? `${line} ${words[i]}` : (words[i] ?? '');
    if (candidate.length > middle && i > 0) {
      breakIndex = i - 1;
      break;
    }
    line = candidate;
  }
  const first = words.slice(0, breakIndex + 1).join(' ');
  const second = words.slice(breakIndex + 1).join(' ');
  return second ? `${first}\n${second}` : first;
}

/**
 * Distribute one scene's narration over its measured duration: sentences are
 * chunked to cue size and each cue gets a share of the duration proportional
 * to its character count (a fair proxy for speech time at constant pace).
 */
export function narrationToCues(
  narration: string,
  startMs: number,
  durationMs: number,
): readonly CaptionCue[] {
  const clean = stripAudioTags(narration);
  if (!clean || durationMs <= 0) return [];
  const chunks = splitSentences(clean).flatMap(chunkSentence);
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (totalChars === 0) return [];

  const cues: CaptionCue[] = [];
  let cursor = startMs;
  for (const [index, chunk] of chunks.entries()) {
    const isLast = index === chunks.length - 1;
    const share = Math.round((chunk.length / totalChars) * durationMs);
    const endMs = isLast
      ? startMs + durationMs
      : Math.min(cursor + Math.max(share, MIN_CUE_MS), startMs + durationMs);
    if (endMs > cursor) {
      cues.push({ startMs: cursor, endMs, text: wrapCueText(chunk) });
    }
    cursor = endMs;
  }
  return cues;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** `HH:MM:SS.mmm` — WebVTT's full timestamp form. */
export function formatVttTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}`;
}

/**
 * Serialize cues to a WebVTT file body. Enforces the invariants the docs
 * `videos` test asserts: monotonically increasing, non-overlapping cues.
 */
export function buildVtt(cues: readonly CaptionCue[]): string {
  const lines: string[] = ['WEBVTT', ''];
  let previousEnd = 0;
  for (const [index, cue] of cues.entries()) {
    if (cue.startMs < previousEnd) {
      throw new Error(
        `Cue ${index + 1} starts at ${cue.startMs}ms before the previous cue ended (${previousEnd}ms)`,
      );
    }
    if (cue.endMs <= cue.startMs) {
      throw new Error(`Cue ${index + 1} has a non-positive duration`);
    }
    lines.push(
      String(index + 1),
      `${formatVttTimestamp(cue.startMs)} --> ${formatVttTimestamp(cue.endMs)}`,
      cue.text,
      '',
    );
    previousEnd = cue.endMs;
  }
  return `${lines.join('\n')}\n`;
}
