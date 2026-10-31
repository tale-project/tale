/**
 * The Docker Engine Tale supports, judged the same way wherever Tale meets
 * one: the CLI judges the engine on its own machine before it starts
 * anything, and Settings → Sandboxes judges the engine each connected device
 * reports.
 */

/**
 * The oldest Docker Engine Tale supports. Tale publishes its images with
 * zstd-compressed layers, which Docker pulls from Engine 23.0 on, and keeps
 * the Compose files and health checks it generates working down to Engine 24.
 */
export const MIN_DOCKER_ENGINE_MAJOR = 24;
/** The first Docker Engine that pulls zstd-compressed layers. */
export const ZSTD_DOCKER_ENGINE_MAJOR = 23;

/**
 * The major release a Docker Engine version starts with (`20.10.24`,
 * `v24.0.7`, `26.1.5+dfsg1`), or null when it starts with none (`dev`).
 */
export function dockerEngineMajor(version: string): number | null {
  const major = Number(/^v?(\d+)\./.exec(version)?.[1] ?? Number.NaN);
  return Number.isInteger(major) ? major : null;
}

/**
 * Docker numbered its engine 0.x and 1.x up to 1.13, by year and month from
 * 17.03 to 20.10, then 23.0 on. Another engine behind the Docker API reports
 * its own release where Docker reports the engine's, so a major Docker never
 * shipped (Podman 4 or 5) is another engine's.
 */
function isDockerEngineMajor(major: number): boolean {
  return major <= 1 || (major >= 17 && major <= 20) || major >= 23;
}

/**
 * Is `version`, the bare server version a Docker API reports (`docker info`'s
 * `ServerVersion`), a Docker Engine older than {@link MIN_DOCKER_ENGINE_MAJOR}?
 * A version that is missing, unreadable or another engine's is never judged.
 */
export function isDockerEngineBelowFloor(
  version: string | null | undefined,
): boolean {
  if (version === null || version === undefined) return false;
  const major = dockerEngineMajor(version);
  return (
    major !== null &&
    isDockerEngineMajor(major) &&
    major < MIN_DOCKER_ENGINE_MAJOR
  );
}
