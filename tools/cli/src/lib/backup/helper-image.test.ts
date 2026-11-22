import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  BACKUP_HELPER_IMAGE,
  BLOB_VOLUME,
  keepsExtendedAttributes,
  LEGACY_BLOB_VOLUME,
  RESTORABLE_ARCHIVES,
  SNAPSHOT_VOLUMES,
  tarHelper,
  XATTR_HELPER_IMAGE,
} from './constants';

const REPO = resolve(import.meta.dir, '../../../../..');

describe('the helper that archives the blob store', () => {
  // versitygw keeps an object's content type and ETag in the extended
  // attributes of its file. Measured (2026-11-22): archived and extracted
  // with busybox's tar, the object comes back as `text/plain` with no ETag;
  // with Debian's GNU tar and these flags, as it was.
  test('is a tar that keeps extended attributes, and is told to keep them', () => {
    expect(keepsExtendedAttributes(BLOB_VOLUME)).toBe(true);
    expect(tarHelper(BLOB_VOLUME)).toEqual({
      image: XATTR_HELPER_IMAGE,
      flags: " --xattrs --xattrs-include='user.*'",
    });
    expect(XATTR_HELPER_IMAGE).toMatch(
      /^debian:bookworm-slim@sha256:[0-9a-f]{64}$/,
    );
  });

  test("is, for every other volume, the helper it always was: MinIO's volume among them", () => {
    for (const volume of [
      ...SNAPSHOT_VOLUMES.filter((name) => name !== BLOB_VOLUME),
      LEGACY_BLOB_VOLUME,
    ]) {
      expect(keepsExtendedAttributes(volume)).toBe(false);
      expect(tarHelper(volume)).toEqual({
        image: BACKUP_HELPER_IMAGE,
        flags: '',
      });
    }
  });

  // One pin to move, not two: the Debian the images are built on is the one
  // a snapshot was archived with and a restore extracts with.
  test("is pinned by the digest the platform's image is built on", () => {
    const dockerfile = readFileSync(
      resolve(REPO, 'services/platform/Dockerfile'),
      'utf8',
    );
    const bases = [
      ...dockerfile.matchAll(
        /^FROM (debian:bookworm-slim@sha256:[0-9a-f]{64})/gm,
      ),
    ].map((match) => match[1]);

    expect(bases.length).toBeGreaterThan(0);
    expect([...new Set(bases)]).toEqual([XATTR_HELPER_IMAGE]);
  });
});

describe('the two blob volumes', () => {
  test("a snapshot archives versitygw's by its name, and restores either", () => {
    expect(BLOB_VOLUME).toBe('blob-data');
    expect(LEGACY_BLOB_VOLUME).toBe('object-store-data');
    expect(SNAPSHOT_VOLUMES).toContain(BLOB_VOLUME);
    // MinIO's is archived only where the blobs still are in it
    // (live-blob-volume.ts), so it is no candidate of every snapshot.
    expect(SNAPSHOT_VOLUMES).not.toContain(LEGACY_BLOB_VOLUME);
    expect(RESTORABLE_ARCHIVES).toContain(BLOB_VOLUME);
    expect(RESTORABLE_ARCHIVES).toContain(LEGACY_BLOB_VOLUME);
  });
});
