import { createHash } from 'node:crypto';

import type { ResolvedTranscriptionModel } from '../lib/providers/resolve_transcription_model';

/**
 * A transcript belongs to both the audio and the model/endpoint that read it.
 * JSON frames each field unambiguously; the NUL separates that header from
 * arbitrary audio bytes. The v2 domain makes legacy bytes-only hashes miss
 * without rewriting completed rows. Credentials are deliberately excluded.
 */
export function transcriptionCacheHash(
  bytes: Uint8Array,
  target: Pick<
    ResolvedTranscriptionModel,
    'providerName' | 'modelId' | 'baseUrl'
  >,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'tale.transcription.cache.v2',
        target.providerName,
        target.modelId,
        target.baseUrl,
      ]),
    )
    .update('\0')
    .update(bytes)
    .digest('hex');
}
