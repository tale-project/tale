import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, mkdir, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { preconditionError } from '../../../../utils/fail';
import { stableJson } from '../../../config/releases/identity';

/**
 * Keyed digests of what the Incus runtime plans and applies (design D-11).
 *
 * A plan, an instance label (`user.tale.config`) and a readback carry
 * HMAC-SHA256 digests under a per-stack key instead of plain hashes: they
 * still show that a value changed, a secret included, but a reader without
 * the key cannot test a guess of a low-entropy secret against them.
 *
 * The key lives in `<state>/.tale/incus/plan.key`: 32 random bytes as hex, a
 * 0600 file in a 0700 directory, made once and never rewritten. Losing it
 * only makes every digest look changed once (the next plan replaces nothing
 * on its own: a replaced digest is compared, not trusted).
 */

/** The directory of the Incus runtime's own state under a state root (a
 * workspace or a managed deployment's state directory). */
export function incusStateDirectory(stateRoot: string): string {
  return join(resolve(stateRoot), '.tale', 'incus');
}

export const PLAN_KEY_FILE = 'plan.key';
const KEY_BYTES = 32;
const KEY_PATTERN = /^[0-9a-f]{64}$/;
/** Domain tags: a JSON value and raw bytes never share a digest. */
const JSON_TAG = 'tale-incus-json\0';
const BYTES_TAG = 'tale-incus-bytes\0';

/** The per-stack digest key. It never serializes: a plan, a log line or a
 * receipt that carries the object shows a placeholder, not the key. */
export class PlanKey {
  readonly #bytes: Buffer;

  constructor(bytes: Uint8Array) {
    if (bytes.byteLength !== KEY_BYTES)
      throw new Error(`A plan key is ${KEY_BYTES} bytes.`);
    this.#bytes = Buffer.from(bytes);
  }

  /** The digest of a JSON value, independent of its key order. */
  digest(value: unknown): string {
    return createHmac('sha256', this.#bytes)
      .update(JSON_TAG)
      .update(stableJson(value))
      .digest('hex');
  }

  /** The digest of raw bytes (a file's content). */
  digestBytes(bytes: Uint8Array): string {
    return createHmac('sha256', this.#bytes)
      .update(BYTES_TAG)
      .update(bytes)
      .digest('hex');
  }

  toJSON(): string {
    return '[plan key]';
  }

  toString(): string {
    return '[plan key]';
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

async function readKey(file: string): Promise<PlanKey> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (errorCode(error) === 'ELOOP')
      throw preconditionError(
        `${file} is a symbolic link; the plan key must be a regular file.`,
      );
    throw error;
  }
  try {
    const info = await handle.stat();
    const uid = process.getuid?.();
    if (
      !info.isFile() ||
      (info.mode & 0o077) !== 0 ||
      (uid !== undefined && info.uid !== uid)
    )
      throw preconditionError(
        `${file} must be a regular file of this user with mode 0600.`,
        `chmod 600 ${file}`,
      );
    if (info.size > 128) throw preconditionError(`${file} is not a plan key.`);
    const text = (await handle.readFile('utf8')).trim();
    if (!KEY_PATTERN.test(text))
      throw preconditionError(
        `${file} is not a plan key (64 hexadecimal characters).`,
        `Move it aside; the next run makes a new one and plans every instance as changed once.`,
      );
    return new PlanKey(Buffer.from(text, 'hex'));
  } finally {
    await handle.close();
  }
}

/**
 * The stack's plan key, made on first use. A new key is written to a
 * temporary file and linked into place, so two runs that race make one key
 * and a crash never leaves a short one.
 */
export async function loadPlanKey(stateRoot: string): Promise<PlanKey> {
  const directory = incusStateDirectory(stateRoot);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, PLAN_KEY_FILE);
  try {
    return await readKey(file);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  const temporary = `${file}.tmp.${randomUUID()}`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${randomBytes(KEY_BYTES).toString('hex')}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, file);
  } catch (error) {
    // Another run made the key first: read theirs.
    if (errorCode(error) !== 'EEXIST') throw error;
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      console.warn(
        `Could not remove ${temporary}:`,
        error instanceof Error ? error.message : error,
      );
    });
  }
  return readKey(file);
}
