// Exec without websockets: mode 1 (the exit code alone) and mode 2 (the
// code and bounded output through `record-output`). Mode 3, a websocket
// session, is `exec-session.ts`.
//
// What Incus 7.6 does, and what follows from it:
// - A record-output exec cannot be cancelled: `DELETE /1.0/operations/<id>`
//   answers "This operation can't be cancelled". So a command is bounded
//   inside the instance by the image's `timeout`, when the image has one (an
//   image fact the caller reads; this module never assumes it). Without one,
//   the caller uses the websocket session, which ends by closing its control
//   socket. `timeoutSeconds` always bounds how long the client waits.
// - Record-output files accumulate under `logs/exec-output` until deleted, and
//   may hold secrets: each is read, then deleted, whatever happened. Incus
//   names them only when the operation ends, so a command that outlives the
//   client's wait leaves its files behind: bound it with the image's
//   `timeout`, or use the websocket session.
// - stdin is never argv: it is pushed as a 0600 file owned by the exec user
//   (in `/dev/shm`, a tmpfs in every image tried; `/run` is not) and the
//   command's own shell redirects it in and removes it before the command
//   starts. A file is at most 1 MiB; a larger stdin goes over the websocket.

import { IncusApiError, type IncusOperation } from './api.ts';
import type { IncusClient } from './client.ts';
import { deleteFile, writeFile } from './files.ts';

/** Where a pushed stdin file goes, and the prefix a reaper of leaked ones
 * looks for. */
export const EXEC_PAYLOAD_DIRECTORY = '/dev/shm';
export const EXEC_PAYLOAD_PREFIX = 'tale-exec-';
/** The largest stdin pushed as a file. */
export const MAX_EXEC_PAYLOAD_BYTES = 1024 * 1024;
/** The shell script that redirects the payload in, removes it, and runs the
 * command: `$1` is the payload, the rest the command. */
const PAYLOAD_SCRIPT = 'exec 0<"$1" && rm -f -- "$1" && shift && exec "$@"';
const PAYLOAD_ARGV0 = 'tale-exec';
/** How long the client waits beyond the command's own timeout. */
const EXEC_SLACK_MS = 30_000;

/** Who runs a command, where, and with what environment (added to the
 * instance's own `environment.*`). */
export interface ExecIdentity {
  user?: number;
  group?: number;
  cwd?: string;
  environment?: Record<string, string>;
}

export interface ExecOptions extends ExecIdentity {
  /** The command's budget: the client stops waiting after it (plus a
   * slack), and, with `timeoutCommand`, the instance kills it. */
  timeoutSeconds: number;
  /** The image's `timeout` (an image fact), which wraps the command as
   * `timeout <seconds> …`. Absent: nothing in the instance bounds it. */
  timeoutCommand?: string;
  /** The command's stdin, pushed as a 0600 file; at most 1 MiB. */
  stdin?: string | Uint8Array;
  /** The shell that redirects the stdin file in (default `/bin/sh`). */
  shell?: string;
  /** Where the stdin file goes (default `/dev/shm`). */
  payloadDirectory?: string;
}

export interface ExecOutput {
  exitCode: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

/** What a command line built here wraps, read back (the fake runs the
 * command inside). */
export interface UnwrappedExecCommand {
  argv: string[];
  timeoutSeconds?: number;
  payloadPath?: string;
}

/** The argv Incus runs: the command, its stdin file redirected in, all of
 * it under the image's `timeout`. */
export function execCommandLine(
  argv: readonly string[],
  options: {
    timeoutCommand?: string;
    timeoutSeconds?: number;
    payloadPath?: string;
    shell?: string;
  } = {},
): string[] {
  if (argv.length === 0) throw new Error('An exec needs a command');
  let line = [...argv];
  if (options.payloadPath !== undefined) {
    line = [
      options.shell ?? '/bin/sh',
      '-c',
      PAYLOAD_SCRIPT,
      PAYLOAD_ARGV0,
      options.payloadPath,
      ...line,
    ];
  }
  if (options.timeoutCommand !== undefined) {
    const seconds = options.timeoutSeconds ?? 0;
    if (!Number.isInteger(seconds) || seconds < 1) {
      throw new Error(`Not an exec timeout: ${seconds}`);
    }
    line = [options.timeoutCommand, String(seconds), ...line];
  }
  return line;
}

/** Reads back a command line `execCommandLine` built. */
export function unwrapExecCommand(
  line: readonly string[],
): UnwrappedExecCommand {
  let rest = [...line];
  const out: UnwrappedExecCommand = { argv: rest };
  const first = rest[0] ?? '';
  if (
    (first === 'timeout' || first.endsWith('/timeout')) &&
    /^\d+$/.test(rest[1] ?? '')
  ) {
    out.timeoutSeconds = Number(rest[1]);
    rest = rest.slice(2);
  }
  if (
    rest[1] === '-c' &&
    rest[2] === PAYLOAD_SCRIPT &&
    rest[3] === PAYLOAD_ARGV0 &&
    rest[4] !== undefined
  ) {
    out.payloadPath = rest[4];
    rest = rest.slice(5);
  }
  out.argv = rest;
  return out;
}

function payloadName(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${EXEC_PAYLOAD_PREFIX}${Buffer.from(bytes).toString('hex')}`;
}

/** The body of `POST /1.0/instances/<name>/exec`. */
export function buildExecBody(
  command: string[],
  identity: ExecIdentity,
  mode: { recordOutput: boolean; webSocket: boolean },
) {
  return {
    command,
    environment: identity.environment ?? {},
    'wait-for-websocket': mode.webSocket,
    'record-output': mode.recordOutput,
    interactive: false,
    ...(identity.user === undefined ? {} : { user: identity.user }),
    ...(identity.group === undefined ? {} : { group: identity.group }),
    ...(identity.cwd === undefined ? {} : { cwd: identity.cwd }),
  };
}

/** The exec operation's result: its exit code, and the record-output
 * files it left. */
export function execResult(operation: IncusOperation): {
  exitCode: number;
  output: Record<string, string>;
} {
  const metadata = operation.metadata;
  const record =
    metadata !== null && typeof metadata === 'object'
      ? Object.fromEntries(Object.entries(metadata))
      : {};
  const exitCode = record.return;
  if (typeof exitCode !== 'number' || !Number.isInteger(exitCode)) {
    throw new IncusApiError(
      `Incus answered exec operation ${operation.id} without an exit code`,
      502,
    );
  }
  const output: Record<string, string> = {};
  if (record.output !== null && typeof record.output === 'object') {
    for (const [fd, path] of Object.entries(record.output)) {
      if (typeof path === 'string') output[fd] = path;
    }
  }
  return { exitCode, output };
}

async function run(
  client: IncusClient,
  instance: string,
  argv: readonly string[],
  options: ExecOptions,
  recordOutput: boolean,
): Promise<{ exitCode: number; output: Record<string, string> }> {
  if (!Number.isInteger(options.timeoutSeconds) || options.timeoutSeconds < 1) {
    throw new Error(`Not an exec timeout: ${options.timeoutSeconds}`);
  }
  let payloadPath: string | undefined;
  if (options.stdin !== undefined) {
    const bytes =
      typeof options.stdin === 'string'
        ? new TextEncoder().encode(options.stdin)
        : options.stdin;
    if (bytes.byteLength > MAX_EXEC_PAYLOAD_BYTES) {
      throw new Error(
        `An exec stdin of ${bytes.byteLength} bytes is over the ${MAX_EXEC_PAYLOAD_BYTES}-byte file cap: send it over a websocket session`,
      );
    }
    payloadPath = `${options.payloadDirectory ?? EXEC_PAYLOAD_DIRECTORY}/${payloadName()}`;
    await writeFile(client, { instance }, payloadPath, bytes, {
      uid: options.user ?? 0,
      gid: options.group ?? 0,
      mode: '0600',
    });
  }
  const command = execCommandLine(argv, {
    ...(options.timeoutCommand === undefined
      ? {}
      : {
          timeoutCommand: options.timeoutCommand,
          timeoutSeconds: options.timeoutSeconds,
        }),
    ...(payloadPath === undefined ? {} : { payloadPath }),
    ...(options.shell === undefined ? {} : { shell: options.shell }),
  });
  let started = false;
  try {
    const path = `/1.0/instances/${encodeURIComponent(instance)}/exec`;
    const operation = await client.startOperation('POST', path, {
      query: { project: client.project },
      json: buildExecBody(command, options, { recordOutput, webSocket: false }),
    });
    started = true;
    const done = await client.waitOperation(
      operation,
      options.timeoutSeconds * 1000 + EXEC_SLACK_MS,
    );
    return execResult(done);
  } finally {
    // A command that never started never removed its stdin file.
    if (payloadPath !== undefined && !started) {
      await deleteFile(client, { instance }, payloadPath).catch(
        (error: unknown) => {
          console.warn(
            `[incus.exec] the stdin file ${payloadPath} in ${instance} could not be removed:`,
            error instanceof Error ? error.message : error,
          );
        },
      );
    }
  }
}

/** Mode 1: runs the command and returns its exit code; its output goes
 * nowhere. */
export async function execForCode(
  client: IncusClient,
  instance: string,
  argv: readonly string[],
  options: ExecOptions,
): Promise<number> {
  return (await run(client, instance, argv, options, false)).exitCode;
}

/** Mode 2: runs the command with `record-output` and returns its exit code
 * and output. Output over `maxOutputBytes` (stdout and stderr together)
 * throws; the record-output files are deleted either way. */
export async function execWithOutput(
  client: IncusClient,
  instance: string,
  argv: readonly string[],
  options: ExecOptions & { maxOutputBytes: number },
): Promise<ExecOutput> {
  const { exitCode, output } = await run(client, instance, argv, options, true);
  const prefix = `/1.0/instances/${encodeURIComponent(instance)}/logs/exec-output/`;
  const paths = Object.values(output);
  for (const path of paths) {
    const file = path.slice(prefix.length);
    if (!path.startsWith(prefix) || file === '' || file.includes('/')) {
      throw new IncusApiError(
        `Incus named an exec output outside the instance's exec-output logs: ${path}`,
        502,
      );
    }
  }
  try {
    let budget = options.maxOutputBytes;
    const read = async (fd: string): Promise<Uint8Array> => {
      const path = output[fd];
      if (path === undefined) return new Uint8Array();
      let reply;
      try {
        reply = await client.send('GET', path, {
          query: { project: client.project },
          retry: true,
          maxResponseBytes: Math.max(budget, 0),
        });
      } catch (error) {
        if (error instanceof IncusApiError && error.status === 413) {
          throw new Error('Command output exceeded its byte limit.', {
            cause: error,
          });
        }
        throw error;
      }
      budget -= reply.body.byteLength;
      return reply.body;
    };
    const stdout = await read('1');
    const stderr = await read('2');
    return { exitCode, stdout, stderr };
  } finally {
    for (const path of paths) {
      await client
        .sync('DELETE', path, { query: { project: client.project } })
        .catch((error: unknown) => {
          console.warn(
            `[incus.exec] the exec output ${path} could not be deleted:`,
            error instanceof Error ? error.message : error,
          );
        });
    }
  }
}
