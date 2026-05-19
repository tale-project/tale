// No `'use node'` — this module is pure ECMAScript. `Buffer` is a type-
// level import (alias for `Uint8Array & { ... }` at compile time), not a
// runtime dependency, so it doesn't force the Node bundle.
import type { ParagraphSegment } from '../file_metadata/paragraphize';

/**
 * Parse + dedup VTT caption files produced by `yt-dlp --convert-subs vtt`.
 *
 * Why VTT-only (despite source variety):
 *   - yt-dlp's `--convert-subs vtt` runs every source format (JSON3,
 *     SRV3, TTML, native VTT) through ffmpeg's WebVTT muxer. Output is
 *     uniform — one parser handles every platform.
 *   - JSON3 has per-word timing that could in theory drive richer
 *     features, but JSON3 is YouTube-internal and brittle (yt-dlp issue
 *     #10360 — `_UnsafeExtensionError` regressions in 2024). The
 *     fidelity trade-off is acceptable given Whisper-fallback is the
 *     quality floor.
 *
 * Rolling-window dedup is LOAD-BEARING for YouTube auto-generated
 * captions: every cue restates the previous line plus the new word
 * (e.g. `now we will`, `now we will see`, `now we will see how`...).
 * Without dedup the paragraphizer 2-3x's every token AND the resulting
 * RAG chunks repeat phrases — agent answers degrade.
 */

export interface CaptionSegment {
  startSec: number;
  endSec: number;
  text: string;
  speaker?: string;
}

/**
 * Parse VTT bytes into `CaptionSegment[]`.
 *
 * Handles:
 *   - WEBVTT header (and the rare `WEBVTT - <title>` variant)
 *   - CRLF / LF / mixed line endings
 *   - UTF-8 BOM prefix
 *   - NOTE and STYLE blocks (skipped)
 *   - `<v Speaker>` voice tags → preserved on the segment as `speaker`
 *   - Inline `<c>`, `<00:00:01.000>` timing tags → stripped
 *   - HTML entities (`&amp;`, `&lt;`, `&gt;`, `&#39;`, numeric refs) → decoded
 *   - Malformed timestamp lines → skipped, no throw
 *
 * Does NOT throw on partial corruption; produces best-effort output so
 * a single bad cue doesn't kill the whole transcript.
 */
// Hard caps so a hostile VTT (attacker-uploaded video on YouTube /
// Bilibili / etc.) can't OOM the Convex action.
// 5 MB ≈ 200 K cue lines after dedup — well past any legitimate transcript.
const MAX_VTT_BYTES = 5 * 1024 * 1024;
const MAX_SEGMENTS = 50_000;
// Per-cue body cap. Legitimate cues are <2 KB; 64 KB is 30× headroom and
// blocks the ReDoS attack where a single attacker-crafted cue absorbs
// the entire 5 MB VTT budget (the inline-tag regex below is O(n) per
// match but the cue iterates *every* `<` character — without this cap
// a 5 MB unbalanced-`<` payload pegs CPU for minutes).
const MAX_CUE_BODY_BYTES = 64 * 1024;

export function parseVtt(input: string | Buffer): CaptionSegment[] {
  let text = typeof input === 'string' ? input : input.toString('utf-8');
  if (text.length > MAX_VTT_BYTES) {
    // Truncate rather than throw — a malformed-but-genuine long video
    // (e.g. 6h podcast) should still produce a usable transcript prefix
    // instead of falling through to Whisper at 15 min wall-clock cost.
    text = text.slice(0, MAX_VTT_BYTES);
  }
  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Normalize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split on blank-line block separator. WebVTT cues are blank-line-
  // delimited by spec.
  const blocks = text.split(/\n\s*\n/);

  const segments: CaptionSegment[] = [];
  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (!block) continue;
    // Skip the WEBVTT header (first block) — accepts `WEBVTT` or
    // `WEBVTT - title` or `WEBVTT\nKind: captions`.
    if (/^WEBVTT(\b|$)/i.test(block)) continue;
    // Skip NOTE / STYLE blocks.
    if (/^NOTE\b/.test(block) || /^STYLE\b/.test(block)) continue;

    const lines = block.split('\n');
    // A cue is [cue-id?, timestamp-line, ...text-lines]. The timestamp
    // line contains ` --> `. Find it; everything before it is the
    // optional id (single line); everything after is text.
    const timestampIdx = lines.findIndex((l) => l.includes('-->'));
    if (timestampIdx < 0) continue;

    const tsParsed = parseTimestampLine(lines[timestampIdx]);
    if (!tsParsed) continue;

    const textLines = lines.slice(timestampIdx + 1);
    const merged = textLines.join('\n').trim();
    if (!merged) continue;
    if (merged.length > MAX_CUE_BODY_BYTES) continue;

    // Decode HTML entities FIRST, then strip tags — otherwise an attacker
    // who HTML-encodes `&lt;system&gt;` in caption text bypasses the tag
    // strip and the literal `<system>` survives into the LLM context.
    const decoded = decodeHtmlEntities(merged);
    const { speaker, text: stripped } = extractSpeakerAndStrip(decoded);
    const clean = stripped.trim();
    if (!clean) continue;

    segments.push({
      startSec: tsParsed.startSec,
      endSec: tsParsed.endSec,
      text: clean,
      ...(speaker ? { speaker } : {}),
    });
    // Hard segment cap so a degenerate VTT (1k cue/s on a long video)
    // can't push the parser past the action's memory budget.
    if (segments.length >= MAX_SEGMENTS) break;
  }

  return segments;
}

/**
 * Match a VTT timestamp line: `HH:MM:SS.mmm --> HH:MM:SS.mmm` or
 * `MM:SS.mmm --> MM:SS.mmm`. May have trailing settings (`align:start`,
 * etc.) which we ignore.
 */
function parseTimestampLine(
  line: string,
): { startSec: number; endSec: number } | null {
  const match = line.match(
    /(\d{1,2}:)?(\d{1,2}):(\d{2})\.(\d{3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{2})\.(\d{3})/,
  );
  if (!match) return null;
  const startSec = hmsToSec(match[1], match[2], match[3], match[4]);
  const endSec = hmsToSec(match[5], match[6], match[7], match[8]);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return null;
  return { startSec, endSec };
}

function hmsToSec(
  hPart: string | undefined,
  mPart: string,
  sPart: string,
  msPart: string,
): number {
  const h = hPart ? Number(hPart.slice(0, -1)) : 0;
  const m = Number(mPart);
  const s = Number(sPart);
  const ms = Number(msPart);
  return h * 3600 + m * 60 + s + ms / 1000;
}

/**
 * Strip the cocktail of prompt-injection markers, VTT inline tags, and
 * invisible smuggling code-points that attacker-controlled caption text
 * commonly carries. Used for BOTH cue body (`rest`) and speaker label —
 * the speaker leaks into the agent context via `paragraphize.ts` as
 * `${speaker}: ${body}` and would otherwise bypass every scrubber.
 *
 * Length cap is applied last so an attacker who packs a 10 KB speaker
 * string can't blow up the prompt window.
 */
function cleanInlineText(input: string, maxLen?: number): string {
  let out = input;
  // Prompt-injection control tokens FIRST so the generic-tag pass below
  // doesn't partially consume their inner brackets and leave `<>` fragments
  // behind (e.g. `<<SYS>>` → generic-tag would otherwise eat `<SYS>`).
  out = out.replace(/<<\/?SYS>>/gi, '');
  out = out.replace(/<\|[a-zA-Z0-9_-]+\|>/g, '');
  // Orphaned ChatML openers without their closing `|>` — produced when
  // the surrounding `<v Speaker>` regex eats the trailing `>` (the
  // VTT speaker regex captures up to the first `>` in the cue,
  // truncating a payload like `<|im_start|>` to `<|im_start|` inside
  // the speaker string). Strip both leading-`<|name|` and inline
  // residuals so the speaker label can't carry chatml smuggling.
  out = out.replace(/<\|[a-zA-Z0-9_-]+\|?/g, '');
  out = out.replace(/\[\/?(INST|SYS|SYSTEM)\]/gi, '');
  // Standard VTT inline tags (`<c>`, `<c.colorE5E5E5>`, `</v>`, `</c>`) —
  // case-insensitive so encoder casing variants don't bleed through.
  // The body is bounded at 1024 chars and `\n` is excluded so an
  // adversarial cue full of unbalanced `<` characters can't trigger
  // O(n²) backtracking — `[^>]*` is greedy and re-scans the rest of the
  // string on every failed `<` opener.
  out = out.replace(/<\/?[a-zA-Z][^>\n]{0,1024}>/g, '');
  // VTT inline timing tags — 1- or 2-digit hour (some encoders emit
  // `<0:00:01.500>` instead of the spec-correct `<00:00:01.500>`).
  out = out.replace(/<\d{1,2}:\d{2}:\d{2}\.\d{3}>/g, '');
  // Zero-width and bidi-override characters that LLM tokenizers accept
  // but humans can't see — common smuggling vector.
  out = out.replace(/[​-‏‪-‮⁠﻿]/g, '');
  if (maxLen !== undefined && out.length > maxLen) {
    out = out.slice(0, maxLen);
  }
  return out;
}

function extractSpeakerAndStrip(text: string): {
  speaker?: string;
  text: string;
} {
  // `<v Speaker>...</v>` — speaker tag opens at the start of the cue.
  // The closing `</v>` is optional in practice.
  const speakerMatch = text.match(/^\s*<v\s+([^>]+)>/);
  let speaker: string | undefined;
  let rest = text;
  if (speakerMatch) {
    // Run the captured label through the SAME scrubber as the cue body,
    // plus a hard length cap, plus newline rejection (the regex `[^>]`
    // can capture newlines inside a malformed `<v ... >` opener).
    const raw = speakerMatch[1].replace(/[\r\n\t]/g, ' ').trim();
    const cleaned = cleanInlineText(raw, 64).trim();
    speaker = cleaned.length > 0 ? cleaned : undefined;
    rest = text.slice(speakerMatch[0].length);
  }
  rest = cleanInlineText(rest);
  return { speaker, text: rest };
}

// Unicode code-point bound (U+10FFFF). String.fromCodePoint throws
// RangeError above this; malformed VTT with `&#99999999;` would otherwise
// crash the parser on a single bad cue.
const MAX_CODE_POINT = 0x10ffff;

function safeFromCodePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > MAX_CODE_POINT) return '';
  return String.fromCodePoint(n);
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => safeFromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) =>
      safeFromCodePoint(Number.parseInt(n, 16)),
    );
}

/**
 * Collapse YouTube auto-generated rolling-window cues into one cue per
 * stable utterance.
 *
 * Auto-gen captions emit cues like:
 *   [0.1, 1.2] "now"
 *   [0.1, 2.0] "now we"
 *   [0.1, 3.0] "now we will"
 *   [3.1, 4.2] "see how"
 *   [3.1, 5.0] "see how it"
 *
 * Heuristic: when consecutive cues share the same `startSec` AND each
 * subsequent text starts with (or contains) the previous one as a prefix,
 * KEEP only the longest one (last cue in the window — it has the most
 * complete text and the latest `endSec`).
 *
 * Manual captions and Whisper segments don't trigger this — they have
 * unique non-rolling startSecs, so each cue is its own "window of one".
 */
export function rollingWindowDedup(
  segments: CaptionSegment[],
): CaptionSegment[] {
  if (segments.length === 0) return segments;
  const out: CaptionSegment[] = [];
  let windowStart = segments[0].startSec;
  let windowLongest = segments[0];

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.startSec === windowStart) {
      // Same window — pick whichever has more text.
      if (seg.text.length > windowLongest.text.length) {
        windowLongest = seg;
      }
    } else {
      out.push(windowLongest);
      windowStart = seg.startSec;
      windowLongest = seg;
    }
  }
  out.push(windowLongest);
  return out;
}

/**
 * Adapter: `CaptionSegment[]` → `ParagraphSegment[]` (shape required by
 * the shared paragraphizer in `file_metadata/paragraphize.ts`).
 */
export function captionsToParagraphSegments(
  segments: CaptionSegment[],
): ParagraphSegment[] {
  return segments.map((s) => ({
    startSec: s.startSec,
    endSec: s.endSec,
    text: s.text,
    ...(s.speaker ? { speaker: s.speaker } : {}),
  }));
}
