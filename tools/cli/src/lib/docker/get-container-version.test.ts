import { describe, expect, mock, test } from 'bun:test';

import { getContainerVersion } from './get-container-version';

function fakeDocker(stdout: string, success = true) {
  const docker = mock(async () => ({
    success,
    stdout,
    stderr: success ? '' : 'Error: No such container',
    exitCode: success ? 0 : 1,
  }));
  return docker;
}

describe('getContainerVersion', () => {
  test('prefers the OCI version label when it is a semver', async () => {
    const docker = fakeDocker(
      '0.4.2\nghcr.io/tale-project/tale/tale-platform:0.4.1\nTALE_VERSION=0.4.0\n',
    );

    await expect(
      getContainerVersion('tale-platform-blue', { docker }),
    ).resolves.toBe('0.4.2');
  });

  test('falls back to the compose image tag when the OCI label is missing', async () => {
    // GHCR release images: build-push-action `labels:` replaced the Dockerfile
    // LABEL, so inspect prints Go's empty-map placeholder.
    const docker = fakeDocker(
      '<no value>\nghcr.io/tale-project/tale/tale-platform:0.4.2\nPATH=/usr/bin\nTALE_VERSION=0.4.2\n',
    );

    await expect(
      getContainerVersion('tale-daf4fb-platform-blue', { docker }),
    ).resolves.toBe('0.4.2');
  });

  test('falls back to TALE_VERSION when label and image tag are unreadable', async () => {
    const docker = fakeDocker(
      '<no value>\nghcr.io/tale-project/tale/tale-platform:latest\nPATH=/usr/bin\nTALE_VERSION=0.4.2\n',
    );

    await expect(
      getContainerVersion('tale-platform-blue', { docker }),
    ).resolves.toBe('0.4.2');
  });

  test('ignores a non-semver OCI label (dev) and reads the image tag', async () => {
    const docker = fakeDocker(
      'dev\nghcr.io/tale-project/tale/tale-platform:0.4.2\nTALE_VERSION=dev\n',
    );

    await expect(
      getContainerVersion('tale-platform-blue', { docker }),
    ).resolves.toBe('0.4.2');
  });

  test('returns null when the container does not exist', async () => {
    const docker = fakeDocker('', false);

    await expect(
      getContainerVersion('tale-platform-blue', { docker }),
    ).resolves.toBeNull();
  });

  test('returns null when no source yields a semver', async () => {
    const docker = fakeDocker('<no value>\nsha256:abc\nPATH=/usr/bin\n');

    await expect(
      getContainerVersion('tale-platform-blue', { docker }),
    ).resolves.toBeNull();
  });
});
