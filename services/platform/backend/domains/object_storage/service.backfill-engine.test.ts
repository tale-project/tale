// @vitest-environment node

/**
 * The blob-backfill engine over fake stores and a scripted ledger: a copy
 * must land with the source's content type, be verified at the source's
 * size and only then retire the source; a run the watchdog already failed
 * must stop at its next stamp instead of completing itself; and every
 * org-owned table holding blob refs — documents, file_metadata,
 * tts_audio_chunks, video_link_jobs — must be walked; a source and target
 * that are ONE physical bucket — by config or by an alias only a probe can
 * see — must be refused before anything is deleted; and a same-size target
 * copy carrying the wrong content type is re-copied, never taken as the
 * finished move. The live MinIO round-trip rides `integration-check.ts`
 * (data residency lane).
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runBackfill } from './service.ts';

interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

interface FakeBucket {
  objects: Map<string, StoredObject>;
  /** Every blob key PUT into this bucket, in order. */
  puts: string[];
  /** Every identity-probe marker PUT into this bucket, in order. */
  probes: string[];
  /** When set, a PUT keeps only this many bytes — a copy that lands short. */
  landShort?: number;
  /** When set, every GET moves the (faked) clock forward this far — a copy
   * that takes a while. */
  getAdvancesClockMs?: number;
}

/** A connection as the config tree would answer it: the bucket NAME the
 * config carries, the endpoint spelling (default MinIO when unset), and —
 * for an alias the config cannot see — the fake bucket the requests really
 * reach. */
interface FakeConnection {
  bucket: string;
  endpoint?: string;
  physical?: string;
}

const fakes = vi.hoisted(() => {
  const DEFAULT_ENDPOINT = 'http://minio.internal:9000';
  const buckets = new Map<string, FakeBucket>();
  const connections = new Map<string, FakeConnection>();
  /** The fake bucket a connection's requests land in. */
  const physicalBucketOf = (connection: {
    bucket: string;
    endpoint?: string;
  }): string => {
    for (const conn of connections.values()) {
      if (
        conn.bucket === connection.bucket &&
        (conn.endpoint ?? DEFAULT_ENDPOINT) === connection.endpoint
      ) {
        return conn.physical ?? conn.bucket;
      }
    }
    return connection.bucket;
  };
  return { DEFAULT_ENDPOINT, buckets, connections, physicalBucketOf };
});

vi.mock('../../core/object_storage/file_utils.ts', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../core/object_storage/file_utils.ts')
    >();
  return {
    ...actual,
    readOrgObjectStorageConnection: vi.fn((slug: string) => {
      const conn = fakes.connections.get(slug);
      if (conn === undefined) return Promise.resolve(null);
      return Promise.resolve({
        connection: {
          region: 'us-east-1',
          endpoint: conn.endpoint ?? fakes.DEFAULT_ENDPOINT,
          forcePathStyle: true,
          bucket: conn.bucket,
        },
        secrets: { accessKeyId: 'k', secretAccessKey: 's' },
      });
    }),
  };
});

vi.mock('../../core/lib/storage/object_store.ts', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../core/lib/storage/object_store.ts')
    >();
  return {
    ...actual,
    buildS3ObjectStore: (
      ...args: Parameters<typeof actual.buildS3ObjectStore>
    ) => {
      const store = actual.buildS3ObjectStore(...args);
      const bucket = fakes.physicalBucketOf(args[0]);
      Object.assign(store.client, {
        fetch: (input: string, init?: RequestInit) =>
          fakeS3(bucket, input, init),
      });
      return store;
    },
  };
});

function bucketOf(name: string): FakeBucket {
  let bucket = fakes.buckets.get(name);
  if (bucket === undefined) {
    bucket = { objects: new Map(), puts: [], probes: [] };
    fakes.buckets.set(name, bucket);
  }
  return bucket;
}

async function fakeS3(
  bucketName: string,
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const bucket = bucketOf(bucketName);
  const key = decodeURIComponent(new URL(input).pathname)
    .split('/')
    .slice(2)
    .join('/');
  const method = init?.method ?? 'GET';
  const existing = bucket.objects.get(key);
  if (method === 'HEAD') {
    return existing === undefined
      ? new Response(null, { status: 404 })
      : new Response(null, {
          status: 200,
          headers: {
            'content-length': String(existing.bytes.byteLength),
            'content-type': existing.contentType,
          },
        });
  }
  if (method === 'GET') {
    if (bucket.getAdvancesClockMs !== undefined) {
      vi.setSystemTime(Date.now() + bucket.getAdvancesClockMs);
    }
    return existing === undefined
      ? new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 })
      : new Response(Buffer.from(existing.bytes), {
          status: 200,
          headers: { 'content-type': existing.contentType },
        });
  }
  if (method === 'PUT') {
    const body: unknown = init?.body;
    if (!(body instanceof Uint8Array)) throw new Error('fake PUT: body shape');
    const headers = new Headers(init?.headers);
    const bytes = new Uint8Array(
      bucket.landShort === undefined ? body : body.slice(0, bucket.landShort),
    );
    const isProbe = new TextDecoder()
      .decode(body)
      .startsWith('tale-object-storage-identity-probe');
    (isProbe ? bucket.probes : bucket.puts).push(key);
    bucket.objects.set(key, {
      bytes,
      contentType: headers.get('content-type') ?? '',
    });
    return new Response(null, { status: 200 });
  }
  if (method === 'DELETE') {
    bucket.objects.delete(key);
    return new Response(null, { status: 204 });
  }
  throw new Error(`fake S3: unexpected ${method}`);
}

interface LedgerScript {
  dryRun?: boolean;
  documents?: {
    id: string;
    title: string;
    fileRef: string;
    historyFiles: string[];
  }[];
  files?: { id: string; fileName: string | null; storageRef: string }[];
  ttsChunks?: { id: string; storageRef: string }[];
  videoLinks?: { id: string; videoTitle: string | null; storageRef: string }[];
  /** Answer the Nth stamp (1-based) with no row — the watchdog got there first. */
  fenceAtStamp?: number;
}

interface Statement {
  text: string;
  values: unknown[];
}

/** A scripted `app.object_storage_backfill_runs` + source tables: each
 * table pages out once (then empty), every stamp answers its row unless
 * fenced. */
function fakeLedger(script: LedgerScript): {
  sql: Sql;
  statements: Statement[];
  stamps: () => Statement[];
} {
  const statements: Statement[] = [];
  const served = new Set<string>();
  let stampCount = 0;
  const page = <T>(table: string, rows: T[] | undefined): T[] => {
    if (served.has(table)) return [];
    served.add(table);
    return rows ?? [];
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings
      .reduce((acc, part, i) => acc + part + (i < values.length ? '?' : ''), '')
      .replace(/\s+/g, ' ')
      .trim();
    statements.push({ text, values });
    let rows: unknown[] = [];
    if (text.startsWith('SELECT org_slug')) {
      rows = [{ orgSlug: 'acme', dryRun: script.dryRun ?? false }];
    } else if (text.includes('SET phase = ?')) {
      stampCount += 1;
      rows = stampCount === script.fenceAtStamp ? [] : [{ id: 'run_1' }];
    } else if (text.includes('FROM app.documents')) {
      rows = page('documents', script.documents);
    } else if (text.includes('FROM app.file_metadata')) {
      rows = page('files', script.files);
    } else if (text.includes('FROM app.tts_audio_chunks')) {
      rows = page('tts', script.ttsChunks);
    } else if (text.includes('FROM app.video_link_jobs')) {
      rows = page('video', script.videoLinks);
    } else if (text.includes("status = 'completed'")) {
      rows = [{ id: 'run_1' }];
    }
    return Promise.resolve(rows);
  };
  Object.assign(tag, {
    json: (value: unknown) => value,
    unsafe: (value: string) => value,
  });
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
    sql: tag as unknown as Sql,
    statements,
    stamps: () => statements.filter((s) => s.text.includes('SET phase = ?')),
  };
}

function seed(bucket: string, key: string, body: string, contentType: string) {
  bucketOf(bucket).objects.set(key, {
    bytes: new TextEncoder().encode(body),
    contentType,
  });
}

const RUN = { runId: 'run_1', organizationId: 'org_1' };

beforeEach(() => {
  fakes.buckets.clear();
  fakes.connections.clear();
  fakes.connections.set('default', { bucket: 'default-blobs' });
  fakes.connections.set('acme', { bucket: 'acme-own' });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('runBackfill — moving blobs into the org bucket', () => {
  it('walks every ref-holding table, copies with the stored content type, verifies, and retires the source', async () => {
    seed('default-blobs', 'acme/doc', 'doc-bytes', 'application/pdf');
    seed('default-blobs', 'acme/hist', 'old-doc', 'application/pdf');
    seed('default-blobs', 'acme/file', 'file-bytes', 'image/png');
    seed('default-blobs', 'acme/tts', 'mp3', 'audio/mpeg');
    seed('default-blobs', 'acme/video', 'vtt', 'text/vtt');
    const ledger = fakeLedger({
      documents: [
        {
          id: 'd1',
          title: 'Report',
          fileRef: 's3:acme/doc',
          historyFiles: ['s3:acme/hist'],
        },
      ],
      files: [
        { id: 'f1', fileName: 'diagram.png', storageRef: 's3:acme/file' },
      ],
      ttsChunks: [{ id: 't1', storageRef: 's3:acme/tts' }],
      videoLinks: [
        { id: 'v1', videoTitle: 'Talk', storageRef: 's3:acme/video' },
      ],
    });

    await runBackfill(ledger.sql, RUN);

    const target = bucketOf('acme-own').objects;
    expect([...target.keys()].sort()).toEqual([
      'acme/doc',
      'acme/file',
      'acme/hist',
      'acme/tts',
      'acme/video',
    ]);
    // Regression: every copy used to land as application/octet-stream.
    expect(target.get('acme/doc')?.contentType).toBe('application/pdf');
    expect(target.get('acme/file')?.contentType).toBe('image/png');
    expect(target.get('acme/tts')?.contentType).toBe('audio/mpeg');
    expect(bucketOf('default-blobs').objects.size).toBe(0);

    const phases = ledger.stamps().map((s) => s.values[0]);
    expect(phases).toEqual([
      'documents',
      'documents',
      'fileMetadata',
      'fileMetadata',
      'ttsChunks',
      'ttsChunks',
      'videoLinks',
      'videoLinks',
      'done',
    ]);
    const final = ledger.stamps().at(-1);
    // [rowsScanned, migrated, skipped, failed]
    expect(final?.values.slice(1, 5)).toEqual([4, 5, 0, 0]);
    // The TTS sample entry carries no name — chunk text is message content.
    const sample = final?.values[8];
    expect(sample).toEqual(
      expect.arrayContaining([
        { ref: 's3:acme/tts', table: 'ttsChunks', size: 3 },
        { ref: 's3:acme/video', table: 'videoLinks', name: 'Talk', size: 3 },
      ]),
    );
    const completion = ledger.statements.find((s) =>
      s.text.includes("status = 'completed'"),
    );
    expect(completion?.text).toContain("AND status = 'running'");
  });

  it('finishes a move whose source delete was cut off, without copying again', async () => {
    seed('default-blobs', 'acme/doc', 'same-bytes', 'application/pdf');
    seed('acme-own', 'acme/doc', 'same-bytes', 'application/pdf');
    const ledger = fakeLedger({
      files: [{ id: 'f1', fileName: null, storageRef: 's3:acme/doc' }],
    });

    await runBackfill(ledger.sql, RUN);

    expect(bucketOf('default-blobs').objects.has('acme/doc')).toBe(false);
    expect(bucketOf('acme-own').objects.has('acme/doc')).toBe(true);
    expect(bucketOf('acme-own').puts).toEqual([]);
    const final = ledger.stamps().at(-1);
    expect(final?.values.slice(1, 5)).toEqual([1, 0, 1, 0]);
  });

  // Regression: the resume branch compared sizes only, so the first run
  // after the move existed took every octet-stream copy left by the
  // copy-only engine as the finished move — and deleted the one copy that
  // still carried the real content type.
  it('re-copies a same-size target copy stored as application/octet-stream and only then retires the source', async () => {
    seed('default-blobs', 'acme/doc', 'ten-bytes!', 'application/pdf');
    seed('acme-own', 'acme/doc', 'ten-bytes!', 'application/octet-stream');
    const ledger = fakeLedger({
      files: [{ id: 'f1', fileName: null, storageRef: 's3:acme/doc' }],
    });

    await runBackfill(ledger.sql, RUN);

    const copy = bucketOf('acme-own').objects.get('acme/doc');
    expect(copy?.contentType).toBe('application/pdf');
    expect(copy?.bytes.byteLength).toBe(10);
    expect(bucketOf('acme-own').puts).toEqual(['acme/doc']);
    expect(bucketOf('default-blobs').objects.has('acme/doc')).toBe(false);
    const final = ledger.stamps().at(-1);
    // [rowsScanned, migrated, skipped, failed]: migrated, not skipped.
    expect(final?.values.slice(1, 5)).toEqual([1, 1, 0, 0]);
  });

  it('finishes the move on size alone when the source store answers no content type', async () => {
    seed('default-blobs', 'acme/doc', 'ten-bytes!', '');
    seed('acme-own', 'acme/doc', 'ten-bytes!', 'application/octet-stream');
    const ledger = fakeLedger({
      files: [{ id: 'f1', fileName: null, storageRef: 's3:acme/doc' }],
    });

    await runBackfill(ledger.sql, RUN);

    expect(bucketOf('acme-own').puts).toEqual([]);
    expect(bucketOf('default-blobs').objects.has('acme/doc')).toBe(false);
    const final = ledger.stamps().at(-1);
    expect(final?.values.slice(1, 5)).toEqual([1, 0, 1, 0]);
  });

  it('re-copies a target copy of the wrong size instead of trusting it', async () => {
    seed('default-blobs', 'acme/doc', 'ten-bytes!', 'application/pdf');
    seed('acme-own', 'acme/doc', 'ten', 'application/octet-stream');
    const ledger = fakeLedger({
      files: [{ id: 'f1', fileName: null, storageRef: 's3:acme/doc' }],
    });

    await runBackfill(ledger.sql, RUN);

    const copy = bucketOf('acme-own').objects.get('acme/doc');
    expect(copy?.bytes.byteLength).toBe(10);
    expect(copy?.contentType).toBe('application/pdf');
    expect(bucketOf('default-blobs').objects.has('acme/doc')).toBe(false);
  });

  it('deletes a copy that lands short, keeps the source, and counts it failed', async () => {
    seed('default-blobs', 'acme/doc', 'ten-bytes!', 'application/pdf');
    bucketOf('acme-own').landShort = 3;
    const ledger = fakeLedger({
      files: [{ id: 'f1', fileName: null, storageRef: 's3:acme/doc' }],
    });

    await runBackfill(ledger.sql, RUN);

    expect(bucketOf('acme-own').objects.has('acme/doc')).toBe(false);
    expect(bucketOf('default-blobs').objects.has('acme/doc')).toBe(true);
    const final = ledger.stamps().at(-1);
    expect(final?.values.slice(1, 5)).toEqual([1, 0, 0, 1]);
  });

  it('copies nothing and deletes nothing on a dry run', async () => {
    seed('default-blobs', 'acme/doc', 'doc-bytes', 'application/pdf');
    const ledger = fakeLedger({
      dryRun: true,
      files: [{ id: 'f1', fileName: null, storageRef: 's3:acme/doc' }],
    });

    await runBackfill(ledger.sql, RUN);

    expect(bucketOf('acme-own').objects.size).toBe(0);
    expect(bucketOf('default-blobs').objects.has('acme/doc')).toBe(true);
    const final = ledger.stamps().at(-1);
    // candidates counted, nothing migrated.
    expect(final?.values[6]).toBe(1);
    expect(final?.values[2]).toBe(0);
  });

  /** The run failed SAME_STORE through the fenced failure UPDATE, and the
   * one seeded blob is still the only object in the shared bucket — no
   * source delete, no probe marker left behind. */
  function expectRefusedAsSameStore(
    ledger: ReturnType<typeof fakeLedger>,
    sharedBucket: string,
  ): void {
    expect([...bucketOf(sharedBucket).objects.keys()]).toEqual(['acme/doc']);
    const failed = ledger.statements.find((s) =>
      s.text.includes("status = 'failed'"),
    );
    expect(failed?.values.at(-2)).toMatch(/nothing to move/);
    expect(failed?.text).toContain("AND status = 'running'");
    expect(ledger.stamps()).toEqual([]);
  }

  it('refuses to move when the org bucket IS the deployment store', async () => {
    fakes.connections.set('acme', { bucket: 'default-blobs' });
    seed('default-blobs', 'acme/doc', 'doc-bytes', 'application/pdf');
    const ledger = fakeLedger({
      files: [{ id: 'f1', fileName: null, storageRef: 's3:acme/doc' }],
    });

    await runBackfill(ledger.sql, RUN);

    expectRefusedAsSameStore(ledger, 'default-blobs');
    // The config compare alone decided: no probe marker was ever written.
    expect(bucketOf('default-blobs').probes).toEqual([]);
  });

  // Regression: the same-store guard was a raw string compare of the
  // connection files, so `http://minio:9000/` against `http://minio:9000`
  // passed it, and the resume branch then deleted the ONLY copy of every
  // blob the org owned.
  it('refuses when the org connection spells the deployment endpoint differently', async () => {
    fakes.connections.set('acme', {
      bucket: 'default-blobs',
      endpoint: `${fakes.DEFAULT_ENDPOINT.toUpperCase()}/`,
    });
    seed('default-blobs', 'acme/doc', 'doc-bytes', 'application/pdf');
    const ledger = fakeLedger({
      files: [{ id: 'f1', fileName: null, storageRef: 's3:acme/doc' }],
    });

    await runBackfill(ledger.sql, RUN);

    expectRefusedAsSameStore(ledger, 'default-blobs');
    expect(bucketOf('default-blobs').probes).toEqual([]);
  });

  it('probes for an alias the config cannot see and refuses when the marker shows up through the source', async () => {
    // A DNS alias for the same MinIO: a different endpoint string, the same
    // physical bucket.
    fakes.connections.set('acme', {
      bucket: 'default-blobs',
      endpoint: 'http://minio-alias.internal:9000',
      physical: 'default-blobs',
    });
    seed('default-blobs', 'acme/doc', 'doc-bytes', 'application/pdf');
    const ledger = fakeLedger({
      files: [{ id: 'f1', fileName: null, storageRef: 's3:acme/doc' }],
    });

    await runBackfill(ledger.sql, RUN);

    expectRefusedAsSameStore(ledger, 'default-blobs');
    // Exactly one org-namespaced probe marker was written — and it is gone.
    const probes = bucketOf('default-blobs').probes;
    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatch(/^acme\/[0-9a-f-]{36}$/);
    expect(bucketOf('default-blobs').puts).toEqual([]);
  });

  it('refuses an aliased store on a dry run too, before it previews "nothing to move"', async () => {
    fakes.connections.set('acme', {
      bucket: 'default-blobs',
      endpoint: 'http://minio-alias.internal:9000',
      physical: 'default-blobs',
    });
    seed('default-blobs', 'acme/doc', 'doc-bytes', 'application/pdf');
    const ledger = fakeLedger({
      dryRun: true,
      files: [{ id: 'f1', fileName: null, storageRef: 's3:acme/doc' }],
    });

    await runBackfill(ledger.sql, RUN);

    expectRefusedAsSameStore(ledger, 'default-blobs');
  });

  it('leaves no probe marker behind in a genuinely different target', async () => {
    const ledger = fakeLedger({});
    await runBackfill(ledger.sql, RUN);
    expect(bucketOf('acme-own').probes).toHaveLength(1);
    expect(bucketOf('acme-own').puts).toEqual([]);
    expect(bucketOf('acme-own').objects.size).toBe(0);
    expect(bucketOf('default-blobs').probes).toEqual([]);
  });
});

describe('runBackfill — the status fence', () => {
  // Regression: stamps and the completion UPDATE were `WHERE id = ?` only, so
  // an engine the watchdog had already failed kept copying beside a fresh
  // run and finally flipped its own row back to 'completed'.
  it('stops at a stamp that matches no running row and leaves the terminal row alone', async () => {
    seed('default-blobs', 'acme/doc', 'doc-bytes', 'application/pdf');
    seed('default-blobs', 'acme/file', 'file-bytes', 'image/png');
    const ledger = fakeLedger({
      documents: [
        { id: 'd1', title: 'Report', fileRef: 's3:acme/doc', historyFiles: [] },
      ],
      files: [{ id: 'f1', fileName: null, storageRef: 's3:acme/file' }],
      // 1: documents start, 2: documents batch, 3: fileMetadata start → fenced.
      fenceAtStamp: 3,
    });

    await runBackfill(ledger.sql, RUN);

    // The document moved before the fence; the file phase never ran.
    expect(bucketOf('acme-own').objects.has('acme/doc')).toBe(true);
    expect(bucketOf('acme-own').objects.has('acme/file')).toBe(false);
    expect(bucketOf('default-blobs').objects.has('acme/file')).toBe(true);
    const terminalWrites = ledger.statements.filter(
      (s) =>
        s.text.includes("status = 'completed'") ||
        s.text.includes("status = 'failed'"),
    );
    expect(terminalWrites).toEqual([]);
    expect(ledger.stamps()).toHaveLength(3);
  });

  it('fences every stamp and the completion on status = running', async () => {
    const ledger = fakeLedger({});
    await runBackfill(ledger.sql, RUN);
    for (const stamp of ledger.stamps()) {
      expect(stamp.text).toContain("AND status = 'running' RETURNING id");
    }
  });

  // Regression: progress was stamped per 100-row batch only, so a batch of
  // large blobs went silent long enough for the watchdog to fail a live run.
  it('stamps progress again inside a batch once STAMP_INTERVAL_MS has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      seed('default-blobs', 'acme/a', 'a-bytes', 'application/pdf');
      seed('default-blobs', 'acme/b', 'b-bytes', 'application/pdf');
      // Each copy takes just over a minute.
      bucketOf('default-blobs').getAdvancesClockMs = 60_001;
      const ledger = fakeLedger({
        files: [
          { id: 'f1', fileName: null, storageRef: 's3:acme/a' },
          { id: 'f2', fileName: null, storageRef: 's3:acme/b' },
        ],
      });

      await runBackfill(ledger.sql, RUN);

      // start, one liveness stamp after each slow copy, batch end.
      const fileStamps = ledger
        .stamps()
        .filter((s) => s.values[0] === 'fileMetadata');
      expect(fileStamps).toHaveLength(4);
      // [rowsScanned, migrated] on the stamp after the first copy.
      expect(fileStamps[1]?.values.slice(1, 3)).toEqual([1, 1]);
      expect(fileStamps[2]?.values.slice(1, 3)).toEqual([2, 2]);
    } finally {
      vi.useRealTimers();
    }
  });
});
