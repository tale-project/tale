import { extractVersion } from '../../utils/compare-versions';

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
 * Parse `docker inspect --format` output from {@link getContainerVersion}:
 * OCI label, then image ref, then env block. Lives in its own module so the
 * unit tests are not shadowed by `rollback.test.ts`'s process-global
 * `mock.module('../docker/get-container-version')`.
 */
export function parseContainerVersionInspect(stdout: string): string | null {
  const [labelLine, imageLine, ...envLines] = stdout.split('\n');
  return (
    parseSemver(labelLine) ??
    parseSemver(imageLine) ??
    versionFromEnvBlock(envLines.join('\n'))
  );
}
