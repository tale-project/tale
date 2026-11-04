import { docker as defaultDocker } from './docker';

interface Mount {
  Type?: string;
  Name?: string;
  Destination?: string;
}

/**
 * The name of the volume a container mounts at `destination`, or `null` when
 * the container does not exist, mounts nothing there, or mounts a host path
 * there instead of a volume.
 *
 * `docker` is injectable so the unit test passes a fake rather than reaching
 * for Bun's process-global `mock.module`.
 */
export async function volumeMountedAt(
  containerName: string,
  destination: string,
  { docker }: { docker: typeof defaultDocker } = { docker: defaultDocker },
): Promise<string | null> {
  const result = await docker(
    'container',
    'inspect',
    '--format',
    '{{json .Mounts}}',
    containerName,
  );
  if (!result.success) return null;
  const mounts: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(mounts)) return null;
  const mount = (mounts as Mount[]).find(
    (entry) => entry.Type === 'volume' && entry.Destination === destination,
  );
  return mount?.Name ?? null;
}
