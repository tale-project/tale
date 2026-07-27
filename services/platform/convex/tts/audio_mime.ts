/**
 * Audio format → MIME type for TTS chunks. V8-safe (no node imports) so both
 * the `'use node'` synthesize action (typing the stored blob) and the V8
 * `getChunkForServe` query (labeling the `/api/tts-audio` response for an
 * `s3:`-backed chunk, whose bytes carry no stored content type) share one map.
 */
export const AUDIO_MIME_BY_FORMAT: Record<string, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg; codecs=opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/L16; rate=24000',
};
