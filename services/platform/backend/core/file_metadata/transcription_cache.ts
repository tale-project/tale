import { createHash } from 'node:crypto';

import type { ResolvedTranscriptionModel } from '../lib/providers/resolve_transcription_model';

/**
 * A transcript belongs to both the audio and the model/endpoint that read it.
 * JSON frames each field unambiguously; the NUL separates that header from
 * arbitrary audio bytes. The v3 domain includes the requested response format,
 * so changing timestamp support cannot reuse a transcript with different detail.
 * It makes legacy bytes-only hashes miss
 * without rewriting completed rows. Credentials are deliberately excluded.
 */
export function transcriptionCacheHash(
  bytes: Uint8Array,
  target: Pick<
    ResolvedTranscriptionModel,
    'providerName' | 'modelId' | 'baseUrl' | 'responseFormat'
  >,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'tale.transcription.cache.v3',
        target.providerName,
        target.modelId,
        target.baseUrl,
        target.responseFormat ?? 'verbose_json',
      ]),
    )
    .update('\0')
    .update(bytes)
    .digest('hex');
}
