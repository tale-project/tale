import { docker } from './docker';
import { parseContainerVersionInspect } from './parse-container-version';

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

  return parseContainerVersionInspect(result.stdout);
}
