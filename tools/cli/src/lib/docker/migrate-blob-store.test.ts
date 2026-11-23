import { describe, expect, test } from 'bun:test';

import { MINIO_IMAGE, THIRD_PARTY_IMAGES } from '../compose/types';
import type { ExecResult } from './exec';
import {
  compareStores,
  copyBegan,
  migrateBlobStore,
  MOVE_SCRIPTS,
  parseRoom,
  probeKept,
  type MigrateBlobStoreDeps,
  type MigrateBlobStoreOptions,
} from './migrate-blob-store';

/**
 * The move of a deployment's blobs from MinIO to versitygw. What it must
 * never do is pinned here: take the store away, leave the deployment on a
 * versitygw that lost what S3 says of an object, switch with objects
 * missing, or leave behind in `blob-data` what would be taken for the live
 * store at the next deploy. The client's scripts themselves were run against
 * the real servers (u14/move-rehearsal.sh in the lab notes).
 */

const OK: ExecResult = { success: true, stdout: '', stderr: '', exitCode: 0 };
const fail = (stderr: string): ExecResult => ({
  success: false,
  stdout: '',
  stderr,
  exitCode: 1,
});
const out = (stdout: string): ExecResult => ({ ...OK, stdout });

const ROOM = (usedKiB: number, availableKiB: number) =>
  out(
    `${usedKiB}\t/from\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 999999999 1 ${availableKiB} 1% /to`,
  );
const PROBE_KEPT = out(
  '{"status":"success","name":"probe","size":22,"etag":"8db467e8f8a2298179a583dfcc87b66b","type":"file","metadata":{"Content-Type":"application/x-tale-probe"}}',
);
const PROBE_LOST = out(
  '{"status":"success","name":"probe","size":22,"etag":"","type":"file","metadata":{"Content-Type":"text/plain; charset=utf-8"}}',
);
/** What the first copy prints: when it began, then mc's summary. */
const BEGAN = '1795000000';
const FIRST_COPIED = out(
  `tale-move-since ${BEGAN}\n┌───────┬─────────────┐\n│ Total │ Transferred │\n│ 67 MiB │ 67 MiB │\n└───────┴─────────────┘`,
);
const SAME = out(
  [
    'src other/ {"prefix":"other","size":17,"objects":1,"status":"success"}',
    'src tale-blobs/ {"prefix":"tale-blobs","size":70600017,"objects":5,"status":"success"}',
    'dst other/ {"prefix":"other","size":17,"objects":1,"status":"success"}',
    'dst tale-blobs/ {"prefix":"tale-blobs","size":70600017,"objects":5,"status":"success"}',
  ].join('\n'),
);

type Step =
  | 'look'
  | 'measure'
  | 'remove'
  | 'start'
  | 'health'
  | 'inspect'
  | 'logs'
  | 'probe'
  | 'firstCopy'
  | 'finalCopy'
  | 'compare'
  | 'empty';

/** What a docker argv of the move is doing. */
function stepOf(args: readonly string[]): Step {
  const last = args.at(-1) ?? '';
  if (args[0] === 'rm') return 'remove';
  if (args[0] === 'exec') return 'health';
  if (args[0] === 'inspect') return 'inspect';
  if (args[0] === 'logs') return 'logs';
  if (args[0] === 'run' && args[1] === '-d') return 'start';
  if (last === 'du -sk /from && df -Pk /to') return 'measure';
  if (
    last ===
    'find /data -mindepth 1 -maxdepth 1 ! -name lost+found -print -quit'
  )
    return 'look';
  if (last === 'find /data -mindepth 1 -delete') return 'empty';
  for (const step of ['probe', 'firstCopy', 'finalCopy', 'compare'] as const)
    if (last === MOVE_SCRIPTS[step]) return step;
  throw new Error(
    `the move asked docker for something unknown: ${args.join(' ')}`,
  );
}

interface Call {
  step: Step;
  args: string[];
  env: Record<string, string | undefined> | undefined;
}

function scenario(answers: Partial<Record<Step, ExecResult>> = {}) {
  const calls: Call[] = [];
  const events: string[] = [];
  const stores: string[] = [];
  const deps: MigrateBlobStoreDeps = {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double of exec
    exec: (async (
      _command: string,
      args: string[],
      options: { env?: Record<string, string | undefined> } = {},
    ) => {
      const step = stepOf(args);
      calls.push({ step, args: [...args], env: options.env });
      events.push(step);
      const defaults: Record<Step, ExecResult> = {
        look: OK,
        measure: ROOM(4 * 1024 * 1024, 100 * 1024 * 1024),
        remove: fail('Error response from daemon: No such container'),
        start: out('c0ffee'),
        health: OK,
        inspect: out('true'),
        logs: OK,
        probe: PROBE_KEPT,
        firstCopy: FIRST_COPIED,
        finalCopy: OK,
        compare: SAME,
        empty: OK,
      };
      return answers[step] ?? defaults[step];
    }) as MigrateBlobStoreDeps['exec'],
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double of the pause
    withVolumeContainersPaused: (async (
      volumes: readonly string[],
      work: (paused: number) => Promise<unknown>,
    ) => {
      events.push(`pause ${volumes.join(',')}`);
      try {
        return await work(2);
      } finally {
        events.push('unpause');
      }
    }) as MigrateBlobStoreDeps['withVolumeContainersPaused'],
    logger: {
      step: () => {},
      info: () => {},
      warn: () => {},
      success: () => {},
    },
    sleep: async () => {},
  };
  const options = (
    converge: Partial<Record<'minio' | 'versitygw', boolean>> = {},
  ): MigrateBlobStoreOptions => ({
    prefix: 'p_',
    project: 'p',
    accessKey: 'tale',
    secretKey: 'se/cr:et@x',
    convergeStore: async (engine) => {
      events.push(`store ${engine}`);
      stores.push(engine);
      return converge[engine] ?? true;
    },
  });
  return {
    deps,
    options,
    calls,
    events,
    stores,
  };
}

describe('moving the blobs from MinIO to versitygw', () => {
  test('copies, pauses the application for the last copy and the switch, and starts versitygw as the store', async () => {
    const run = scenario();

    const moved = await migrateBlobStore(run.options(), run.deps);

    expect(moved).toEqual({ moved: true, objects: 6, bytes: 70600034 });
    expect(run.events).toEqual([
      'look',
      'measure',
      'store minio',
      'remove',
      'start',
      'health',
      'probe',
      'firstCopy',
      'pause p_config-data',
      'finalCopy',
      'compare',
      'remove',
      'store versitygw',
      'unpause',
    ]);
    // MinIO's volume is only ever read, and nothing empties blob-data.
    const measure = run.calls.find((call) => call.step === 'measure');
    expect(measure?.args).toContain('p_object-store-data:/from:ro');
    expect(run.calls.some((call) => call.step === 'empty')).toBe(false);
  });

  test("starts the move's versitygw on blob-data, on the stack's network, with nothing it does not need", async () => {
    const run = scenario();

    await migrateBlobStore(run.options(), run.deps);

    const start = run.calls.find((call) => call.step === 'start');
    expect(start?.args).toEqual([
      'run',
      '-d',
      '--name',
      'p-object-store-move',
      '--network',
      'p_internal',
      '--cap-drop',
      'ALL',
      '-v',
      'p_blob-data:/data',
      '-e',
      'ROOT_ACCESS_KEY',
      '-e',
      'ROOT_SECRET_KEY',
      THIRD_PARTY_IMAGES['object-store'],
      '--port',
      ':9000',
      '--health',
      '/_health',
      '--quiet',
      'posix',
      '--fsync',
      '/data',
    ]);
  });

  test("runs the client in MinIO's image, for its architecture, against the stack's MinIO and the move's versitygw", async () => {
    const run = scenario();

    await migrateBlobStore(run.options(), run.deps);

    const probe = run.calls.find((call) => call.step === 'probe');
    expect(probe?.args.slice(0, 16)).toEqual([
      'run',
      '--rm',
      '--network',
      'p_internal',
      '--platform',
      'linux/amd64',
      '-e',
      'TALE_MOVE_SOURCE',
      '-e',
      'TALE_MOVE_TARGET',
      '-e',
      'TALE_STORE_KEY_ID',
      '-e',
      'TALE_STORE_KEY',
      '--entrypoint',
      'bash',
    ]);
    expect(probe?.args).toContain(MINIO_IMAGE);
    expect(probe?.env?.TALE_MOVE_SOURCE).toBe('http://object-store:9000');
    expect(probe?.env?.TALE_MOVE_TARGET).toBe(
      'http://p-object-store-move:9000',
    );
  });

  test('copies last only what changed since the first copy began, by the clock of the host the servers run on', async () => {
    const run = scenario();

    await migrateBlobStore(run.options(), run.deps);

    const last = run.calls.find((call) => call.step === 'finalCopy');
    expect(last?.env?.TALE_MOVE_SINCE).toBe(BEGAN);
    expect(last?.args.slice(14, 16)).toEqual(['-e', 'TALE_MOVE_SINCE']);
    for (const call of run.calls.filter((c) => c.step !== 'finalCopy')) {
      expect(call.args).not.toContain('TALE_MOVE_SINCE');
      expect(call.env?.TALE_MOVE_SINCE).toBeUndefined();
    }
    // The first copy says when it began before it copies; the last takes
    // what is newer than that, and a minute more.
    expect(MOVE_SCRIPTS.firstCopy.split('\n').slice(-2)).toEqual([
      'echo "tale-move-since $(date +%s)"',
      'mc mirror --quiet --retry src dst',
    ]);
    expect(MOVE_SCRIPTS.finalCopy.split('\n').slice(-2)).toEqual([
      'window=$(( $(date +%s) - TALE_MOVE_SINCE + 60 ))',
      'mc mirror --quiet --retry --overwrite --remove --newer-than "${window}s" src dst',
    ]);
  });

  // The key is never an argument: `ps` on the host shows those.
  test('hands the key over in the environment alone, whatever it holds', async () => {
    const run = scenario();

    await migrateBlobStore(run.options(), run.deps);

    for (const call of run.calls) {
      expect(call.args.join(' ')).not.toContain('se/cr:et@x');
    }
    const start = run.calls.find((call) => call.step === 'start');
    expect(start?.env?.ROOT_SECRET_KEY).toBe('se/cr:et@x');
    const copy = run.calls.find((call) => call.step === 'firstCopy');
    expect(copy?.env?.TALE_STORE_KEY).toBe('se/cr:et@x');
    expect(copy?.env?.TALE_STORE_KEY_ID).toBe('tale');
    // Given as aliases, the key is no part of a URL, which mc reads
    // undecoded (a key with / : or @ fails there).
    for (const script of Object.values(MOVE_SCRIPTS)) {
      expect(script).toContain(
        'mc alias set src "$TALE_MOVE_SOURCE" "$TALE_STORE_KEY_ID" "$TALE_STORE_KEY"',
      );
      expect(script).not.toContain('MC_HOST');
    }
  });

  // A MinIO still running with a key since rotated in .env would refuse the
  // copy: the store is brought to what the stack declares first, which
  // leaves a store that did not change alone.
  test('brings MinIO to what the stack declares first, since it serves the copy', async () => {
    const run = scenario();

    await migrateBlobStore(run.options(), run.deps);

    expect(run.events.slice(0, 3)).toEqual(['look', 'measure', 'store minio']);
    expect(run.stores).toEqual(['minio', 'versitygw']);
  });

  test('keeps MinIO, having started nothing, when MinIO itself does not start', async () => {
    const run = scenario();

    const kept = await migrateBlobStore(
      run.options({ minio: false }),
      run.deps,
    );

    expect(kept).toEqual({
      moved: false,
      reason: 'MinIO did not start to serve the blobs for the copy',
    });
    expect(run.calls.some((call) => call.step === 'start')).toBe(false);
  });

  test('keeps MinIO, having touched nothing, without the room for a copy', async () => {
    // 10 GiB in MinIO's volume, 10 GiB free: it needs 12 GiB.
    const run = scenario({ measure: ROOM(10 * 1024 * 1024, 10 * 1024 * 1024) });

    const kept = await migrateBlobStore(run.options(), run.deps);

    expect(kept).toEqual({
      moved: false,
      reason:
        'moving the blobs needs 12.0 GB free where p_blob-data lives, and 10.0 GB is free',
    });
    expect(run.events).toEqual(['look', 'measure']);
  });

  test('keeps MinIO when the room cannot be read', async () => {
    const run = scenario({ measure: fail('no such volume') });

    const kept = await migrateBlobStore(run.options(), run.deps);

    expect(kept.moved).toBe(false);
    expect(run.events).toEqual(['look', 'measure']);
  });

  // It empties blob-data when it stops short: only one it found empty.
  test('starts only on an empty blob-data, and leaves one that holds files as it is', async () => {
    const run = scenario({ look: out('/data/tale-blobs') });

    const kept = await migrateBlobStore(run.options(), run.deps);

    expect(kept).toEqual({
      moved: false,
      reason:
        'p_blob-data holds files already (/data/tale-blobs); the move starts only on an empty one',
    });
    expect(run.events).toEqual(['look']);
  });

  test('keeps MinIO, having changed nothing, when blob-data cannot be looked into', async () => {
    const run = scenario({ look: fail('Error: No such volume') });

    const kept = await migrateBlobStore(run.options(), run.deps);

    expect(kept).toEqual({
      moved: false,
      reason: 'p_blob-data could not be looked into (Error: No such volume)',
    });
    expect(run.events).toEqual(['look']);
  });

  test('keeps MinIO, having looked at nothing, without the store’s key', async () => {
    const run = scenario();

    const kept = await migrateBlobStore(
      { ...run.options(), secretKey: '' },
      run.deps,
    );

    expect(kept).toEqual({
      moved: false,
      reason: "the store's key, OBJECT_STORE_SECRET_KEY, is not in .env",
    });
    expect(run.events).toEqual([]);
  });

  // A filesystem without user extended attributes: versitygw stores the
  // object and says nothing, and every blob would come back as plain text.
  test('keeps MinIO, and empties blob-data, when an object comes back without its type and ETag', async () => {
    const run = scenario({ probe: PROBE_LOST });

    const kept = await migrateBlobStore(run.options(), run.deps);

    expect(kept).toEqual({
      moved: false,
      reason:
        "the filesystem of p_blob-data keeps no extended attributes (an object written there came back as text/plain; charset=utf-8 with ETag none); versitygw keeps each object's content type and ETag in them",
    });
    expect(run.events.slice(-2)).toEqual(['remove', 'empty']);
    expect(run.stores).toEqual(['minio']);
  });

  test('keeps MinIO when an object comes back with its type and without its ETag', async () => {
    const run = scenario({
      probe: out(
        '{"etag":"","metadata":{"Content-Type":"application/x-tale-probe"}}',
      ),
    });

    const kept = await migrateBlobStore(run.options(), run.deps);

    expect(kept.moved).toBe(false);
    expect(run.events.at(-1)).toBe('empty');
  });

  test('keeps MinIO when no object can be written to versitygw', async () => {
    const run = scenario({ probe: fail('mc: <ERROR> Access Denied.') });

    const kept = await migrateBlobStore(run.options(), run.deps);

    expect(kept).toEqual({
      moved: false,
      reason:
        'an object could not be written to versitygw on p_blob-data: mc: <ERROR> Access Denied.',
    });
    expect(run.events.at(-1)).toBe('empty');
  });

  test("keeps MinIO when the move's versitygw stops as it starts, saying what it said", async () => {
    const run = scenario({
      health: fail('connection refused'),
      inspect: out('false'),
      logs: out('failed to init posix backend: permission denied'),
    });

    const kept = await migrateBlobStore(run.options(), run.deps);

    expect(kept).toEqual({
      moved: false,
      reason:
        'versitygw stopped as it started: failed to init posix backend: permission denied',
    });
    expect(run.events.slice(-2)).toEqual(['remove', 'empty']);
  });

  test('keeps MinIO, unpaused and never stopped, when the first copy fails', async () => {
    const run = scenario({ firstCopy: fail('mc: <ERROR> Failed to copy') });

    const kept = await migrateBlobStore(run.options(), run.deps);

    expect(kept).toEqual({
      moved: false,
      reason: 'the copy failed: mc: <ERROR> Failed to copy',
    });
    expect(run.events).not.toContain('pause p_config-data');
    expect(run.stores).toEqual(['minio']);
    expect(run.events.at(-1)).toBe('empty');
  });

  // Without the time, the last copy would take every object again with the
  // application paused.
  test('keeps MinIO, unpaused, when the first copy does not say when it began', async () => {
    const run = scenario({ firstCopy: out('Total 67 MiB') });

    const kept = await migrateBlobStore(run.options(), run.deps);

    expect(kept).toEqual({
      moved: false,
      reason: 'the copy did not say when it began: Total 67 MiB',
    });
    expect(run.events).not.toContain('pause p_config-data');
    expect(run.events).not.toContain('finalCopy');
    expect(run.stores).toEqual(['minio']);
    expect(run.events.slice(-2)).toEqual(['remove', 'empty']);
  });

  test('keeps MinIO, and never switches, when the two stores differ after the last copy', async () => {
    const run = scenario({
      compare: out(
        [
          'src tale-blobs/ {"prefix":"tale-blobs","size":100,"objects":3}',
          'dst tale-blobs/ {"prefix":"tale-blobs","size":90,"objects":2}',
        ].join('\n'),
      ),
    });

    const kept = await migrateBlobStore(run.options(), run.deps);

    expect(kept).toEqual({
      moved: false,
      reason:
        'the two stores differ: tale-blobs holds 3 object(s), 100 byte(s) on MinIO and 2 object(s), 90 byte(s) on versitygw',
    });
    expect(run.stores).toEqual(['minio']);
    // Unpaused before the cleanup.
    expect(run.events.slice(-3)).toEqual(['unpause', 'remove', 'empty']);
  });

  test('starts MinIO again, and then empties blob-data, when versitygw does not answer healthy as the store', async () => {
    const run = scenario();

    const kept = await migrateBlobStore(
      run.options({ versitygw: false }),
      run.deps,
    );

    expect(kept).toEqual({
      moved: false,
      reason: 'versitygw did not answer healthy as the store',
    });
    expect(run.stores).toEqual(['minio', 'versitygw', 'minio']);
    expect(run.events.slice(-3)).toEqual(['remove', 'store minio', 'empty']);
  });

  test('answers a fault it did not foresee like a refusal, with MinIO serving again', async () => {
    const run = scenario();
    const exec = run.deps.exec;
    run.deps.exec = (async (
      command: string,
      args: string[],
      options?: object,
    ) => {
      if (stepOf(args) === 'finalCopy') throw new Error('spawn docker ENOENT');
      return exec(command, args, options as never);
    }) as MigrateBlobStoreDeps['exec'];

    const kept = await migrateBlobStore(run.options(), run.deps);

    expect(kept).toEqual({
      moved: false,
      reason: 'the move stopped: spawn docker ENOENT',
    });
    expect(run.events.at(-1)).toBe('empty');
  });
});

describe('what the move reads', () => {
  test('the size of MinIO’s volume and the room for blob-data, from du and df', () => {
    expect(
      parseRoom(
        '69172\t/from\nFilesystem           1024-blocks    Used Available Capacity Mounted on\n/dev/vda1            761649124 553186848 208445892  73% /to',
      ),
    ).toEqual({ usedKiB: 69172, availableKiB: 208445892 });
    expect(parseRoom('')).toBeNull();
    expect(parseRoom('du: /from: No such file or directory')).toBeNull();
  });

  test('when the first copy began, from the line it prints before copying', () => {
    expect(copyBegan(FIRST_COPIED.stdout)).toBe(BEGAN);
    expect(copyBegan(`mc: <WARN> slow\n  tale-move-since ${BEGAN}  \n`)).toBe(
      BEGAN,
    );
    expect(copyBegan('')).toBeNull();
    // `date` without `+%s`, or a mark without a time, says nothing usable.
    expect(
      copyBegan('tale-move-since Sun Nov 22 14:40:00 UTC 2026'),
    ).toBeNull();
    expect(copyBegan('tale-move-since ')).toBeNull();
    expect(copyBegan('tale-move-since 42')).toBeNull();
    expect(copyBegan(`not-tale-move-since ${BEGAN}`)).toBeNull();
  });

  test('whether the probe object came back as written', () => {
    expect(probeKept(PROBE_KEPT.stdout)).toBe(true);
    expect(probeKept(PROBE_LOST.stdout)).toBe(
      'as text/plain; charset=utf-8 with ETag none',
    );
    expect(probeKept('not json')).toMatch(/^unreadable/);
  });

  test('whether the two stores hold the same buckets, objects and bytes', () => {
    expect(compareStores(SAME.stdout)).toEqual({ objects: 6, bytes: 70600034 });
    expect(
      compareStores(
        'src a/ {"size":1,"objects":1}\nsrc b/ {"size":1,"objects":1}\ndst a/ {"size":1,"objects":1}',
      ),
    ).toBe('b is missing from versitygw');
    expect(
      compareStores(
        'src a/ {"size":1,"objects":1}\ndst a/ {"size":1,"objects":1}\ndst c/ {"size":0,"objects":0}',
      ),
    ).toBe('c is on versitygw only');
    expect(compareStores('src a/ {"objects":1}')).toBe(
      'the size of a on src is unreadable',
    );
    // A MinIO with no bucket holds nothing the deployment reads.
    expect(compareStores('')).toEqual({ objects: 0, bytes: 0 });
  });
});
