import * as defaultLogger from '../../utils/logger';
import { docker as defaultDocker } from './docker';
import { pullImage as defaultPullImage } from './pull-image';

/**
 * The tag the spawner falls back to when `SANDBOX_RUNTIME_IMAGE` is unset
 * (`create-sandbox-service.ts` passes
 * `${SANDBOX_RUNTIME_IMAGE:-tale-sandbox-runtime:latest}`). It is a LOCAL
 * build tag — `tale-sandbox-runtime` is not a registry repository, so a
 * daemon that does not already hold it answers `docker run` with
 * "pull access denied … repository does not exist", which reads like a
 * missing `docker login` rather than a missing image.
 */
export const SANDBOX_RUNTIME_LOCAL_TAG = 'tale-sandbox-runtime:latest';

export type EnsureRuntimeImageOutcome = 'present' | 'fetched' | 'unavailable';

interface EnsureRuntimeImageDeps {
  docker: typeof defaultDocker;
  pullImage: typeof defaultPullImage;
  logger: Pick<typeof defaultLogger, 'info' | 'warn'>;
}

/**
 * Put the sandbox runtime image on the host under the tag the spawner runs.
 *
 * Session containers are created with `docker run`, not by compose, so
 * `compose up` never fetches this image: a host that only ever ran the CLI
 * has no `tale-sandbox-runtime:latest` and every agent turn, `Run code`, web
 * render and document generation fails. `tale deploy` already pulls and
 * re-tags it for exactly this reason; `tale dev` did not.
 *
 * Only fetches when the tag is ABSENT. A contributor running the stack from
 * source builds this tag themselves, and overwriting their build with a
 * released image would silently discard what they are testing.
 *
 * Non-fatal: the rest of the stack — chat, knowledge, documents — works
 * without a sandbox, and a registry hiccup should not block a local bring-up.
 * The warning names the consequence so the failure is not discovered later
 * through the spawner's misleading error.
 */
export async function ensureSandboxRuntimeImage(
  registry: string,
  version: string,
  {
    docker = defaultDocker,
    pullImage = defaultPullImage,
    logger = defaultLogger,
  }: Partial<EnsureRuntimeImageDeps> = {},
): Promise<EnsureRuntimeImageOutcome> {
  const present = await docker('image', 'inspect', SANDBOX_RUNTIME_LOCAL_TAG);
  if (present.success) {
    return 'present';
  }

  const remote = `${registry}/tale-sandbox-runtime:${version}`;
  if (!(await pullImage(remote))) {
    logger.warn(
      `Could not fetch ${remote}. The stack still starts, but agent turns, ` +
        '`Run code`, web render and document generation will fail until it is ' +
        'available — re-run `tale dev` once the registry is reachable.',
    );
    return 'unavailable';
  }

  const tagged = await docker('tag', remote, SANDBOX_RUNTIME_LOCAL_TAG);
  if (!tagged.success) {
    logger.warn(
      `Fetched ${remote} but could not tag it ${SANDBOX_RUNTIME_LOCAL_TAG}: ` +
        `${tagged.stderr.trim()}. Agent turns and \`Run code\` will fail until ` +
        'that tag exists.',
    );
    return 'unavailable';
  }
  return 'fetched';
}
