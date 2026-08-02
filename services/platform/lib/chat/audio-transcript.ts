/**
 * Pure formatting for the audio/video transcript appendix the chat turn
 * injects into the MODEL-facing user turn. The stored bubble keeps the typed
 * text only; the host loads `fileMetadata` and hands the rows here. This
 * module never touches Convex.
 */

export interface AudioTranscriptEntry {
  readonly fileName: string;
  readonly status?: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  readonly transcript?: string;
  readonly durationSec?: number;
  readonly error?: string;
}

/**
 * Start of a legacy appendix that older turns baked into the stored user
 * text (completed transcript block or failure marker). Used to recover the
 * typed prefix before re-injecting from `fileMetadata`.
 */
const LEGACY_APPENDIX_START =
  /\n\n(?:---\n\*\*Audio transcript: |\[Audio file ")/;

/**
 * Drop a baked-in transcript appendix (or failure marker) from stored user
 * text. Idempotent when none is present. The typed words — everything before
 * the first appendix marker — are what the bubble shows and what regenerate
 * re-sends.
 */
export function stripAudioTranscriptAppendix(text: string): string {
  const match = LEGACY_APPENDIX_START.exec(text);
  if (match === null) return text;
  return text.slice(0, match.index);
}

/**
 * Build the markdown appendix for one or more audio/video attachments.
 * Empty input → empty string (caller leaves `userText` untouched).
 * Completed rows carry the transcript; everything else gets a marker so
 * the model still knows a file was attached.
 */
export function buildAudioTranscriptAppendix(
  entries: readonly AudioTranscriptEntry[],
): string {
  if (entries.length === 0) return '';

  const pieces: string[] = [];
  for (const entry of entries) {
    if (
      entry.status === 'completed' &&
      entry.transcript !== undefined &&
      entry.transcript.length > 0
    ) {
      const durationNote =
        entry.durationSec !== undefined
          ? ` (${entry.durationSec.toFixed(1)}s)`
          : '';
      pieces.push(
        `\n\n---\n**Audio transcript: ${entry.fileName}**${durationNote}\n\n${entry.transcript}\n---\n`,
      );
    } else {
      const reason =
        entry.status === 'skipped'
          ? 'skipped'
          : (entry.error ?? 'transcription incomplete');
      pieces.push(
        `\n\n[Audio file "${entry.fileName}" could not be transcribed: ${reason}]\n`,
      );
    }
  }
  return pieces.join('');
}
