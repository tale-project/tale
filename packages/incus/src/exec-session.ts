// Exec mode 3: a command whose stdin, stdout and stderr are websockets, over
// the same pinned mutual TLS as every request (Bun's `WebSocket` with
// `tls: {cert, key, ca}`).
//
// The protocol (Incus 7.6, `shared/ws/rwc.go`, `instance_exec.go`), as S1
// measured it: a non-interactive exec with `wait-for-websocket` names one
// secret per file descriptor (0, 1, 2) and one for `control`; the command
// starts once all four are connected. Data travels in binary frames; an
// empty TEXT frame ends a stream (stdin's end-of-file, and stdout's and
// stderr's end). A `{"command":"signal","signal":N}` on the control socket
// signals the command, and closing the control socket kills it (exit 137,
// within tens of milliseconds on 7.6).
// It carried a 16 MiB stdin byte-equal, so there is no size cap on stdin
// here, unlike the 1 MiB stdin file of modes 1-2.

import { IncusApiError, type IncusOperation } from './api.ts';
import type { IncusClient } from './client.ts';
import { buildExecBody, execResult, type ExecIdentity } from './exec.ts';

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
/** stdin goes out in frames of this size. */
const STDIN_FRAME_BYTES = 128 * 1024;
/** A session waits this long for its exit code at most (a held psql). */
const SESSION_WAIT_MS = 7 * 24 * 60 * 60 * 1000;

export interface ExecSessionOptions extends ExecIdentity {
  /** Every chunk the command writes, as it arrives. */
  onOutput?: (fd: 1 | 2, chunk: Uint8Array) => void;
  connectTimeoutMs?: number;
}

export interface ExecSession {
  readonly operationId: string;
  /** Sends bytes to the command's stdin. */
  write(chunk: string | Uint8Array): void;
  /** Ends the command's stdin. */
  closeStdin(): void;
  /** Sends the command a signal (15 = SIGTERM). */
  signal(signal: number): void;
  /** Ends the command: closes the control socket, which kills it. */
  close(): void;
  /** The exit code, once the command ended and its output was read. */
  readonly exit: Promise<number>;
}

function fdsOf(operation: IncusOperation): Record<string, string> {
  const metadata = operation.metadata;
  const fds =
    metadata !== null && typeof metadata === 'object' && 'fds' in metadata
      ? metadata.fds
      : undefined;
  const out: Record<string, string> = {};
  if (fds !== null && typeof fds === 'object') {
    for (const [fd, secret] of Object.entries(fds)) {
      if (typeof secret === 'string') out[fd] = secret;
    }
  }
  for (const fd of ['0', '1', '2', 'control']) {
    if (out[fd] === undefined) {
      throw new IncusApiError(
        `Incus answered exec operation ${operation.id} without a secret for ${fd}`,
        502,
      );
    }
  }
  return out;
}

function opened(ws: WebSocket, timeoutMs: number, what: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `The exec websocket ${what} did not open within ${timeoutMs} ms`,
        ),
      );
      ws.close();
    }, timeoutMs);
    ws.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    ws.addEventListener(
      'error',
      (event) => {
        clearTimeout(timer);
        const message = 'message' in event ? String(event.message) : 'error';
        reject(new Error(`The exec websocket ${what} failed: ${message}`));
      },
      { once: true },
    );
  });
}

/** Resolves once the stream's end frame arrives or the socket closes. */
function drained(
  ws: WebSocket,
  onChunk: (chunk: Uint8Array) => void,
): Promise<void> {
  return new Promise<void>((resolve) => {
    ws.addEventListener('message', (event) => {
      const data: unknown = event.data;
      if (typeof data === 'string') {
        if (data === '') resolve();
        return;
      }
      if (data instanceof ArrayBuffer) onChunk(new Uint8Array(data));
      else if (data instanceof Uint8Array) onChunk(data);
    });
    ws.addEventListener('close', () => resolve(), { once: true });
  });
}

function closeQuietly(ws: WebSocket): void {
  try {
    ws.close();
  } catch (error) {
    console.warn(
      '[incus.exec] closing an exec websocket failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

/** Starts the command and connects its four websockets (control first). */
export async function openExecSession(
  client: IncusClient,
  instance: string,
  argv: readonly string[],
  options: ExecSessionOptions = {},
): Promise<ExecSession> {
  if (argv.length === 0) throw new Error('An exec needs a command');
  const operation = await client.startOperation(
    'POST',
    `/1.0/instances/${encodeURIComponent(instance)}/exec`,
    {
      query: { project: client.project },
      json: buildExecBody([...argv], options, {
        recordOutput: false,
        webSocket: true,
      }),
    },
  );
  const fds = fdsOf(operation);
  const timeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const open = (fd: string): WebSocket => {
    const ws = client.openWebSocket(
      `/1.0/operations/${encodeURIComponent(operation.id)}/websocket`,
      { project: client.project, secret: fds[fd] },
    );
    ws.binaryType = 'arraybuffer';
    return ws;
  };
  const sockets: WebSocket[] = [];
  try {
    const control = open('control');
    sockets.push(control);
    await opened(control, timeoutMs, 'control');
    const stdin = open('0');
    const stdout = open('1');
    const stderr = open('2');
    sockets.push(stdin, stdout, stderr);
    // The readers are in place before the command can start.
    const outputs = Promise.all([
      drained(stdout, (chunk) => options.onOutput?.(1, chunk)),
      drained(stderr, (chunk) => options.onOutput?.(2, chunk)),
    ]);
    await Promise.all([
      opened(stdin, timeoutMs, '0'),
      opened(stdout, timeoutMs, '1'),
      opened(stderr, timeoutMs, '2'),
    ]);
    let stdinOpen = true;
    const exit = (async () => {
      const done = await client.waitOperation(operation, SESSION_WAIT_MS);
      await outputs;
      for (const ws of sockets) closeQuietly(ws);
      return execResult(done).exitCode;
    })();
    // A caller that awaits `exit` sees its failure; one that does not must
    // not crash the process with an unhandled rejection.
    exit.catch((error: unknown) => {
      console.warn(
        `[incus.exec] exec ${operation.id} in ${instance} ended without an exit code:`,
        error instanceof Error ? error.message : error,
      );
    });
    return {
      operationId: operation.id,
      write(chunk) {
        if (!stdinOpen) throw new Error('The exec stdin is closed');
        const bytes =
          typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
        for (let at = 0; at < bytes.byteLength; at += STDIN_FRAME_BYTES) {
          stdin.send(bytes.subarray(at, at + STDIN_FRAME_BYTES));
        }
      },
      closeStdin() {
        if (!stdinOpen) return;
        stdinOpen = false;
        stdin.send('');
      },
      signal(signal) {
        if (!Number.isInteger(signal) || signal < 1 || signal > 64) {
          throw new Error(`Not a signal: ${signal}`);
        }
        control.send(JSON.stringify({ command: 'signal', signal }));
      },
      close() {
        stdinOpen = false;
        closeQuietly(control);
      },
      exit,
    };
  } catch (error) {
    // Closing the control socket ends a command that may have started.
    for (const ws of sockets) closeQuietly(ws);
    throw error;
  }
}

/** Runs a command over a websocket session to its end: stdin of any size,
 * output bounded by `maxOutputBytes` (stdout and stderr together), and the
 * whole run by `deadlineMs`. Past either bound the command is killed and the
 * call throws. */
export async function execOverWebSocket(
  client: IncusClient,
  instance: string,
  argv: readonly string[],
  options: ExecIdentity & {
    stdin?: string | Uint8Array;
    maxOutputBytes: number;
    deadlineMs: number;
    connectTimeoutMs?: number;
  },
): Promise<{ exitCode: number; stdout: Uint8Array; stderr: Uint8Array }> {
  const chunks: Record<1 | 2, Uint8Array[]> = { 1: [], 2: [] };
  let total = 0;
  let failure: Error | undefined;
  let session: ExecSession | undefined;
  const refuse = (message: string) => {
    failure ??= new Error(message);
    session?.close();
  };
  const timer = setTimeout(
    () => refuse('Command exceeded its time limit.'),
    options.deadlineMs,
  );
  try {
    const { stdin, maxOutputBytes, deadlineMs: _deadline, ...rest } = options;
    session = await openExecSession(client, instance, argv, {
      ...rest,
      onOutput(fd, chunk) {
        total += chunk.byteLength;
        if (total > maxOutputBytes) {
          refuse('Command output exceeded its byte limit.');
          return;
        }
        chunks[fd].push(chunk);
      },
    });
    if (failure !== undefined) session.close();
    if (stdin !== undefined && failure === undefined) session.write(stdin);
    session.closeStdin();
    const exitCode = await session.exit;
    if (failure !== undefined) throw failure;
    return {
      exitCode,
      stdout: Buffer.concat(chunks[1]),
      stderr: Buffer.concat(chunks[2]),
    };
  } finally {
    clearTimeout(timer);
  }
}
