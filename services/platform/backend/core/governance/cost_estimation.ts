/**
 * Cost estimates for the calls a provider bills by audio minute or by
 * character rather than by token. Token-priced chat turns are costed from the
 * provider catalog instead (`estimateCostCents` in `lib/chat/turn.ts`).
 */

/**
 * Round a cents value to 4 decimal places ($0.000001 precision). Used across
 * the cost-tracking ledger so float artifacts like `0.012 * 100 =
 * 1.2000000000000002` don't propagate into stored values.
 */
function roundCents(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Estimate cost in cents for a transcription call billed per minute of audio.
 * OpenAI whisper-1 = $0.006/min = 0.6 cents/min (pass via `centsPerAudioMinute`
 * from the provider JSON). Returns 0 when the provider declares no price —
 * useful for self-hosted Whisper where spend is operational, not per-call.
 */
export function estimateTranscriptionCostCents(
  audioDurationSec: number,
  centsPerAudioMinute: number | undefined,
): number {
  if (!centsPerAudioMinute || audioDurationSec <= 0) return 0;
  return roundCents((audioDurationSec / 60) * centsPerAudioMinute);
}

/**
 * Estimate cost in cents for a TTS call billed per character (e.g. OpenAI
 * `tts-1` at $15/M chars = 1500 cents/M). gpt-4o-mini-tts actually bills per
 * token; the field is an operator-supplied approximation in that case.
 * Returns 0 when the provider declares no price.
 */
export function estimateTtsCostCents(
  characterCount: number,
  centsPerMillionCharacters: number | undefined,
): number {
  if (!centsPerMillionCharacters || characterCount <= 0) return 0;
  return roundCents((characterCount / 1_000_000) * centsPerMillionCharacters);
}
