/**
 * The lines the host `bun dev` loop prints for its external-toolchains step.
 *
 * That step resolves the host binaries the backend spawns — yt-dlp + deno +
 * ffmpeg for the video ingest lane today — into the environment the backend
 * inherits. The lines name the step's general job rather than one consumer of
 * it, so the skip, progress and failure lines all read as the same step.
 *
 * node-only by location; pure data + message shaping (the orchestrator owns
 * the provisioning and the environment it exports).
 */

/** The step label while the toolchains are resolved (a cold cache downloads
 * binaries, so the wait is worth naming). */
export const EXTERNAL_TOOLCHAINS_STEP = {
  active: 'Provisioning external toolchains',
  done: 'External toolchains ready',
} as const;

/** The hermetic E2E stack exercises no video ingestion, so it skips the step. */
export const EXTERNAL_TOOLCHAINS_E2E_SKIP =
  'Skipping external toolchains (TALE_E2E set — no video specs)';

/**
 * The degrade message when provisioning fails. SOFT on purpose: the rest of
 * the stack keeps booting; only a pasted video link goes without a transcript.
 */
export function externalToolchainsUnavailable(cause: unknown): string {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return (
    'External toolchain provisioning failed — pasting a video link in chat ' +
    "won't produce a transcript until they're installed. Underlying: " +
    reason
  );
}
