import { describe, expect, it } from 'vitest';

import {
  everyLaneRequired,
  fullCoverageBlockers,
  isSkippedCheck,
  itestObjectStore,
  recordSkip,
  requestedLanes,
} from './integration-lane-helpers';

const store = {
  ITEST_S3_ENDPOINT: 'http://127.0.0.1:9000',
  ITEST_S3_ACCESS_KEY: 'itest-key',
  ITEST_S3_SECRET_KEY: 'itest-secret',
};

function recorder() {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  return {
    checks,
    record: (name: string, ok: boolean, detail: string) => {
      checks.push({ name, ok, detail });
    },
  };
}

describe('everyLaneRequired', () => {
  it('holds only for ITEST_REQUIRE_ALL_LANES=1', () => {
    expect(everyLaneRequired({ ITEST_REQUIRE_ALL_LANES: '1' })).toBe(true);
    expect(everyLaneRequired({})).toBe(false);
    expect(everyLaneRequired({ ITEST_REQUIRE_ALL_LANES: 'true' })).toBe(false);
    expect(everyLaneRequired({ ITEST_REQUIRE_ALL_LANES: '0' })).toBe(false);
  });
});

describe('requestedLanes', () => {
  it('names the lanes of a filtered run, trimmed', () => {
    expect(requestedLanes({ ITEST_LANES: ' checkFiles, checkChat,,' })).toEqual(
      new Set(['checkFiles', 'checkChat']),
    );
  });

  it('is null for the full run', () => {
    expect(requestedLanes({})).toBeNull();
    expect(requestedLanes({ ITEST_LANES: '  ' })).toBeNull();
  });
});

describe('itestObjectStore', () => {
  it('reads the endpoint and both credentials', () => {
    expect(itestObjectStore(store)).toEqual({
      endpoint: 'http://127.0.0.1:9000',
      accessKeyId: 'itest-key',
      secretAccessKey: 'itest-secret',
    });
  });

  it("falls back to MinIO's credentials when only the endpoint is set", () => {
    expect(
      itestObjectStore({ ITEST_S3_ENDPOINT: 'http://127.0.0.1:9000' }),
    ).toEqual({
      endpoint: 'http://127.0.0.1:9000',
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
    });
  });

  it('is null without an endpoint', () => {
    expect(itestObjectStore({})).toBeNull();
    expect(itestObjectStore({ ...store, ITEST_S3_ENDPOINT: ' ' })).toBeNull();
  });
});

describe('fullCoverageBlockers', () => {
  const required = { ...store, ITEST_REQUIRE_ALL_LANES: '1' };

  it('judges nothing unless every lane is required', () => {
    expect(fullCoverageBlockers({ ITEST_LANES: 'checkFiles' })).toEqual([]);
  });

  it('lets a full run with an object store start', () => {
    expect(fullCoverageBlockers(required)).toEqual([]);
  });

  it('refuses a lane filter, naming the lanes it keeps', () => {
    expect(
      fullCoverageBlockers({
        ...required,
        ITEST_LANES: 'checkFiles,checkChat',
      }),
    ).toEqual(['ITEST_LANES runs only checkFiles, checkChat, not every lane']);
  });

  it('refuses a run missing any object-store variable', () => {
    expect(
      fullCoverageBlockers({ ITEST_REQUIRE_ALL_LANES: '1' }).map(
        (blocker) => blocker.split(' ')[0],
      ),
    ).toEqual([
      'ITEST_S3_ENDPOINT',
      'ITEST_S3_ACCESS_KEY',
      'ITEST_S3_SECRET_KEY',
    ]);
    expect(
      fullCoverageBlockers({ ...required, ITEST_S3_SECRET_KEY: '' }),
    ).toEqual([
      "ITEST_S3_SECRET_KEY is unset, so the blob lanes would sign with MinIO's default credentials",
    ]);
  });
});

describe('recordSkip', () => {
  it('reports a visible skip that passes in a local run', () => {
    const { checks, record } = recorder();
    recordSkip(record, 'files upload', 'no ITEST_S3_ENDPOINT', {});
    expect(checks).toEqual([
      {
        name: 'files upload (SKIPPED)',
        ok: true,
        detail: 'no ITEST_S3_ENDPOINT',
      },
    ]);
    expect(isSkippedCheck(checks[0]?.name ?? '')).toBe(true);
  });

  it('fails the check when every lane is required', () => {
    const { checks, record } = recorder();
    recordSkip(record, 'files upload', 'no ITEST_S3_ENDPOINT', {
      ITEST_REQUIRE_ALL_LANES: '1',
    });
    expect(checks).toEqual([
      {
        name: 'files upload',
        ok: false,
        detail:
          'DID NOT RUN: no ITEST_S3_ENDPOINT (ITEST_REQUIRE_ALL_LANES=1 needs every lane to run)',
      },
    ]);
    expect(isSkippedCheck(checks[0]?.name ?? '')).toBe(false);
  });
});
