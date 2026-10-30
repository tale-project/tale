import { docker as defaultDocker } from './docker';

/**
 * Docker's state word for a container — `created`, `running`, `restarting`,
 * `paused`, `removing`, `exited` or `dead` — the same word `docker ps` prints
 * as `{{.State}}`. `null` when `docker inspect` fails, which is what a
 * container that does not exist answers.
 *
 * `isContainerRunning` reads `{{.State.Running}}` instead, which Docker also
 * sets while a container is restarting or paused; this word tells them apart.
 *
 * `docker` is injectable so the unit test passes a fake rather than reaching
 * for Bun's process-global `mock.module`.
 */
export async function getContainerState(
  containerName: string,
  { docker }: { docker: typeof defaultDocker } = { docker: defaultDocker },
): Promise<string | null> {
  const result = await docker(
    'container',
    'inspect',
    '--format',
    '{{.State.Status}}',
    containerName,
  );
  return result.success ? result.stdout.trim() : null;
}
