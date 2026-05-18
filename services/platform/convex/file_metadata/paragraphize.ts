/**
 * Paragraphize a sequence of timestamped speech segments.
 *
 * Shared by:
 *   - `transcribe_audio.ts` — Whisper `verbose_json` segments
 *   - `video_links/captions_parser.ts` — yt-dlp VTT caption cues
 *     (post rolling-window dedup)
 *
 * Two profiles tune the break heuristics for the source:
 *
 *   WHISPER_PROFILE: pauses are sparse (ASR over continuous audio).
 *     pauseSec=1.5, maxDurationSec=45 — historical values.
 *
 *   CAPTION_PROFILE: cues have engineered timing (often zero-gap by
 *     design). Lean on sentence-final punctuation as a tiebreaker so
 *     paragraphs don't snap arbitrarily mid-sentence.
 *     pauseSec=0.8, maxDurationSec=30.
 *
 * The `addTimestamps` option prefixes every paragraph with `[HH:MM:SS] `
 * derived from the paragraph's starting segment. This is critical for
 * the chat-agent flow — the LLM can cite "at 12:34 the speaker says…"
 * and downstream UI can build deep-link players (`?t=754`). Keeping the
 * format `[HH:MM:SS]` (zero-padded, fixed-width) makes the prefix
 * trivially regex-parseable for any future renderer.
 *
 * Backward compatibility: when `addTimestamps=false`, output is byte-
 * identical to the legacy paragraphizer's output. Existing audio
 * transcripts stored before this change stay readable; only NEW
 * transcripts get the prefix.
 */

export interface ParagraphSegment {
  /** Segment start in seconds. */
  startSec: number;
  /** Segment end in seconds. */
  endSec: number;
  /** Raw text content. May start/end with whitespace; we trim. */
  text: string;
  /** Optional speaker label (from VTT `<v Speaker>` tags). When present,
   * prefixed once at paragraph start as `Speaker: …`. */
  speaker?: string;
}

export interface ParagraphizeProfile {
  /** Insert a paragraph break when the gap between two segments is at
   * least this many seconds. */
  pauseSec: number;
  /** Force a paragraph break after this many seconds of continuous
   * accumulation, even without a natural pause. */
  maxDurationSec: number;
}

export const WHISPER_PROFILE: ParagraphizeProfile = {
  pauseSec: 1.5,
  maxDurationSec: 45,
};

export const CAPTION_PROFILE: ParagraphizeProfile = {
  pauseSec: 0.8,
  maxDurationSec: 30,
};

export interface ParagraphizeOptions {
  profile?: ParagraphizeProfile;
  /** When true, prefix each paragraph with `[HH:MM:SS] `. Default false
   * for backward compatibility. */
  addTimestamps?: boolean;
}

function formatHms(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return (
    String(hh).padStart(2, '0') +
    ':' +
    String(mm).padStart(2, '0') +
    ':' +
    String(ss).padStart(2, '0')
  );
}

/**
 * Join timestamped segments into paragraphs.
 *
 * Falls back to the raw `fallbackText` when segments are missing or empty.
 * The fallback path emits no timestamp prefix even with addTimestamps=true
 * — we don't fake `[00:00:00]` when we don't actually know the timing.
 */
export function joinSegmentsWithParagraphs(
  segments: ParagraphSegment[] | undefined,
  fallbackText: string,
  opts: ParagraphizeOptions = {},
): string {
  const profile = opts.profile ?? WHISPER_PROFILE;
  const addTimestamps = opts.addTimestamps ?? false;

  if (!segments || segments.length === 0) return fallbackText.trim();

  const paragraphs: string[] = [];
  let current: string[] = [];
  let paragraphStart = segments[0].startSec;
  let paragraphSpeaker: string | undefined = segments[0].speaker;

  const flush = () => {
    if (current.length === 0) return;
    let body = current.join('').trim();
    if (body.length === 0) return;
    if (paragraphSpeaker) body = `${paragraphSpeaker}: ${body}`;
    if (addTimestamps) body = `[${formatHms(paragraphStart)}] ${body}`;
    paragraphs.push(body);
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const prev = i > 0 ? segments[i - 1] : null;
    // Treat negative gaps (overlapping cues — typical of YouTube auto-gen
    // captions even after rolling-window dedup) as zero so they don't
    // accidentally satisfy the >= pauseSec threshold.
    const gap = prev ? Math.max(0, seg.startSec - prev.endSec) : 0;
    const paragraphDuration = seg.endSec - paragraphStart;
    const speakerChanged =
      prev !== null &&
      seg.speaker !== undefined &&
      seg.speaker !== prev.speaker;

    if (
      current.length > 0 &&
      (gap >= profile.pauseSec ||
        paragraphDuration >= profile.maxDurationSec ||
        speakerChanged)
    ) {
      flush();
      current = [];
      paragraphStart = seg.startSec;
      paragraphSpeaker = seg.speaker;
    }
    current.push(seg.text);
  }
  flush();

  return paragraphs.join('\n\n');
}
