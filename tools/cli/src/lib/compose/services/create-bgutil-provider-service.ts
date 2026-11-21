import { preconditionError } from '../../../utils/fail';
import { getProjectId } from '../../../utils/load-env';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING } from '../types';

/** The variable that turns the bundled PO-token provider on. */
const POT_PROVIDER_VARIABLE = 'VIDEO_INGEST_POT_PROVIDER';

/**
 * Whether the deployment asked for the bundled PO-token provider: `true` in
 * its `.env`, which the backend reads the same way (`potProviderOn` in
 * services/platform/backend/core/video_links/ytdlp.ts). Off unless it says
 * so. The provider is a container of about 60 MiB at rest (58 to 66 where
 * tale-project/tale#4942 measured it) that only YouTube links from an
 * address YouTube challenges have a use for, and without it a walled video
 * says which setting turns it on.
 *
 * A word that is neither is refused before anything is pulled: `yes` would
 * otherwise read as off on both sides, and the video links would say so only
 * when YouTube next walls one.
 */
export function potProviderAsked(
  read: (name: string) => string | undefined = (name) => process.env[name],
): boolean {
  const asked = (read(POT_PROVIDER_VARIABLE) ?? '').trim().toLowerCase();
  if (asked === '' || asked === 'false') return false;
  if (asked === 'true') return true;
  throw preconditionError(
    `${POT_PROVIDER_VARIABLE} must be true, false, or unset; got: ${JSON.stringify(read(POT_PROVIDER_VARIABLE)?.trim())}`,
  );
}

/**
 * bgutil PO-token provider — serves GVS proof-of-origin tokens to the yt-dlp
 * bgutil plugin baked into the platform image, so video-link ingestion survives
 * YouTube's "confirm you're not a bot" wall on datacenter/flagged IPs. Part
 * of a deployment only where it asked for it ({@link potProviderAsked}).
 *
 * Third-party image (not a `tale-*` build), so it is NOT part of the
 * always-roll stateful tier (whose deploy pulls `tale-<name>:<version>`).
 * `deploy.ts` brings it up in its OWN best-effort `up -d` after the core
 * services are healthy, and video ingest degrades gracefully (no token) if it
 * never starts, so it can never fail a deploy. Reached only by the backend over the `internal` network (no published
 * ports). The image tag MUST match `BGUTIL_POT_VERSION` in
 * services/platform/Dockerfile — bump both together.
 */
export function createBgutilProviderService(
  _config: ServiceConfig,
): ComposeService {
  return {
    image: 'brainicism/bgutil-ytdlp-pot-provider:1.3.1',
    container_name: `${getProjectId()}-bgutil-provider`,
    // Third-party image: pull if absent (the tale-* images come from the
    // project registry and are pulled explicitly by deploy.ts; this one isn't).
    pull_policy: 'missing',
    // PID 1 reaper — the provider spawns short-lived headless token workers.
    init: true,
    restart: 'unless-stopped',
    // Small footprint; the cap bounds a misbehaving token worker.
    mem_limit: '512m',
    pids_limit: 512,
    healthcheck: {
      // TCP liveness on the token port — no path assumption, works on any
      // flavor of the image.
      test: [
        'CMD',
        'node',
        '-e',
        "require('net').connect(4416,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))",
      ],
      interval: '30s',
      timeout: '5s',
      retries: 3,
      start_period: '20s',
    },
    logging: DEFAULT_LOGGING,
    networks: ['internal'],
  };
}
