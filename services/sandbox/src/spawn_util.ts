// Thin Bun-native wrapper around `docker` invocations.
//
// Centralised so docker_args.ts stays a pure argv builder (unit-testable) and
// every actual docker call goes through one shape with consistent stdout/stderr
// handling, stdin piping, and timeouts.

export interface RunDockerOptions {
  stdin?: string | Uint8Array;
  // Set true when we expect a binary blob (tar stream) on stdout.
  captureBinaryStdout?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  // When set, on host-side timeout the CLI process is killed AND
  // `docker kill <killOnTimeoutContainer>` is invoked so the actual
  // sibling container stops. Without this the container keeps running
  // after the CLI disconnects (R5 test).
  killOnTimeoutContainer?: string;
  // Per-chunk stdout callback fired while the subprocess is alive. Used
  // by the phase-marker parser in spawn.ts to emit phase events to the
  // SSE stream as soon as the container's entrypoint emits them, rather
  // than waiting for the container to exit (Refinement 2). The callback
  // is plain bytes; the caller is responsible for line-buffering.
  onStdoutChunk?: (chunk: Uint8Array) => void;
}

export interface RunDockerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutBytes?: Uint8Array;
}

const DOCKER_BIN = process.env.DOCKER_BIN ?? 'docker';

export async function runDocker(
  args: string[],
  opts: RunDockerOptions = {},
): Promise<RunDockerResult> {
  const proc = Bun.spawn([DOCKER_BIN, ...args], {
    stdin: opts.stdin !== undefined ? 'pipe' : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    signal: opts.signal,
  });

  if (opts.stdin !== undefined && proc.stdin) {
    proc.stdin.write(opts.stdin);
    await proc.stdin.end();
  }

  // Concurrent reads to avoid pipe-back-pressure deadlock. When the caller
  // wants chunk callbacks (for live phase parsing), we read stdout via a
  // reader loop and fire the callback per chunk while still accumulating the
  // full buffer for the final return value.
  const collectStdout = async (): Promise<ArrayBuffer> => {
    if (!opts.onStdoutChunk) {
      return new Response(proc.stdout).arrayBuffer();
    }
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const collected: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        opts.onStdoutChunk(value);
        collected.push(value);
        total += value.byteLength;
      }
    }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of collected) {
      merged.set(c, off);
      off += c.byteLength;
    }
    return merged.buffer.slice(
      merged.byteOffset,
      merged.byteOffset + merged.byteLength,
    );
  };
  const [stdoutBytes, stderrBytes] = await Promise.all([
    collectStdout(),
    new Response(proc.stderr).arrayBuffer(),
  ]);

  // Race against optional timeout.
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const exited = proc.exited;
  if (opts.timeoutMs && Number.isFinite(opts.timeoutMs)) {
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          proc.kill('SIGKILL');
          // Killing the docker CLI process doesn't stop the sibling
          // container it spawned — issue an explicit `docker kill` so
          // the runtime container actually terminates instead of
          // running to completion in the background.
          if (opts.killOnTimeoutContainer) {
            const target = opts.killOnTimeoutContainer;
            const killer = Bun.spawn(
              [DOCKER_BIN, 'kill', '--signal=SIGKILL', target],
              { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' },
            );
            void killer.exited;
          }
          resolve();
        }, opts.timeoutMs);
      }),
    ]);
  } else {
    await exited;
  }
  if (timer) clearTimeout(timer);

  const exitCode = timedOut ? 124 : (proc.exitCode ?? -1);

  return {
    exitCode,
    stdout: opts.captureBinaryStdout
      ? ''
      : new TextDecoder('utf-8', { fatal: false }).decode(stdoutBytes),
    stderr: new TextDecoder('utf-8', { fatal: false }).decode(stderrBytes),
    stdoutBytes: opts.captureBinaryStdout
      ? new Uint8Array(stdoutBytes)
      : undefined,
  };
}

export async function dockerKill(containerName: string): Promise<void> {
  await runDocker(['kill', '--signal=SIGKILL', containerName]);
}

export async function dockerRm(containerName: string): Promise<void> {
  await runDocker(['rm', '--force', containerName]);
}
