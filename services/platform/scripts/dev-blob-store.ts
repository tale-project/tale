/**
 * The blob store of `bun dev`'s Docker services is versitygw, on the volume
 * `blob-data` (tale-project/tale#4942). A dev stack brought up before ran
 * MinIO and kept its uploads in `object-store-data`, in MinIO's format, which
 * nothing reads now: the files uploaded before the update stop downloading,
 * and the old volume sits on the disk. That is said once, on the bring-up
 * that creates `blob-data` beside it.
 */

/** What one `docker` call answered. */
export interface DockerAnswer {
  status: number | null;
  stdout: string;
}

/** Runs `docker` with these arguments, quietly, and answers what it said. */
type DockerRunner = (args: readonly string[]) => DockerAnswer;

/** The names of the volumes Compose made for `volume`, of every project. */
function composeVolumes(docker: DockerRunner, volume: string): string[] {
  const listed = docker([
    'volume',
    'ls',
    '-q',
    '--filter',
    `label=com.docker.compose.volume=${volume}`,
  ]);
  if (listed.status !== 0) return [];
  return listed.stdout
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

/** The project a Compose volume name belongs to. */
function projectOf(name: string, volume: string): string {
  return name.slice(0, -`_${volume}`.length);
}

/** The project name Compose gives these files, or null when it says none. */
function composeProject(
  docker: DockerRunner,
  composeArgs: readonly string[],
): string | null {
  const config = docker([...composeArgs, 'config', '--format', 'json']);
  if (config.status !== 0) return null;
  const name = /"name"\s*:\s*"([a-z0-9][a-z0-9_-]*)"/.exec(config.stdout)?.[1];
  return name ?? null;
}

/**
 * What to tell a developer whose dev stack still has MinIO's blob volume and
 * is about to get versitygw's, or null. Asked before `docker compose up`,
 * which creates `blob-data`; after that the stack has both, and this answers
 * null for good. The usual answer, with no MinIO volume on the machine, costs
 * one `docker volume ls`; the project's name is asked of Compose only where a
 * project without `blob-data` has one.
 */
export function minioDevBlobsNotice(
  docker: DockerRunner,
  composeArgs: readonly string[],
): string | null {
  const minio = composeVolumes(docker, 'object-store-data');
  if (minio.length === 0) return null;
  const moved = new Set(
    composeVolumes(docker, 'blob-data').map((name) =>
      projectOf(name, 'blob-data'),
    ),
  );
  const waiting = minio
    .map((name) => projectOf(name, 'object-store-data'))
    .filter((project) => !moved.has(project));
  if (waiting.length === 0) return null;
  const project = composeProject(docker, composeArgs);
  if (project === null || !waiting.includes(project)) return null;
  return (
    `The dev stack's blob store is versitygw now, on the volume ${project}_blob-data. ` +
    `Files uploaded before this update stay in ${project}_object-store-data, in MinIO's format, and no longer download. ` +
    `Remove that volume once you no longer need them: docker volume rm ${project}_object-store-data`
  );
}
