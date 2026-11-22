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

/** The video tools as the step resolved them on this machine. */
export interface ResolvedVideoToolchain {
  readonly binDir: string;
  readonly ffmpegLocation: string;
  readonly pluginDir: string;
}

/**
 * What the step adds to the environment the backend inherits, given what is
 * there already: the settings that say where the tools are, each only where
 * it is not set (a developer's own value wins), and the lane.
 *
 * A deployment fetches a video in a sandbox session, whose image carries
 * yt-dlp. `bun dev` has resolved the tools on this machine, and the session
 * image a developer built may predate them: it fetches a video here
 * (`VIDEO_INGEST_LANE=local`). A developer who sets `VIDEO_INGEST_LANE=sandbox`
 * keeps the deployment's lane.
 *
 * `toolchain` is `null` where the developer named the tools' places
 * themselves and nothing was resolved.
 */
export function videoToolchainEnv(
  env: NodeJS.ProcessEnv,
  toolchain: ResolvedVideoToolchain | null,
): Record<string, string> {
  const add: Record<string, string> = {};
  const fill = (name: string, value: string): void => {
    if (!env[name]) add[name] = value;
  };
  if (toolchain !== null) {
    fill('VIDEO_INGEST_BIN_DIR', toolchain.binDir);
    fill('VIDEO_INGEST_FFMPEG_LOCATION', toolchain.ffmpegLocation);
    fill('VIDEO_INGEST_YTDLP_PLUGIN_DIRS', toolchain.pluginDir);
  }
  fill('VIDEO_INGEST_LANE', 'local');
  return add;
}

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
