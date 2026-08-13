import { extractVersion } from '../../utils/compare-versions';
import { docker as defaultDocker } from './docker';

/**
 * Side-effecting docker inspect, injectable so the unit test can pass a fake
 * instead of `mock.module` (process-global in Bun; see pull-image.ts).
 */
interface GetContainerVersionDeps {
  docker: typeof defaultDocker;
}

function parseSemver(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value || value === '<no value>') {
    return null;
  }
  return extractVersion(value);
}

function versionFromEnvBlock(block: string): string | null {
  for (const line of block.split('\n')) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    if (line.slice(0, separator) !== 'TALE_VERSION') continue;
    return parseSemver(line.slice(separator + 1));
  }
  return null;
}

/**
 * Running image's semver, or `null` when the container is missing / the
 * version is unreadable.
 *
 * Released GHCR images historically had `org.opencontainers.image.version`
 * stripped: `docker/build-push-action`'s `labels:` input replaces Dockerfile
 * `LABEL`s, and `release.yml` / `build.yml` did not pass the version key.
 * Fall back to the compose image tag (`tale-platform:0.4.2`) then
 * `TALE_VERSION` (Dockerfile `ENV`, survives the label clobber) — both
 * present on every CLI-deployed instance.
 */
export async function getContainerVersion(
  containerName: string,
  { docker }: GetContainerVersionDeps = { docker: defaultDocker },
): Promise<string | null> {
  const result = await docker(
    'container',
    'inspect',
    '--format',
    '{{index .Config.Labels "org.opencontainers.image.version"}}\n{{.Config.Image}}\n{{range .Config.Env}}{{println .}}{{end}}',
    containerName,
  );

  if (!result.success) {
    return null;
  }

  const [labelLine, imageLine, ...envLines] = result.stdout.split('\n');
  return (
    parseSemver(labelLine) ??
    parseSemver(imageLine) ??
    versionFromEnvBlock(envLines.join('\n'))
  );
}
