import { createHash } from 'node:crypto';

import { formatBytes } from '../../utils/format-bytes';
import * as defaultLogger from '../../utils/logger';
import {
  archiveTimeoutSeconds,
  BACKUP_HELPER_IMAGE,
  BLOB_VOLUME,
  CONFIG_VOLUME,
  LEGACY_BLOB_VOLUME,
} from '../backup/constants';
import {
  imagePlatform,
  MINIO_IMAGE,
  THIRD_PARTY_IMAGES,
  type ObjectStoreEngine,
} from '../compose/types';
import { exec as defaultExec } from './exec';
import { withVolumeContainersPaused as defaultWithPaused } from './with-volume-paused';

/**
 * Move a deployment's blobs from MinIO to versitygw (tale-project/tale#4942).
 *
 * The two servers keep their files in formats neither reads of the other, so
 * the blobs go across through S3: MinIO serves them as it always did, a
 * versitygw of the move's own serves `blob-data`, and MinIO's client copies
 * every bucket from one to the other. Then the stack's store is started as
 * versitygw on `blob-data`.
 *
 *   1. Room: `blob-data`'s filesystem must hold what MinIO's volume holds,
 *      with a tenth more and a gibibyte to spare.
 *   2. Extended attributes: versitygw keeps what S3 says of an object (its
 *      content type, its ETag) in its file's extended attributes. An object
 *      written to the move's versitygw has to come back with both, or the
 *      filesystem keeps none, and every blob would come back as text with no
 *      ETag.
 *   3. A first copy while the deployment runs, then a second with the
 *      writers paused (the containers that read the config store: the
 *      application), which takes what changed since and drops what was
 *      deleted.
 *   4. Both stores are compared bucket by bucket: the same buckets, the same
 *      number of objects, the same bytes.
 *   5. The stack's store is replaced by versitygw on `blob-data`, still with
 *      the writers paused, and the writers go on against it.
 *
 * Anything short of that leaves MinIO serving the blobs as before: the
 * move's versitygw is removed, what it wrote into `blob-data` is deleted
 * (that volume held nothing when the move began, or the deployment would not
 * be on MinIO), and a store already replaced is started as MinIO again.
 * MinIO's own volume is never written and never deleted: it stays as it was
 * until the operator removes it.
 */

export type BlobStoreMove =
  /** The blobs are in versitygw's volume, and the store runs versitygw. */
  | { moved: true; objects: number; bytes: number }
  /** MinIO still serves the blobs, for `reason`. */
  | { moved: false; reason: string };

export interface MigrateBlobStoreOptions {
  /** The volume prefix of the stack, `${projectId}_`. */
  prefix: string;
  /** The project id, which names the move's own store. */
  project: string;
  /** The store's root key: the one the stack starts either server with. */
  accessKey: string;
  secretKey: string;
  /** Bring the stack's `object-store` to `engine` as the stack declares it
   * (started, or recreated where its settings changed) and wait for it to
   * answer healthy; false when it did not. */
  convergeStore: (engine: ObjectStoreEngine) => Promise<boolean>;
}

export interface MigrateBlobStoreDeps {
  exec: typeof defaultExec;
  withVolumeContainersPaused: typeof defaultWithPaused;
  logger: Pick<typeof defaultLogger, 'step' | 'info' | 'warn' | 'success'>;
  sleep: (milliseconds: number) => Promise<void>;
}

function realDeps(): MigrateBlobStoreDeps {
  return {
    exec: defaultExec,
    withVolumeContainersPaused: defaultWithPaused,
    logger: defaultLogger,
    sleep: (milliseconds) => Bun.sleep(milliseconds),
  };
}

/** What the store's room must hold beyond MinIO's volume: a tenth more, and
 * a gibibyte. */
const ROOM_FACTOR = 1.1;
const ROOM_SPARE_KIB = 1024 * 1024;
/** How long the move's versitygw has to answer its health path. */
const START_TIMEOUT_MS = 60_000;
const POLL_MS = 1_000;
/** The line the first copy begins with: the mark, then the host's seconds
 * since the epoch. */
const SINCE_MARK = 'tale-move-since';
/** The probe of extended attributes: its bucket, its body and its type. */
const PROBE_BUCKET = 'tale-move-probe';
const PROBE_BODY = 'tale blob store probe\n';
const PROBE_TYPE = 'application/x-tale-probe';

/**
 * How each script of the client begins: the two stores as `mc` aliases, from
 * the environment the client is started with. The key goes to `mc alias
 * set` as an argument of its own, inside the client's container: given in
 * a URL (`MC_HOST_<alias>`), mc reads it undecoded, and a key with a `/`,
 * a `:` or an `@` in it fails, encoded or not (measured, 2026-11-22).
 */
const ALIASES = [
  'set -euo pipefail',
  'mc alias set src "$TALE_MOVE_SOURCE" "$TALE_STORE_KEY_ID" "$TALE_STORE_KEY" > /dev/null',
  'mc alias set dst "$TALE_MOVE_TARGET" "$TALE_STORE_KEY_ID" "$TALE_STORE_KEY" > /dev/null',
];

/** The client's scripts, run by `bash` in MinIO's image. Each is what the
 * lab rehearsal runs against the real servers (u14/move-rehearsal.sh). */
export const MOVE_SCRIPTS = {
  /** Writes one object with a content type and reads what came back. */
  probe: [
    ...ALIASES,
    `printf '${PROBE_BODY.replace('\n', '\\n')}' > /tmp/probe`,
    `mc mb --quiet dst/${PROBE_BUCKET} > /dev/null`,
    `mc cp --quiet --attr 'Content-Type=${PROBE_TYPE}' /tmp/probe dst/${PROBE_BUCKET}/probe > /dev/null`,
    `mc stat --json dst/${PROBE_BUCKET}/probe`,
    `mc rb --force --quiet dst/${PROBE_BUCKET} > /dev/null`,
  ].join('\n'),
  /** Every bucket and object, while the deployment writes on. It says
   * first when it began, by the clock of the host both servers run on. */
  firstCopy: [
    ...ALIASES,
    `echo "${SINCE_MARK} $(date +%s)"`,
    'mc mirror --quiet --retry src dst',
  ].join('\n'),
  /** What changed since the first copy began, with nothing writing:
   * objects written or replaced since, and a minute before for the clock's
   * grain, copied again; deleted ones gone. Without `--newer-than` mc would
   * copy every object again: versitygw lists no object with the source
   * time mc keeps beside a copy, so to mc every object differs. */
  finalCopy: [
    ...ALIASES,
    'window=$(( $(date +%s) - TALE_MOVE_SINCE + 60 ))',
    'mc mirror --quiet --retry --overwrite --remove --newer-than "${window}s" src dst',
  ].join('\n'),
  /** Each side's buckets, each with its objects and bytes: one line per
   * bucket, `<side> <bucket>/ <mc du --json>`. */
  compare: [
    ...ALIASES,
    'for side in src dst; do',
    '  mc ls --json "$side" > "/tmp/$side.buckets"',
    '  while IFS= read -r line; do',
    '    bucket="${line#*\\"key\\":\\"}"',
    '    bucket="${bucket%%\\"*}"',
    '    printf \'%s %s \' "$side" "$bucket"',
    '    mc du --json "$side/$bucket"',
    '  done < "/tmp/$side.buckets"',
    'done',
  ].join('\n'),
} as const;

/** A volume's size and the room on a filesystem, both in KiB. */
const MEASURE = 'du -sk /from && df -Pk /to';

/** Any top-level name of a volume but `lost+found` (ext filesystems). */
const CONTENT_PROBE =
  'find /data -mindepth 1 -maxdepth 1 ! -name lost+found -print -quit';

/** The move's own versitygw: a name no service of the stack has. */
function moveStore(project: string): string {
  return `${project}-object-store-move`;
}

class MoveRefused extends Error {}

export async function migrateBlobStore(
  options: MigrateBlobStoreOptions,
  injected: Partial<MigrateBlobStoreDeps> = {},
): Promise<BlobStoreMove> {
  const deps = { ...realDeps(), ...injected };
  const { prefix, project } = options;
  const minioVolume = `${prefix}${LEGACY_BLOB_VOLUME}`;
  const blobVolume = `${prefix}${BLOB_VOLUME}`;
  const network = `${prefix}internal`;
  const temporary = moveStore(project);
  const timeoutS = archiveTimeoutSeconds(LEGACY_BLOB_VOLUME);
  // The keys travel in the environment of the `docker` command, which hands
  // each to its container by name: never in an argument, which `ps` shows.
  const keyEnvironment = {
    ...process.env,
    ROOT_ACCESS_KEY: options.accessKey,
    ROOT_SECRET_KEY: options.secretKey,
    TALE_STORE_KEY_ID: options.accessKey,
    TALE_STORE_KEY: options.secretKey,
    TALE_MOVE_SOURCE: 'http://object-store:9000',
    TALE_MOVE_TARGET: `http://${temporary}:9000`,
  };

  const docker = (args: string[], timeout = 120) =>
    deps.exec('docker', args, { silent: true, timeout });
  const said = (result: { stderr: string; stdout: string }) =>
    result.stderr.trim() || result.stdout.trim() || 'no output';
  /** One script of the client, against the stack's MinIO and the move's
   * versitygw, on the stack's network; `since`, when the first copy began,
   * for the final one. */
  const client = (script: string, timeout: number, since?: string) => {
    const platform = imagePlatform(MINIO_IMAGE);
    return deps.exec(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        network,
        ...(platform === undefined ? [] : ['--platform', platform]),
        '-e',
        'TALE_MOVE_SOURCE',
        '-e',
        'TALE_MOVE_TARGET',
        '-e',
        'TALE_STORE_KEY_ID',
        '-e',
        'TALE_STORE_KEY',
        ...(since === undefined ? [] : ['-e', 'TALE_MOVE_SINCE']),
        '--entrypoint',
        'bash',
        MINIO_IMAGE,
        '-c',
        script,
      ],
      {
        silent: true,
        timeout,
        env:
          since === undefined
            ? keyEnvironment
            : { ...keyEnvironment, TALE_MOVE_SINCE: since },
      },
    );
  };
  const removeTemporary = async (): Promise<void> => {
    const removed = await docker(['rm', '-f', temporary]);
    if (!removed.success && !/No such container/i.test(removed.stderr)) {
      deps.logger.warn(
        `Could not remove the container ${temporary} the move of the blob store started (${said(removed)}): remove it by hand.`,
      );
    }
  };

  // The stack starts either server with this key; without it there is no
  // store to copy from or to.
  if (options.secretKey === '') {
    return {
      moved: false,
      reason: "the store's key, OBJECT_STORE_SECRET_KEY, is not in .env",
    };
  }

  // The move empties blob-data when it stops short, which is safe only
  // because it starts on an empty one: a blob-data that holds anything is
  // the live store's, or was left by someone, and is not the move's to
  // empty.
  const looked = await docker([
    'run',
    '--rm',
    '-v',
    `${blobVolume}:/data:ro`,
    BACKUP_HELPER_IMAGE,
    'sh',
    '-c',
    CONTENT_PROBE,
  ]);
  if (!looked.success) {
    return {
      moved: false,
      reason: `${blobVolume} could not be looked into (${said(looked)})`,
    };
  }
  if (looked.stdout.trim() !== '') {
    return {
      moved: false,
      reason: `${blobVolume} holds files already (${looked.stdout.trim()}); the move starts only on an empty one`,
    };
  }

  // 1. Room.
  const measured = await docker(
    [
      'run',
      '--rm',
      '-v',
      `${minioVolume}:/from:ro`,
      '-v',
      `${blobVolume}:/to:ro`,
      BACKUP_HELPER_IMAGE,
      'sh',
      '-c',
      MEASURE,
    ],
    timeoutS,
  );
  const room = measured.success ? parseRoom(measured.stdout) : null;
  if (room === null) {
    return {
      moved: false,
      reason: `the size of ${minioVolume} and the room for ${blobVolume} could not be read (${said(measured)})`,
    };
  }
  const needKiB = Math.ceil(room.usedKiB * ROOM_FACTOR + ROOM_SPARE_KIB);
  if (room.availableKiB < needKiB) {
    return {
      moved: false,
      reason: `moving the blobs needs ${formatBytes(needKiB * 1024)} free where ${blobVolume} lives, and ${formatBytes(room.availableKiB * 1024)} is free`,
    };
  }

  // MinIO serves the blobs for the copy, so it runs for it, as the stack
  // declares it: a MinIO still running with a key since rotated in .env
  // would refuse the copy the key the move hands it. Where nothing changed,
  // this leaves the running store alone.
  if (!(await options.convergeStore('minio'))) {
    return {
      moved: false,
      reason: 'MinIO did not start to serve the blobs for the copy',
    };
  }

  deps.logger.step(
    `Moving the blobs from ${minioVolume} (${formatBytes(room.usedKiB * 1024)}) to versitygw on ${blobVolume}...`,
  );
  let switched = false;
  try {
    // 2. Extended attributes, through the move's own versitygw.
    await removeTemporary();
    const started = await deps.exec(
      'docker',
      [
        'run',
        '-d',
        '--name',
        temporary,
        '--network',
        network,
        '--cap-drop',
        'ALL',
        '-v',
        `${blobVolume}:/data`,
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
      ],
      { silent: true, timeout: 300, env: keyEnvironment },
    );
    if (!started.success) {
      throw new MoveRefused(`versitygw did not start: ${said(started)}`);
    }
    await waitAnswering(deps, docker, temporary);

    const probe = await client(MOVE_SCRIPTS.probe, 120);
    if (!probe.success) {
      throw new MoveRefused(
        `an object could not be written to versitygw on ${blobVolume}: ${said(probe)}`,
      );
    }
    const kept = probeKept(probe.stdout);
    if (kept !== true) {
      throw new MoveRefused(
        `the filesystem of ${blobVolume} keeps no extended attributes (an object written there came back ${kept}); versitygw keeps each object's content type and ETag in them`,
      );
    }

    // 3. The first copy, with the deployment running.
    const first = await client(MOVE_SCRIPTS.firstCopy, timeoutS);
    if (!first.success) {
      throw new MoveRefused(`the copy failed: ${said(first)}`);
    }
    // The final copy takes what changed since this one began: without the
    // time, it would copy everything again with the application paused.
    const since = copyBegan(first.stdout);
    if (since === null) {
      throw new MoveRefused(
        `the copy did not say when it began: ${said(first)}`,
      );
    }

    // The rest with the application paused, so nothing writes meanwhile.
    const totals = await deps.withVolumeContainersPaused(
      [`${prefix}${CONFIG_VOLUME}`],
      async (pausedCount) => {
        if (pausedCount > 0) {
          deps.logger.info(
            `  The application is paused (${pausedCount} container(s)) for the last copy and the switch.`,
          );
        }
        const last = await client(MOVE_SCRIPTS.finalCopy, timeoutS, since);
        if (!last.success) {
          throw new MoveRefused(`the last copy failed: ${said(last)}`);
        }
        // 4. Both stores hold the same.
        const compared = await client(MOVE_SCRIPTS.compare, timeoutS);
        if (!compared.success) {
          throw new MoveRefused(
            `the two stores could not be compared: ${said(compared)}`,
          );
        }
        const same = compareStores(compared.stdout);
        if (typeof same === 'string') {
          throw new MoveRefused(`the two stores differ: ${same}`);
        }
        // 5. The stack's store becomes versitygw on blob-data.
        await removeTemporary();
        switched = true;
        if (!(await options.convergeStore('versitygw'))) {
          throw new MoveRefused(
            'versitygw did not answer healthy as the store',
          );
        }
        return same;
      },
    );

    deps.logger.success(
      `Moved ${totals.objects} object(s), ${formatBytes(totals.bytes)}, to versitygw on ${blobVolume}. ` +
        `${minioVolume} is left as it was: remove it once you no longer need it (docker volume rm ${minioVolume}).`,
    );
    return { moved: true, ...totals };
  } catch (error) {
    // Whatever stopped the move, MinIO serves the blobs again before this
    // answers: a move never takes a deployment's store away.
    const reason =
      error instanceof MoveRefused
        ? error.message
        : `the move stopped: ${error instanceof Error ? error.message : String(error)}`;
    await removeTemporary();
    if (switched && !(await options.convergeStore('minio'))) {
      // The stack is left without a store: say so, whatever else failed.
      deps.logger.warn(
        `MinIO did not start again after versitygw failed: start the store with \`tale deploy --services object-store\`. The blobs are intact in ${minioVolume}.`,
      );
    }
    await emptyVolume(deps, docker, blobVolume);
    return { moved: false, reason };
  }
}

/** When the first copy began, in the host's seconds since the epoch, as the
 * line it prints before copying says; null without that line. */
export function copyBegan(output: string): string | null {
  for (const line of output.split('\n')) {
    const match = new RegExp(`^${SINCE_MARK} (\\d{9,})$`).exec(line.trim());
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

/** What `du -sk` and `df -Pk` said: the volume's KiB, the room's KiB. */
export function parseRoom(
  output: string,
): { usedKiB: number; availableKiB: number } | null {
  const lines = output.trim().split('\n');
  const used = /^(\d+)\s+\/from$/.exec(lines[0]?.trim() ?? '')?.[1];
  const fields = lines.at(-1)?.trim().split(/\s+/) ?? [];
  const available = fields.length >= 6 ? fields[3] : undefined;
  if (used === undefined || available === undefined) return null;
  if (!/^\d+$/.test(available)) return null;
  return { usedKiB: Number(used), availableKiB: Number(available) };
}

/** True when the probe object came back with its type and its ETag, else
 * what it came back with. */
export function probeKept(output: string): true | string {
  let stat: unknown;
  try {
    stat = JSON.parse(output.trim().split('\n').at(-1) ?? '');
  } catch (error) {
    return `unreadable (${error instanceof Error ? error.message : String(error)})`;
  }
  if (stat === null || typeof stat !== 'object') return 'unreadable';
  const record = stat as { etag?: unknown; metadata?: Record<string, unknown> };
  const type = record.metadata?.['Content-Type'];
  const etag = String(record.etag ?? '').replaceAll('"', '');
  const expected = createHash('md5').update(PROBE_BODY).digest('hex');
  if (type === PROBE_TYPE && etag === expected) return true;
  return `as ${String(type ?? 'no type')} with ETag ${etag || 'none'}`;
}

/** The two stores' buckets, objects and bytes, or what differs. */
export function compareStores(
  output: string,
): { objects: number; bytes: number } | string {
  const sides = {
    src: new Map<string, string>(),
    dst: new Map<string, string>(),
  };
  let objects = 0;
  let bytes = 0;
  for (const line of output.split('\n')) {
    const match = /^(src|dst) (\S+)\/ (\{.*\})$/.exec(line.trim());
    if (!match) continue;
    const [, side = '', bucket = '', json = ''] = match;
    let du: { size?: unknown; objects?: unknown };
    try {
      du = JSON.parse(json) as typeof du;
    } catch (error) {
      return `the size of ${bucket} on ${side} is unreadable (${error instanceof Error ? error.message : String(error)})`;
    }
    if (typeof du.size !== 'number' || typeof du.objects !== 'number') {
      return `the size of ${bucket} on ${side} is unreadable`;
    }
    sides[side as 'src' | 'dst'].set(
      bucket,
      `${du.objects} object(s), ${du.size} byte(s)`,
    );
    if (side === 'src') {
      objects += du.objects;
      bytes += du.size;
    }
  }
  // MinIO with no bucket holds nothing the deployment reads: nothing to move.
  for (const [bucket, src] of sides.src) {
    const dst = sides.dst.get(bucket);
    if (dst === undefined) return `${bucket} is missing from versitygw`;
    if (dst !== src)
      return `${bucket} holds ${src} on MinIO and ${dst} on versitygw`;
  }
  for (const bucket of sides.dst.keys()) {
    if (!sides.src.has(bucket)) return `${bucket} is on versitygw only`;
  }
  return { objects, bytes };
}

async function waitAnswering(
  deps: MigrateBlobStoreDeps,
  docker: (
    args: string[],
    timeout?: number,
  ) => ReturnType<MigrateBlobStoreDeps['exec']>,
  name: string,
): Promise<void> {
  for (let waited = 0; waited <= START_TIMEOUT_MS; waited += POLL_MS) {
    const answered = await docker([
      'exec',
      name,
      'wget',
      '-q',
      '-O',
      '/dev/null',
      'http://127.0.0.1:9000/_health',
    ]);
    if (answered.success) return;
    const running = await docker([
      'inspect',
      '--format',
      '{{.State.Running}}',
      name,
    ]);
    if (running.success && running.stdout.trim() === 'false') {
      const logs = await docker(['logs', '--tail', '20', name]);
      throw new MoveRefused(
        `versitygw stopped as it started: ${logs.stdout.trim() || logs.stderr.trim() || 'it said nothing'}`,
      );
    }
    await deps.sleep(POLL_MS);
  }
  throw new MoveRefused(
    `versitygw did not answer its health path within ${START_TIMEOUT_MS / 1000} s`,
  );
}

/** Delete what the move wrote into `volume`, which held nothing before it. */
async function emptyVolume(
  deps: MigrateBlobStoreDeps,
  docker: (
    args: string[],
    timeout?: number,
  ) => ReturnType<MigrateBlobStoreDeps['exec']>,
  volume: string,
): Promise<void> {
  const emptied = await docker(
    [
      'run',
      '--rm',
      '-v',
      `${volume}:/data`,
      BACKUP_HELPER_IMAGE,
      'sh',
      '-c',
      'find /data -mindepth 1 -delete',
    ],
    archiveTimeoutSeconds(LEGACY_BLOB_VOLUME),
  );
  if (!emptied.success) {
    // Left with content, the volume would be taken for the live store at the
    // next deploy, beside a database that knows MinIO's blobs.
    deps.logger.warn(
      `Could not empty ${volume} after the move stopped (${emptied.stderr.trim() || emptied.stdout.trim()}). Empty it before the next deploy: docker run --rm -v ${volume}:/data ${BACKUP_HELPER_IMAGE} sh -c 'find /data -mindepth 1 -delete'`,
    );
  }
}
