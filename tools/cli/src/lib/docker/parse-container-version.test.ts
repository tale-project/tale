import { describe, expect, test } from 'bun:test';

import { parseContainerVersionInspect } from './parse-container-version';

describe('parseContainerVersionInspect', () => {
  test('prefers the OCI version label when it is a semver', () => {
    expect(
      parseContainerVersionInspect(
        '0.4.2\nghcr.io/tale-project/tale/tale-platform:0.4.1\nTALE_VERSION=0.4.0\n',
      ),
    ).toBe('0.4.2');
  });

  test('falls back to the compose image tag when the OCI label is missing', () => {
    // GHCR release images: build-push-action `labels:` replaced the Dockerfile
    // LABEL, so inspect prints Go's empty-map placeholder.
    expect(
      parseContainerVersionInspect(
        '<no value>\nghcr.io/tale-project/tale/tale-platform:0.4.2\nPATH=/usr/bin\nTALE_VERSION=0.4.2\n',
      ),
    ).toBe('0.4.2');
  });

  test('falls back to TALE_VERSION when label and image tag are unreadable', () => {
    expect(
      parseContainerVersionInspect(
        '<no value>\nghcr.io/tale-project/tale/tale-platform:latest\nPATH=/usr/bin\nTALE_VERSION=0.4.2\n',
      ),
    ).toBe('0.4.2');
  });

  test('ignores a non-semver OCI label (dev) and reads the image tag', () => {
    expect(
      parseContainerVersionInspect(
        'dev\nghcr.io/tale-project/tale/tale-platform:0.4.2\nTALE_VERSION=dev\n',
      ),
    ).toBe('0.4.2');
  });

  test('returns null when no source yields a semver', () => {
    expect(
      parseContainerVersionInspect('<no value>\nsha256:abc\nPATH=/usr/bin\n'),
    ).toBeNull();
  });
});
