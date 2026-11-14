import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { formatBytes } from '../../utils/format-bytes';
import * as logger from '../../utils/logger';
import { snapshotStoreOf } from '../runtime/incus/verbs/snapshots';
import type { StackRuntime } from '../runtime/types';
import {
  BACKUP_VOLUME,
  isValidSnapshotId,
  RESTORABLE_ARCHIVES,
} from './constants';
import { archiveNativeSnapshot } from './create-snapshot';
import { listSnapshots } from './list-snapshots';
import { checkManifest, hasArchive, type SnapshotManifest } from './manifest';
import { verifySnapshot } from './verify-snapshot';

/**
 * `tale backup export <id>` and `tale backup import <file>`: a snapshot as
 * one portable file, the way it leaves a host and arrives on another, on
 * either runtime (design 10, 14).
 *
 * The file is a plain POSIX tar (ustar; a size past 8 GiB in GNU's base-256
 * form) of `<id>/manifest.json` first, then each volume's archive
 * `<id>/<volume>.tar.gz` — today's archive format, byte for byte. Native
 * snapshots never leave the host: an export of an Incus set first writes the
 * archives it lacks (from copies of its snapshots), and the exported
 * manifest carries the archives alone. The archives stream through the CLI
 * (Docker: a helper `cat`; Incus: the volume file API in pieces) and each is
 * checked against the manifest's sha256 as it passes, on the way out and on
 * arrival; the imported manifest is written last, so an interrupted import
 * is never listed.
 */

const BLOCK = 512;
const MANIFEST_MAX_BYTES = 1024 * 1024;
/** The largest size ustar's octal field holds; past it, GNU base-256. */
const OCTAL_SIZE_MAX = 0o77777777777;

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

/** One ustar header for a regular file `name` of `size` bytes. */
export function tarHeader(
  name: string,
  size: number,
  mtime: number,
): Uint8Array {
  if (Buffer.byteLength(name) > 100)
    throw new Error(`A tar entry name is longer than 100 bytes: ${name}`);
  const header = Buffer.alloc(BLOCK, 0);
  header.write(name, 0, 100, 'utf8');
  header.write(octal(0o600, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii');
  header.write(octal(0, 8), 116, 8, 'ascii');
  if (size <= OCTAL_SIZE_MAX) header.write(octal(size, 12), 124, 12, 'ascii');
  else {
    header[124] = 0x80;
    let rest = BigInt(size);
    for (let index = 135; index > 124; index -= 1) {
      header[index] = Number(rest & 0xffn);
      rest >>= 8n;
    }
  }
  header.write(octal(Math.floor(mtime / 1000), 12), 136, 12, 'ascii');
  header.fill(' ', 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

/** The name and size a ustar header holds; null for the end-of-archive
 * block. A header whose checksum is wrong is refused. */
export function readTarHeader(
  header: Uint8Array,
): { name: string; size: number; type: string } | null {
  if (header.every((byte) => byte === 0)) return null;
  const buffer = Buffer.from(header);
  const field = (start: number, length: number) =>
    buffer
      .toString('ascii', start, start + length)
      .replace(/\0.*$/s, '')
      .trim();
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1)
    sum += index >= 148 && index < 156 ? 32 : (buffer[index] ?? 0);
  if (Number.parseInt(field(148, 8), 8) !== sum)
    throw new Error(
      'The file is not a snapshot export: a tar header checksum is wrong.',
    );
  let size: number;
  if (((buffer[124] ?? 0) & 0x80) !== 0) {
    let value = 0n;
    for (let index = 125; index < 136; index += 1)
      value = (value << 8n) | BigInt(buffer[index] ?? 0);
    size = Number(value);
  } else size = Number.parseInt(field(124, 12) || '0', 8);
  if (!Number.isSafeInteger(size) || size < 0)
    throw new Error(
      'The file is not a snapshot export: a tar entry has no size.',
    );
  return {
    name: buffer.toString('utf8', 0, 100).replace(/\0.*$/s, ''),
    size,
    type: field(156, 1) || '0',
  };
}

function padding(size: number): number {
  return (BLOCK - (size % BLOCK)) % BLOCK;
}

/** Exact reads over a byte stream. */
class ByteReader {
  private buffer = new Uint8Array(0);
  private done = false;
  private readonly source: AsyncIterator<Uint8Array>;

  constructor(stream: AsyncIterable<Uint8Array>) {
    this.source = stream[Symbol.asyncIterator]();
  }

  private async fill(bytes: number): Promise<void> {
    while (this.buffer.byteLength < bytes && !this.done) {
      const next = await this.source.next();
      if (next.done === true) this.done = true;
      else this.buffer = Buffer.concat([this.buffer, next.value]);
    }
  }

  async read(bytes: number): Promise<Uint8Array> {
    await this.fill(bytes);
    if (this.buffer.byteLength < bytes)
      throw new Error('The snapshot export ends early: the file is truncated.');
    const out = this.buffer.slice(0, bytes);
    this.buffer = this.buffer.slice(bytes);
    return out;
  }

  /** `bytes` bytes, in the pieces the stream has them. */
  async *pieces(bytes: number): AsyncGenerator<Uint8Array> {
    let left = bytes;
    while (left > 0) {
      await this.fill(1);
      if (this.buffer.byteLength === 0)
        throw new Error(
          'The snapshot export ends early: the file is truncated.',
        );
      const take = Math.min(left, this.buffer.byteLength, 4 * 1024 * 1024);
      const out = this.buffer.slice(0, take);
      this.buffer = this.buffer.slice(take);
      left -= take;
      yield out;
    }
  }

  async cancel(): Promise<void> {
    await this.source.return?.();
  }
}

/** The manifest as it travels: archives only, no native snapshot. */
function portableManifest(manifest: SnapshotManifest): SnapshotManifest {
  const volumes: SnapshotManifest['volumes'] = {};
  for (const [volume, info] of Object.entries(manifest.volumes)) {
    if (!(RESTORABLE_ARCHIVES as readonly string[]).includes(volume)) continue;
    if (!hasArchive(info))
      throw new Error(
        `Volume ${volume} of snapshot ${manifest.id} has no archive to export.`,
      );
    volumes[volume] = { sha256: info.sha256, sizeBytes: info.sizeBytes };
  }
  const { freeze: _freeze, ...rest } = manifest;
  return { ...rest, volumes };
}

/**
 * Write snapshot `id` as one file (`to`, or `tale-snapshot-<id>.tar` in the
 * working directory). A file that exists is never overwritten. Returns its
 * path.
 */
export async function exportSnapshot(options: {
  runtime: StackRuntime;
  prefix: string;
  id: string;
  to?: string;
}): Promise<string> {
  const { runtime, prefix, id } = options;
  if (!isValidSnapshotId(id))
    throw new Error(
      `Invalid snapshot id "${id}" — run \`tale restore\` to list snapshots.`,
    );
  const found = (await listSnapshots(prefix, runtime)).find(
    (manifest) => manifest.id === id,
  );
  if (found === undefined)
    throw new Error(
      `Snapshot ${id} not found — run \`tale restore\` to list snapshots.`,
    );
  const out = options.to ?? join(process.cwd(), `tale-snapshot-${id}.tar`);
  if (existsSync(out))
    throw new Error(`${out} exists; the export never overwrites a file.`);

  // Native snapshots stay on the host: the archives travel.
  const manifest =
    snapshotStoreOf(runtime) === null
      ? found
      : await archiveNativeSnapshot(runtime, found);
  const portable = portableManifest(manifest);
  const partial = join(
    dirname(out),
    `.${basename(out)}.partial-${randomBytes(4).toString('hex')}`,
  );
  const handle = await open(partial, 'wx', 0o600);
  const now = Date.now();
  try {
    const write = async (bytes: Uint8Array) => {
      await handle.write(bytes);
    };
    const manifestText = Buffer.from(`${JSON.stringify(portable)}\n`);
    await write(tarHeader(`${id}/manifest.json`, manifestText.byteLength, now));
    await write(manifestText);
    await write(Buffer.alloc(padding(manifestText.byteLength)));
    let total = 0;
    for (const [volume, info] of Object.entries(portable.volumes)) {
      const size = info.sizeBytes ?? 0;
      logger.step(`Exporting ${volume}.tar.gz (${formatBytes(size)})...`);
      await write(tarHeader(`${id}/${volume}.tar.gz`, size, now));
      const hash = createHash('sha256');
      let count = 0;
      await runtime.readVolumeFile(
        `${prefix}${BACKUP_VOLUME}`,
        `${id}/${volume}.tar.gz`,
        async (chunk) => {
          count += chunk.byteLength;
          if (count > size)
            throw new Error(
              `${volume}.tar.gz is larger than its manifest says (${size} bytes).`,
            );
          hash.update(chunk);
          await write(chunk);
        },
      );
      const sha256 = hash.digest('hex');
      if (count !== size || sha256 !== info.sha256)
        throw new Error(
          `${volume}.tar.gz of snapshot ${id} does not match its manifest (${count} bytes, sha256 ${sha256}); nothing was exported.`,
        );
      await write(Buffer.alloc(padding(size)));
      total += size;
    }
    await write(Buffer.alloc(BLOCK * 2));
    await handle.sync();
    await handle.close();
    await rename(partial, out);
    logger.success(`Exported snapshot ${id} to ${out} (${formatBytes(total)})`);
    return out;
  } catch (error) {
    await handle.close().catch((closeError: unknown) => {
      logger.debug(`Closing ${partial}: ${String(closeError)}`);
    });
    await unlink(partial).catch((unlinkError: unknown) => {
      logger.warn(
        `Could not remove the partial export ${partial}: ${String(unlinkError)}`,
      );
    });
    throw error;
  }
}

/**
 * Read a snapshot export into this host's `backups`: the archives first,
 * each checked against the manifest's sha256 on arrival, then the manifest,
 * then a full verification. A snapshot id the host already has is refused.
 * Returns the imported manifest.
 */
export async function importSnapshot(options: {
  runtime: StackRuntime;
  prefix: string;
  file: string;
}): Promise<SnapshotManifest> {
  const { runtime, prefix, file } = options;
  const store = snapshotStoreOf(runtime);
  const backups = `${prefix}${BACKUP_VOLUME}`;
  if (store === null) {
    if (!(await runtime.ensureVolumes([BACKUP_VOLUME], prefix)))
      throw new Error(`Failed to create the backup volume ${backups}`);
  } else if (!(await runtime.volumeExists(BACKUP_VOLUME)))
    throw new Error(
      `The stack has no ${BACKUP_VOLUME} volume to import into; deploy it once first.`,
    );

  const reader = new ByteReader(Bun.file(file).stream());
  try {
    const first = readTarHeader(await reader.read(BLOCK));
    const id = first?.name.split('/')[0] ?? '';
    if (
      first === null ||
      first.type !== '0' ||
      !isValidSnapshotId(id) ||
      first.name !== `${id}/manifest.json` ||
      first.size > MANIFEST_MAX_BYTES
    )
      throw new Error(
        `${file} is not a snapshot export: it does not start with <id>/manifest.json.`,
      );
    const text = Buffer.from(await reader.read(first.size)).toString('utf8');
    await reader.read(padding(first.size));
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`The manifest in ${file} is not JSON: ${String(error)}`, {
        cause: error,
      });
    }
    const checked = checkManifest(parsed);
    if ('problem' in checked)
      throw new Error(
        `The manifest in ${file} is not one this CLI reads: ${checked.problem}`,
      );
    const manifest = portableManifest(checked.manifest);
    if (manifest.id !== id)
      throw new Error(
        `The manifest in ${file} names snapshot ${manifest.id}, not ${id}.`,
      );
    if ((await listSnapshots(prefix, runtime)).some((known) => known.id === id))
      throw new Error(
        `Snapshot ${id} is already in ${backups}; nothing was imported.`,
      );

    const arrived = new Set<string>();
    for (;;) {
      const header = readTarHeader(await reader.read(BLOCK));
      if (header === null) break;
      const match = new RegExp(`^${id}/([A-Za-z0-9._-]+)\\.tar\\.gz$`).exec(
        header.name,
      );
      const volume = match?.[1];
      const info = volume === undefined ? undefined : manifest.volumes[volume];
      if (
        header.type !== '0' ||
        volume === undefined ||
        info === undefined ||
        arrived.has(volume)
      )
        throw new Error(
          `${file} holds ${header.name}, which its manifest does not list.`,
        );
      if (header.size !== info.sizeBytes)
        throw new Error(
          `${volume}.tar.gz is ${header.size} bytes in ${file}, and its manifest says ${info.sizeBytes}.`,
        );
      logger.step(
        `Importing ${volume}.tar.gz (${formatBytes(header.size)})...`,
      );
      const hash = createHash('sha256');
      const pieces = reader.pieces(header.size);
      async function* hashed(): AsyncGenerator<Uint8Array> {
        for await (const piece of pieces) {
          hash.update(piece);
          yield piece;
        }
      }
      await runtime.writeVolumeFile(
        backups,
        `${id}/${volume}.tar.gz`,
        hashed(),
      );
      const sha256 = hash.digest('hex');
      if (sha256 !== info.sha256)
        throw new Error(
          `${volume}.tar.gz arrived with sha256 ${sha256}, and its manifest says ${info.sha256}; the snapshot was not imported.`,
        );
      await runtime.writeVolumeFile(
        backups,
        `${id}/${volume}.tar.gz.sha256`,
        (async function* () {
          yield Buffer.from(`${sha256}  ${volume}.tar.gz\n`);
        })(),
      );
      await reader.read(padding(header.size));
      arrived.add(volume);
    }
    const missing = Object.keys(manifest.volumes).filter(
      (volume) => !arrived.has(volume),
    );
    if (missing.length > 0)
      throw new Error(
        `${file} lacks the archives of ${missing.join(', ')}; the snapshot was not imported.`,
      );

    // The manifest last: before it, nothing lists the snapshot.
    if (store !== null) await store.writeManifest(manifest);
    else
      await runtime.writeVolumeFile(
        backups,
        `${id}/manifest.json`,
        (async function* () {
          yield Buffer.from(JSON.stringify(manifest));
        })(),
      );
    await verifySnapshot(prefix, manifest, runtime);
    logger.success(`Imported snapshot ${id} into ${backups}`);
    return manifest;
  } finally {
    await reader.cancel().catch((error: unknown) => {
      logger.debug(`Closing ${file}: ${String(error)}`);
    });
  }
}
