/**
 * The sandbox RUNTIME image the host `bun dev` loop must guarantee.
 *
 * The spawner `docker run`s `tale-sandbox-runtime:latest` for every session —
 * its `SANDBOX_RUNTIME_IMAGE` default (services/sandbox/src/config.ts,
 * mirrored by compose.yml). The image is NOT a compose service, so the
 * backing-services bring-up never builds it, and it is NOT a registry image,
 * so the spawner's implicit `docker pull` fails too: on a fresh checkout, or
 * after an image prune, the first agent session 502s with "Unable to find
 * image 'tale-sandbox-runtime:latest' locally … pull access denied".
 * `docker:dev` and `tale dev` both prepare the image before the stack; this
 * module is the host loop's twin, delegating the build to the same repo-root
 * script so there is exactly one build recipe.
 *
 * node-only by location; pure data + message shaping (the orchestrator owns
 * the docker probe and the spawn).
 */

/** The spawner's default runtime tag — one string, pinned by a test against
 * the spawner config, compose.yml and the build script. */
export const SANDBOX_RUNTIME_IMAGE = 'tale-sandbox-runtime:latest';

/** The one build recipe, relative to the repo root (`docker:dev`'s prestep). */
export const ENSURE_SANDBOX_RUNTIME_SCRIPT =
  'scripts/ensure-sandbox-runtime-image.ts';

/** The step label while the image is built — honest about the wait, since
 * the build firehose stays captured behind the spinner. */
export const SANDBOX_RUNTIME_BUILD_STEP = {
  active: `Building the sandbox runtime image ${SANDBOX_RUNTIME_IMAGE} (one-time, several minutes)`,
  done: `Sandbox runtime image ${SANDBOX_RUNTIME_IMAGE} built`,
} as const;

/**
 * The degrade message when the build fails. SOFT on purpose: the fleet keeps
 * booting (pure frontend work needs no sandbox); only agent sessions and code
 * execution stay unavailable, and the operator gets the exact retry.
 */
export function sandboxRuntimeUnavailable(cause: unknown): string {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return (
    `${SANDBOX_RUNTIME_IMAGE} could not be built (${reason}) — agent ` +
    `sessions and code execution fail until it exists; retry with ` +
    `\`bun ${ENSURE_SANDBOX_RUNTIME_SCRIPT}\``
  );
}
