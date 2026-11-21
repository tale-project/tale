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
  target: TranscriptionCacheTarget,
): string {
  const hasher = transcriptionCacheHasher(target);
  hasher.update(bytes);
  return hasher.digest();
}

type TranscriptionCacheTarget = Pick<
  ResolvedTranscriptionModel,
  'providerName' | 'modelId' | 'baseUrl' | 'responseFormat'
>;

/**
 * The same hash, made as the audio's bytes pass: a recording that is read
 * from the store into a file is hashed on its way there, and never held
 * whole to be hashed (tale-project/tale#4942). `update` takes the bytes in
 * order; `digest` answers what {@link transcriptionCacheHash} answers for
 * all of them.
 */
export function transcriptionCacheHasher(target: TranscriptionCacheTarget): {
  update(bytes: Uint8Array): void;
  digest(): string;
} {
  const hash = createHash('sha256')
    .update(
      JSON.stringify([
        'tale.transcription.cache.v3',
        target.providerName,
        target.modelId,
        target.baseUrl,
        target.responseFormat ?? 'verbose_json',
      ]),
    )
    .update('\0');
  return {
    update: (bytes) => {
      hash.update(bytes);
    },
    digest: () => hash.digest('hex'),
  };
}
