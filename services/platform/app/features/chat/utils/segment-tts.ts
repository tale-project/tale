import { MAX_TTS_CHUNK_CHARS } from '@/lib/shared/constants/tts';
import { parseMarkers } from '@/lib/utils/marker-parser';

import { stripMarkdownOnce } from '../hooks/markdown-strip';

const FALLBACK_SENTENCE_BOUNDARY = /(?<=[.!?。！？])\s+|\n{2,}/g;

/**
 * Split prose into sentences. Prefers `Intl.Segmenter` (locale-aware: no
 * false split on `3.14`, `e.g.`, `Dr.`) and falls back to a punctuation
 * regex when the runtime lacks the API.
 */
function segmentSentences(text: string, locale: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(locale || undefined, {
      granularity: 'sentence',
    });
    return Array.from(seg.segment(text), (part) => part.segment);
  }
  const out: string[] = [];
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  FALLBACK_SENTENCE_BOUNDARY.lastIndex = 0;
  while ((match = FALLBACK_SENTENCE_BOUNDARY.exec(text)) !== null) {
    const end = match.index + match[0].length;
    out.push(text.slice(lastEnd, end));
    lastEnd = end;
  }
  if (lastEnd < text.length) out.push(text.slice(lastEnd));
  return out;
}

/**
 * Segment a COMPLETE assistant message into TTS-ready chunks for the
 * on-demand "Speak out loud" action (the streaming voice-output chunker in
 * `use-voice-output.ts` owns the live-streaming path; this is the
 * whole-message equivalent).
 *
 * Pipeline mirrors the chunker's post-stream batch path: strip structured
 * markers (drop the NEXT_STEPS suggestion section), strip markdown so code
 * blocks / formatting aren't read aloud, then greedily pack sentences into
 * chunks no larger than `MAX_TTS_CHUNK_CHARS`. Returns an empty array when
 * there's nothing speakable (e.g. a code-only reply).
 */
export function segmentTextForTts(rawText: string, locale: string): string[] {
  if (!rawText.trim()) return [];

  const parsed = parseMarkers(rawText, false);
  const plain = parsed.sections
    .filter((s) => s.type === 'plain')
    .map((s) => s.content)
    .join('\n\n');

  const cleaned = stripMarkdownOnce(plain).trim();
  if (!cleaned) return [];

  const sentences = segmentSentences(cleaned, locale);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    // A single sentence longer than the cap: flush, then hard-split it.
    if (sentence.length > MAX_TTS_CHUNK_CHARS) {
      if (current.trim()) chunks.push(current.trim());
      current = '';
      for (let i = 0; i < sentence.length; i += MAX_TTS_CHUNK_CHARS) {
        chunks.push(sentence.slice(i, i + MAX_TTS_CHUNK_CHARS).trim());
      }
      continue;
    }
    if (current && current.length + sentence.length > MAX_TTS_CHUNK_CHARS) {
      chunks.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks.filter(Boolean);
}
