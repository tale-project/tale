import { randomBytes } from 'node:crypto';

import type { IncusInstance } from '@tale/incus/api';
import type { IncusClient } from '@tale/incus/client';
import {
  EXEC_PAYLOAD_DIRECTORY,
  EXEC_PAYLOAD_PREFIX,
  MAX_EXEC_PAYLOAD_BYTES,
  execCommandLine,
  execForCode,
  execWithOutput,
} from '@tale/incus/exec';
import { execOverWebSocket, openExecSession } from '@tale/incus/exec-session';
import { deleteFile, writeFile } from '@tale/incus/files';

import type { ExecOptions, ExecResult, RuntimeSession } from '../../types';
import { forgetPayload, readJournal, recordPayload } from '../apply/journal';
import { cachedImageFacts } from './image-facts-cache';

/**
 * Exec on Incus (design D-03, D-34, 11; R3-06, R3-14, R3-30).
 *
 * A command runs one of three ways:
 * - mode 1, the exit code alone, and mode 2, the code and its output through
 *   `record-output` — both under the image's own `timeout`, because Incus
 *   cannot cancel a record-output exec (its operation refuses a DELETE);
 * - a websocket exec, which ends when its control socket closes.
 *
 * Modes 1-2 run only where the image facts (TI-11, by the instance's image
 * digest) name a `timeout`; an image without one, or whose facts were never
 * read, runs every exec over the websocket. A stdin of up to 1 MiB in mode 2
 * is pushed as a 0600 file in `/dev/shm`, owned by the exec's user, journaled
 * before the push, and removed by the command itself before it reads it; a
 * larger stdin goes over the websocket, which writes nothing to the
 * instance. In `db`, `/dev/shm` is Postgres's dynamic shared memory, so a
 * stdin for `db` always goes over the websocket, and the payloads a crash left
 * in an instance are reaped before the next exec there.
 *
 * Every exec has a deadline (the caller's `timeoutS`, 600 s by default) and a
 * byte cap on its output (16 MiB by default), the bounded-output rule of
 * `lib/docker/bounded-output.ts`: past either, the exec fails ("Command
 * exceeded its time limit." / "… its byte limit."), on every path.
 */

export interface IncusVerbContext {
  client: IncusClient;
  /** `user.tale.stack` of the instances the verbs act on. */
  stack: string;
  /** Where `.tale/incus/` lives (journal, image facts). */
  stateRoot: string;
}

export const DEFAULT_EXEC_TIMEOUT_S = 600;
const DEFAULT_EXEC_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
/** The service whose `/dev/shm` is Postgres's (design R3-30). */
const SHARED_MEMORY_SERVICE = 'db';

export type ExecMode = 'code' | 'record-output' | 'websocket';

export interface IncusExecOptions extends ExecOptions {
  /** `discard`: the exit code is all the caller reads (mode 1). */
  output?: 'record' | 'discard';
  /** Run as this uid and gid; the instance's `oci.uid`/`oci.gid` by
   * default. */
  user?: { uid: number; gid: number };
}

/** How one exec runs, and where its stdin goes. */
export function chooseExecMode(input: {
  timeoutCommand: string | null;
  stdinBytes: number | null;
  service: string | undefined;
  output: 'record' | 'discard';
}): { mode: ExecMode; stdin: 'file' | 'websocket' | null } {
  const stdin = input.stdinBytes;
  if (
    input.timeoutCommand === null ||
    (stdin !== null &&
      (stdin > MAX_EXEC_PAYLOAD_BYTES ||
        input.service === SHARED_MEMORY_SERVICE))
  )
    return { mode: 'websocket', stdin: stdin === null ? null : 'websocket' };
  return {
    mode: input.output === 'discard' ? 'code' : 'record-output',
    stdin: stdin === null ? null : 'file',
  };
}

function failed(stderr: string, exitCode = 1): ExecResult {
  return { success: false, stdout: '', stderr, exitCode };
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim();
}

function positiveInteger(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`Not ${what}: ${value}`);
  return value;
}

/** The uid and gid an exec runs as: the caller's, else the instance's
 * declared `oci.uid`/`oci.gid`, else Incus's default. */
function execIdentity(
  instance: IncusInstance,
  user: IncusExecOptions['user'],
): { uid: number; gid: number } | undefined {
  if (user !== undefined) return user;
  const uid = Number(instance.config['oci.uid'] ?? 'x');
  if (!Number.isSafeInteger(uid) || uid < 0) return undefined;
  const gid = Number(instance.config['oci.gid'] ?? String(uid));
  return { uid, gid: Number.isSafeInteger(gid) && gid >= 0 ? gid : uid };
}

/** The image's `timeout`, from the cached facts of the instance's image;
 * null when it has none or its facts were never read. */
async function timeoutCommandOf(
  context: IncusVerbContext,
  instance: IncusInstance,
): Promise<string | null> {
  const digest = instance.config['user.tale.image'];
  if (digest === undefined || digest === '') return null;
  return (await cachedImageFacts(context.stateRoot, digest))?.timeout ?? null;
}

/**
 * The stdin files this process pushed whose exec has not ended yet, as
 * `<instance>:<path>`: a reap in a parallel exec in the same instance (a
 * health probe beside a control call) spares them, or it would delete a file
 * before its command read it.
 */
const payloadsInFlight = new Set<string>();

/**
 * Delete the stdin files the journal lists for `instance` (every instance
 * when absent): a crash between the push and the command left them. One whose
 * instance is gone is forgotten; one an exec of this process still runs with
 * is left alone.
 */
export async function reapPayloads(
  context: IncusVerbContext,
  instance?: string,
): Promise<string[]> {
  const journal = await readJournal(context.stateRoot);
  if (journal === null || journal.stack !== context.stack) return [];
  const reaped: string[] = [];
  for (const payload of journal.payloads) {
    if (instance !== undefined && payload.instance !== instance) continue;
    if (payloadsInFlight.has(`${payload.instance}:${payload.path}`)) continue;
    try {
      if (
        await deleteFile(
          context.client,
          { instance: payload.instance },
          payload.path,
        )
      )
        reaped.push(`${payload.instance}:${payload.path}`);
    } catch (error) {
      console.warn(
        `The stdin file ${payload.path} in ${payload.instance} could not be removed; the next exec there tries again:`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }
    await forgetPayload(context.stateRoot, context.stack, payload);
  }
  return reaped;
}

/** Push `stdin` as the exec's 0600 file, journaled first. */
async function pushPayload(
  context: IncusVerbContext,
  instance: string,
  bytes: Uint8Array,
  owner: { uid: number; gid: number },
): Promise<string> {
  const path = `${EXEC_PAYLOAD_DIRECTORY}/${EXEC_PAYLOAD_PREFIX}${randomBytes(16).toString('hex')}`;
  payloadsInFlight.add(`${instance}:${path}`);
  try {
    await recordPayload(context.stateRoot, context.stack, { instance, path });
    await writeFile(context.client, { instance }, path, bytes, {
      ...owner,
      mode: '0600',
    });
  } catch (error) {
    // Journaled or not, the next exec there reaps what a failed push left.
    payloadsInFlight.delete(`${instance}:${path}`);
    throw error;
  }
  return path;
}

/** Remove a stdin file the command did not (it removes its own first),
 * then forget it. A failure leaves it journaled for the reaper. */
async function dropPayload(
  context: IncusVerbContext,
  instance: string,
  path: string,
): Promise<void> {
  try {
    await deleteFile(context.client, { instance }, path);
  } catch (error) {
    console.warn(
      `The stdin file ${path} in ${instance} could not be removed; the next exec there reaps it:`,
      error instanceof Error ? error.message : error,
    );
    return;
  }
  await forgetPayload(context.stateRoot, context.stack, { instance, path });
}

/** The exit codes `timeout` ends a command with: coreutils' 124, and
 * busybox's 128 + the signal (SIGTERM 143; SIGKILL 137 after `-k`). */
const TIMEOUT_EXITS = new Set([124, 137, 143]);

/**
 * A command the image's `timeout` ended at the exec's deadline fails as the
 * websocket path and Docker's bounded exec fail: with "exceeded its time
 * limit", whatever `timeout` exits with (busybox 143, coreutils 124). An
 * earlier exit with one of those codes is the command's own and stands.
 */
function assertWithinDeadline(
  exitCode: number,
  started: number,
  timeoutSeconds: number,
): void {
  if (
    TIMEOUT_EXITS.has(exitCode) &&
    Date.now() - started >= timeoutSeconds * 1000
  )
    throw new Error('Command exceeded its time limit.');
}

/** Run one command in a running instance of the stack. */
export async function execInInstance(
  context: IncusVerbContext,
  name: string,
  argv: readonly string[],
  options: IncusExecOptions = {},
): Promise<ExecResult> {
  if (argv.length === 0) throw new Error('An exec needs a command');
  const timeoutSeconds = positiveInteger(
    Math.ceil(options.timeoutS ?? DEFAULT_EXEC_TIMEOUT_S),
    'an exec timeout',
  );
  const maxOutputBytes = positiveInteger(
    options.maxOutputBytes ?? DEFAULT_EXEC_MAX_OUTPUT_BYTES,
    'an exec byte cap',
  );
  const read = await context.client.getInstance(name);
  if (read === undefined) return failed(`There is no instance ${name}.`);
  const instance = read.instance;
  if (instance.status !== 'Running')
    return failed(`${name} is not running (${instance.status}).`);
  await reapPayloads(context, name);

  const stdin =
    options.stdin === undefined
      ? null
      : new TextEncoder().encode(options.stdin);
  const timeoutCommand = await timeoutCommandOf(context, instance);
  const { mode, stdin: stdinVia } = chooseExecMode({
    timeoutCommand,
    stdinBytes: stdin?.byteLength ?? null,
    service: instance.config['user.tale.service'],
    output: options.output ?? 'record',
  });
  const identity = execIdentity(instance, options.user);
  const asUser =
    identity === undefined ? {} : { user: identity.uid, group: identity.gid };

  if (mode === 'websocket') {
    const output = await execOverWebSocket(context.client, name, argv, {
      ...asUser,
      ...(stdin === null ? {} : { stdin }),
      maxOutputBytes,
      deadlineMs: timeoutSeconds * 1000,
    });
    return {
      success: output.exitCode === 0,
      stdout: text(output.stdout),
      stderr: text(output.stderr),
      exitCode: output.exitCode,
    };
  }

  let payloadPath: string | undefined;
  try {
    if (stdin !== null && stdinVia === 'file')
      payloadPath = await pushPayload(
        context,
        name,
        stdin,
        identity ?? { uid: 0, gid: 0 },
      );
    const line = execCommandLine(argv, {
      timeoutCommand: timeoutCommand ?? undefined,
      timeoutSeconds,
      ...(payloadPath === undefined ? {} : { payloadPath }),
    });
    const started = Date.now();
    if (mode === 'code') {
      const exitCode = await execForCode(context.client, name, line, {
        ...asUser,
        timeoutSeconds,
      });
      assertWithinDeadline(exitCode, started, timeoutSeconds);
      return { success: exitCode === 0, stdout: '', stderr: '', exitCode };
    }
    const output = await execWithOutput(context.client, name, line, {
      ...asUser,
      timeoutSeconds,
      maxOutputBytes,
    });
    assertWithinDeadline(output.exitCode, started, timeoutSeconds);
    return {
      success: output.exitCode === 0,
      stdout: text(output.stdout),
      stderr: text(output.stderr),
      exitCode: output.exitCode,
    };
  } finally {
    if (payloadPath !== undefined) {
      await dropPayload(context, name, payloadPath);
      payloadsInFlight.delete(`${name}:${payloadPath}`);
    }
  }
}

/**
 * A command held open over a websocket exec (design D-03: the automation's
 * psql session), shaped as the child process Docker's `docker exec -i` is.
 * `kill` closes the control socket, which ends the command.
 */
export async function execSessionInInstance(
  context: IncusVerbContext,
  name: string,
  argv: readonly string[],
  options: { user?: { uid: number; gid: number } } = {},
): Promise<RuntimeSession> {
  const read = await context.client.getInstance(name);
  if (read === undefined) throw new Error(`There is no instance ${name}.`);
  if (read.instance.status !== 'Running')
    throw new Error(`${name} is not running (${read.instance.status}).`);
  const identity = execIdentity(read.instance, options.user);
  const controllers: Array<ReadableStreamDefaultController<Uint8Array>> = [];
  let closed = false;
  const stream = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controllers.push(controller);
      },
    });
  const stdout = stream();
  const stderr = stream();
  const [out, err] = controllers;
  const closeStreams = () => {
    if (closed) return;
    closed = true;
    for (const controller of controllers) controller.close();
  };
  const session = await openExecSession(context.client, name, argv, {
    ...(identity === undefined
      ? {}
      : { user: identity.uid, group: identity.gid }),
    onOutput(fd, chunk) {
      if (closed) return;
      (fd === 1 ? out : err)?.enqueue(chunk.slice());
    },
  });
  let exitCode: number | null = null;
  const exited = session.exit.then(
    (code) => {
      exitCode = code;
      closeStreams();
      return code;
    },
    (error: unknown) => {
      console.warn(
        `The exec session in ${name} ended without an exit code:`,
        error instanceof Error ? error.message : error,
      );
      exitCode = -1;
      closeStreams();
      return -1;
    },
  );
  return {
    stdin: {
      write(chunk) {
        session.write(chunk);
        return typeof chunk === 'string'
          ? Buffer.byteLength(chunk)
          : chunk.byteLength;
      },
      flush: () => 0,
      end: () => session.closeStdin(),
    },
    stdout,
    stderr,
    exited,
    get exitCode() {
      return exitCode;
    },
    kill: () => session.close(),
  };
}
