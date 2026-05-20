// Thin Bun-native wrapper around `docker` invocations.
//
// Centralised so docker-args.ts stays a pure argv builder (unit-testable) and
// every actual docker call goes through one shape with consistent stdout/stderr
// handling and timeouts.

interface RunDockerOptions {
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

interface RunDockerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const DOCKER_BIN = process.env.DOCKER_BIN ?? 'docker';

export async function runDocker(
  args: string[],
  opts: RunDockerOptions = {},
): Promise<RunDockerResult> {
  const proc = Bun.spawn([DOCKER_BIN, ...args], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    signal: opts.signal,
  });

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
    stdout: new TextDecoder('utf-8', { fatal: false }).decode(stdoutBytes),
    stderr: new TextDecoder('utf-8', { fatal: false }).decode(stderrBytes),
  };
}

/**
 * Send a signal to a container. Default is SIGTERM (graceful); cancel paths
 * escalate to KILL when the graceful kill timed out. Callers wrap this in
 * `withTimeout` so a wedged daemon cannot block the HTTP cancel response.
 */
export async function dockerKill(
  containerName: string,
  signal: 'TERM' | 'KILL' = 'TERM',
): Promise<void> {
  await runDocker(['kill', `--signal=SIG${signal}`, containerName]);
}

export async function dockerRm(containerName: string): Promise<void> {
  await runDocker(['rm', '--force', containerName]);
}

/**
 * Best-effort `docker pull` of an image, retried with exponential backoff.
 * Used once at spawner boot so the first /v1/execute call doesn't pay a cold
 * registry round-trip. Returns true on success; the caller decides whether
 * to fail-closed on a persistent failure.
 */
export async function ensureImage(
  image: string,
  opts: { attempts?: number } = {},
): Promise<boolean> {
  const inspect = await runDocker(['image', 'inspect', image]);
  if (inspect.exitCode === 0) return true;
  const attempts = opts.attempts ?? 3;
  for (let i = 0; i < attempts; i++) {
    const result = await runDocker(['pull', image]);
    if (result.exitCode === 0) return true;
    if (i < attempts - 1) {
      const delayMs = 1000 * (i + 1);
      console.warn(
        `[sandbox] docker pull ${image} attempt ${i + 1} failed; retrying in ${delayMs}ms — stderr: ${result.stderr.trim()}`,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    } else {
      console.error(
        `[sandbox] docker pull ${image} failed after ${attempts} attempts — stderr: ${result.stderr.trim()}`,
      );
    }
  }
  return false;
}
