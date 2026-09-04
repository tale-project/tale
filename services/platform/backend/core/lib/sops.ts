'use node';

/**
 * Provider-secrets file reader/writer, backed by the `sops` CLI.
 *
 * Format detection is self-describing rather than config-driven: a
 * SOPS-encrypted JSON file always carries a top-level `"sops"` key with
 * recipient/metadata info. Reading checks for that key — present means
 * decrypt via `sops`, absent means the file is already plaintext JSON. This
 * keeps the file format stable across processes that might load env vars
 * differently (the Convex isolate, the `tale` CLI, the Python rag/crawler
 * services all need to agree on how to read the same file on disk).
 *
 * Decrypting still requires `SOPS_AGE_KEY` or `SOPS_AGE_KEY_FILE` in the
 * environment — an encrypted file found with neither configured throws
 * `EncryptedFileWithoutKeyError` rather than silently treating the raw
 * `ENC[…]` ciphertext as a usable value.
 *
 * Reads are cached by file path and invalidated on mtime change. The cache
 * stores the fully-resolved result (decrypted for SOPS files, parsed as-is
 * for plaintext), so toggling env vars between calls can't return a
 * mismatched cached value — the cache key is the file's content, not the
 * current env.
 *
 * The `sops` child process is ALWAYS spawned asynchronously. Both verbs are
 * reached from HTTP handlers (every per-org object-store resolve decrypts on
 * cache expiry; every credential save encrypts), and the backend is one
 * single-threaded event loop: a synchronous spawn would stall every in-flight
 * request for the whole decrypt — up to the timeout when sops hangs. The
 * timeout kills a wedged sops so no request waits on it forever, and
 * concurrent decrypts of one file share a single child process.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveAgeRecipients } from './age_keygen';

interface CacheEntry {
  data: Record<string, unknown>;
  mtimeMs: number;
}

const cache = new Map<string, CacheEntry>();

/** Decrypts in flight, keyed by file path — concurrent callers on a cold
 * cache share one child process instead of each spawning `sops`. */
const inflight = new Map<string, Promise<Record<string, unknown>>>();

let plaintextWarnEmitted = false;

/** Upper bound on one `sops` invocation. Secrets files are a few KB, so a
 * healthy sops answers in well under a second; anything near this bound is
 * a wedged binary (a hung key-file read, a stuck KMS call) and the caller
 * gets an error instead of an indefinitely pending request. */
export const SOPS_TIMEOUT_MS = 10_000;

export interface SopsOptions {
  /** Kill the `sops` child after this many milliseconds (default
   * `SOPS_TIMEOUT_MS`). */
  timeoutMs?: number;
}

export class EncryptedFileWithoutKeyError extends Error {
  constructor(filePath: string) {
    super(
      `Secrets file ${filePath} is SOPS-encrypted but neither SOPS_AGE_KEY ` +
        `nor SOPS_AGE_KEY_FILE is set. Set one in .env to decrypt, or remove ` +
        `the file and re-enter the key in Settings → AI providers to store as plaintext.`,
    );
    this.name = 'EncryptedFileWithoutKeyError';
  }
}

/**
 * True when a SOPS age key is configured. Both `SOPS_AGE_KEY` (inline) and
 * `SOPS_AGE_KEY_FILE` (path) count — sops itself accepts either — and both
 * are trimmed before the check, so `KEY=""` / `KEY="   "` count as unset
 * (mirrors the defensive handling in `secret_box`).
 */
export function hasSopsKey(): boolean {
  return Boolean(
    process.env.SOPS_AGE_KEY?.trim() || process.env.SOPS_AGE_KEY_FILE?.trim(),
  );
}

function isSopsEncryptedShape(parsed: unknown): boolean {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    'sops' in parsed
  );
}

function emitPlaintextWarnOnce(filePath: string): void {
  if (plaintextWarnEmitted) return;
  plaintextWarnEmitted = true;
  console.warn(
    `[secrets] SOPS_AGE_KEY not set — provider secrets at ${filePath} read as ` +
      `plaintext JSON. To enable encryption: run age-keygen, add SOPS_AGE_KEY=… ` +
      `to .env, then re-save secrets via Settings → AI providers.`,
  );
}

/**
 * Drop the cached entry for a file. Call this after any write that changes
 * the file's content — relying on mtime alone isn't safe on filesystems
 * with 1-second mtime resolution, where two writes in quick succession can
 * land on the same timestamp.
 */
export function invalidateSecretsCache(filePath: string): void {
  cache.delete(filePath);
}

/**
 * Run `sops` with `args` off the event loop and resolve with its stdout.
 * Rejects with a legible error on a non-zero exit (stderr attached) and on
 * the timeout (the child is killed, and the error says so rather than
 * surfacing a bare ETIMEDOUT).
 */
function runSops(args: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'sops',
      [...args],
      {
        encoding: 'utf-8',
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        // Secrets files are a few KB; the default 1MB would already do, but a
        // silent truncation on an unusually large file must never happen.
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env },
      },
      (err, stdout, stderr) => {
        if (err === null) {
          resolve(stdout);
          return;
        }
        const detail = stderr.trim().length > 0 ? stderr.trim() : err.message;
        const timedOut =
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- execFile's error carries `killed`/`signal` (Node's ExecFileException)
          (err as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
        reject(
          Object.assign(
            new Error(
              timedOut
                ? `sops ${args[0]} timed out after ${timeoutMs}ms (killed)`
                : `sops ${args[0]} failed: ${detail}`,
            ),
            { cause: err },
          ),
        );
      },
    );
  });
}

/**
 * Encrypt a JSON plaintext string with SOPS, addressed to every configured
 * age recipient — so any key present in `SOPS_AGE_KEY_FILE` can decrypt the
 * result later (the rotation primitive). Resolves with the encrypted
 * SOPS-JSON string; rejects if no age key is configured, or if `sops` itself
 * fails. Callers that want to fall back to plaintext mode must check
 * `hasSopsKey()` themselves before calling this.
 *
 * The plaintext is written to a 0o600 file inside a 0o700 mkdtemp
 * directory, `sops -e` runs against it, and both are removed afterwards.
 * Cleanup failures are logged rather than swallowed — a leftover temp file
 * holds a plaintext secret until the OS reaps it.
 */
export async function encryptJsonWithSops(
  plaintext: string,
  options: SopsOptions = {},
): Promise<string> {
  const recipients = resolveAgeRecipients();
  if (recipients.length === 0) {
    throw new Error(
      'No age secret key available. Set SOPS_AGE_KEY (inline) or ' +
        'SOPS_AGE_KEY_FILE (path) in .env, or unset both to use plaintext mode.',
    );
  }
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'sops-'));
  const tmpFile = path.join(tmpDir, 'plain.json');
  try {
    await writeFile(tmpFile, plaintext, { encoding: 'utf-8', mode: 0o600 });
    return await runSops(
      [
        '-e',
        '--input-type',
        'json',
        '--output-type',
        'json',
        '--age',
        recipients.join(','),
        tmpFile,
      ],
      options.timeoutMs ?? SOPS_TIMEOUT_MS,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw Object.assign(
      new Error(
        `Failed to encrypt secrets with SOPS: ${message}. ` +
          'Ensure sops is installed and SOPS_AGE_KEY / SOPS_AGE_KEY_FILE is set.',
      ),
      { cause: err },
    );
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(
        `[sops] failed to remove temp plaintext dir ${tmpDir}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

export async function decryptSecretsFile(
  filePath: string,
  options: SopsOptions = {},
): Promise<Record<string, unknown>> {
  const fileStat = await stat(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === fileStat.mtimeMs) {
    return cached.data;
  }
  const pending = inflight.get(filePath);
  if (pending) return pending;
  const load = loadSecretsFile(filePath, fileStat.mtimeMs, options).finally(
    () => {
      inflight.delete(filePath);
    },
  );
  inflight.set(filePath, load);
  return load;
}

async function loadSecretsFile(
  filePath: string,
  mtimeMs: number,
  options: SopsOptions,
): Promise<Record<string, unknown>> {
  const raw = await readFile(filePath, 'utf-8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw Object.assign(
      new Error(
        `Failed to parse secrets file ${filePath} as JSON: ${message}.`,
      ),
      { cause: err },
    );
  }

  let data: Record<string, unknown>;
  if (isSopsEncryptedShape(parsed)) {
    if (!hasSopsKey()) {
      throw new EncryptedFileWithoutKeyError(filePath);
    }
    let stdout: string;
    try {
      stdout = await runSops(
        ['-d', '--output-type', 'json', filePath],
        options.timeoutMs ?? SOPS_TIMEOUT_MS,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw Object.assign(
        new Error(
          `Failed to decrypt secrets file ${filePath}: ${message}. ` +
            'Ensure sops is installed and SOPS_AGE_KEY or SOPS_AGE_KEY_FILE is set correctly.',
        ),
        { cause: err },
      );
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse returns unknown; providerSecretsSchema validates the shape downstream
    data = JSON.parse(stdout) as Record<string, unknown>;
  } else {
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error(
        `Secrets file ${filePath} must contain a JSON object at the top level.`,
      );
    }
    emitPlaintextWarnOnce(filePath);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the typeof/Array checks above rule out null/array; providerSecretsSchema validates the shape downstream
    data = parsed as Record<string, unknown>;
  }

  cache.set(filePath, { data, mtimeMs });
  return data;
}
