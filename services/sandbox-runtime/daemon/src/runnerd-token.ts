// runnerd's token: it authenticates the spawner's calls (main.ts) and keys the
// staged-files manifest (staged-manifest.ts), so no process runnerd starts may
// learn it. Every exec runs at runnerd's own uid, and a process may read the
// /proc entries of any dumpable process of its uid: its environment (the one
// it was started with, whatever it unset since), its memory and its open
// descriptors. So the token is never in runnerd's environment. The entrypoint
// moves it onto a descriptor that TALE_RUNNERD_TOKEN_FD names (with Docker in
// the session, the root supervisor takes it and hands it on the same way,
// lazy-docker.ts), and runnerd first makes itself non-dumpable
// (daemon/nondumpable/tale-nondumpable.c), then reads the descriptor to its
// end and closes it, before it starts anything that could inherit it. A
// descriptor that is named but holds no token, or a runnerd that cannot make
// itself non-dumpable, stops runnerd: it must neither run without its token
// nor hold it where its execs can reach it.
//
// Without the variable, the token is TALE_RUNNERD_TOKEN, read from the
// environment whenever it is asked for: how the tests and a runnerd started
// by hand get it, and empty (no token) in the unsigned dev mode.

import { closeSync, readFileSync } from 'node:fs';

/** Where the image keeps the addon runnerd makes itself non-dumpable with. */
export const NON_DUMPABLE_ADDON = '/usr/local/lib/tale/tale-nondumpable.node';

/** The variable that names the descriptor the token arrives on. */
export const RUNNERD_TOKEN_FD_ENV = 'TALE_RUNNERD_TOKEN_FD';

/** What the addon gives runnerd. */
export interface NonDumpable {
  /** Make this process non-dumpable; throws when the kernel refuses. */
  setNonDumpable(): void;
  /** Whether processes of this uid may read this one's /proc entries. */
  isDumpable(): boolean;
}

function isNonDumpable(value: unknown): value is NonDumpable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'setNonDumpable' in value &&
    typeof value.setNonDumpable === 'function' &&
    'isDumpable' in value &&
    typeof value.isDumpable === 'function'
  );
}

/** The addon at `path`, loaded into this process. */
export function loadNonDumpable(path = NON_DUMPABLE_ADDON): NonDumpable {
  const addon = { exports: {} };
  process.dlopen(addon, path);
  if (!isNonDumpable(addon.exports))
    throw new Error(`${path} is not the non-dumpable addon`);
  return addon.exports;
}

export interface RunnerdToken {
  /** The token; empty in the unsigned dev mode. */
  token: string;
  source: 'descriptor' | 'environment' | 'none';
  /** False once runnerd has made itself non-dumpable; undefined when it did
   * not try, for a token from the environment, where its uid reads it
   * anyway. */
  dumpable?: boolean;
}

export interface ReadRunnerdTokenOptions {
  env?: NodeJS.ProcessEnv;
  nonDumpable?: () => NonDumpable;
  read?: (fd: number) => string;
  close?: (fd: number) => void;
}

/**
 * Read the token as the header says. A descriptor's last line break (the
 * entrypoint's here-document and the supervisor both end the token with one)
 * is not part of it. The variable that named the descriptor is gone from
 * `env` afterwards, whatever happened.
 */
export function readRunnerdToken(
  options: ReadRunnerdTokenOptions = {},
): RunnerdToken {
  const env = options.env ?? process.env;
  const named = env.TALE_RUNNERD_TOKEN_FD;
  if (named === undefined) {
    const token = env.TALE_RUNNERD_TOKEN ?? '';
    return { token, source: token === '' ? 'none' : 'environment' };
  }
  delete env.TALE_RUNNERD_TOKEN_FD;
  // Never 0 to 2: runnerd's standard streams are not where a token comes.
  if (!/^\d{1,9}$/.test(named) || Number(named) < 3)
    throw new Error(
      `${RUNNERD_TOKEN_FD_ENV} names no descriptor runnerd reads its token from: ${JSON.stringify(named)}`,
    );
  const fd = Number(named);
  const read = options.read ?? ((from) => readFileSync(from, 'utf8'));
  const close = options.close ?? closeSync;
  let text: string;
  try {
    const addon = (options.nonDumpable ?? loadNonDumpable)();
    addon.setNonDumpable();
    if (addon.isDumpable())
      throw new Error('runnerd is still dumpable after it cleared the flag');
    try {
      text = read(fd);
    } catch (error) {
      throw new Error(`reading the token from descriptor ${fd} failed`, {
        cause: error,
      });
    }
  } finally {
    // Closed whatever happened, so nothing started later inherits it.
    try {
      close(fd);
    } catch (error) {
      console.warn(
        `[runnerd] closing the token's descriptor ${fd} failed:`,
        error,
      );
    }
  }
  const token = text.endsWith('\n') ? text.slice(0, -1) : text;
  if (token === '') throw new Error(`descriptor ${fd} held no token`);
  return { token, source: 'descriptor', dumpable: false };
}

let fromDescriptor: RunnerdToken | Error | undefined;

/**
 * The token. One that comes on a descriptor is read on the first call (each
 * process asks before it starts anything) and kept for the process's life,
 * and so is a failure to read it, which every later call throws again: a
 * process whose descriptor failed falls back neither to the environment's
 * token nor to none.
 */
export function runnerdToken(
  env: NodeJS.ProcessEnv = process.env,
): RunnerdToken {
  if (fromDescriptor instanceof Error) throw fromDescriptor;
  if (fromDescriptor !== undefined) return fromDescriptor;
  if (env.TALE_RUNNERD_TOKEN_FD === undefined) return readRunnerdToken({ env });
  try {
    fromDescriptor = readRunnerdToken({ env });
  } catch (error) {
    fromDescriptor = error instanceof Error ? error : new Error(String(error));
    throw fromDescriptor;
  }
  return fromDescriptor;
}
