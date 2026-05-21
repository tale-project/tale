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
  // Hard cap on stdout bytes buffered into the spawner heap. Once exceeded,
  // we keep draining the pipe (so the writer doesn't block) but discard
  // further bytes. Without this a runaway runtime container can OOM the
  // spawner via gigabytes of stdout (audit finding R2-B2).
  stdoutMaxBytes?: number;
  // Same as `stdoutMaxBytes`, applied to stderr.
  stderrMaxBytes?: number;
}

interface RunDockerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  // True iff stdout/stderr capacity cap was hit. Spawn callers OR this with
  // any further post-processing truncation to surface the truncated flag on
  // the wire.
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

// Read lazily so tests can override DOCKER_BIN (e.g. to /bin/bash) after
// module load. Cheap: a single env-var read per docker invocation.
function dockerBin(): string {
  return process.env.DOCKER_BIN ?? 'docker';
}

/**
 * Drain a Bun process pipe, buffering up to `maxBytes`. Continues to read
 * past the cap (so the writer doesn't block on a full pipe — which would
 * deadlock the docker CLI), but discards extra bytes. Returns the buffered
 * portion plus a `truncated` flag.
 *
 * When `onChunk` is provided, every received chunk is forwarded — including
 * chunks past the cap — so callers can do line-buffered scanning (e.g. the
 * phase-marker parser in spawn.ts) without losing events to truncation.
 */
async function drainAndCap(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number | undefined,
  onChunk?: (chunk: Uint8Array) => void,
): Promise<{ bytes: ArrayBuffer; truncated: boolean }> {
  const reader = stream.getReader();
  const collected: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (onChunk) onChunk(value);
      if (maxBytes === undefined) {
        collected.push(value);
        total += value.byteLength;
        continue;
      }
      if (total >= maxBytes) {
        truncated = true;
        continue;
      }
      if (total + value.byteLength <= maxBytes) {
        collected.push(value);
        total += value.byteLength;
      } else {
        // Partial chunk fits; take the prefix and mark truncated.
        const remaining = maxBytes - total;
        if (remaining > 0) {
          collected.push(value.subarray(0, remaining));
          total += remaining;
        }
        truncated = true;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch (err) {
      console.warn('[sandbox] reader.releaseLock failed:', err);
    }
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of collected) {
    merged.set(c, off);
    off += c.byteLength;
  }
  return {
    bytes: merged.buffer.slice(
      merged.byteOffset,
      merged.byteOffset + merged.byteLength,
    ),
    truncated,
  };
}

export async function runDocker(
  args: string[],
  opts: RunDockerOptions = {},
): Promise<RunDockerResult> {
  const proc = Bun.spawn([dockerBin(), ...args], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    signal: opts.signal,
  });

  // Drain both streams concurrently to avoid pipe-back-pressure deadlock,
  // and cap each independently so a runaway docker invocation can't OOM
  // the spawner heap (audit finding R2-B2). stderr was previously read via
  // `new Response(proc.stderr).arrayBuffer()` which has no cap — same OOM
  // surface in the rare case stderr dominates.
  const collectIO = Promise.all([
    drainAndCap(
      proc.stdout as ReadableStream<Uint8Array>,
      opts.stdoutMaxBytes,
      opts.onStdoutChunk,
    ),
    drainAndCap(proc.stderr as ReadableStream<Uint8Array>, opts.stderrMaxBytes),
  ]);

  // Race the COLLECTOR (not just `proc.exited`) against the optional timeout.
  // The previous shape — `await Promise.all([collectStdout(), stderr])` BEFORE
  // arming `setTimeout` — meant a wedged daemon whose pipes never close would
  // block indefinitely; the supposed backstop timer never armed (audit
  // finding R2-B2 #3).
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stdoutResult = { bytes: new ArrayBuffer(0), truncated: false };
  let stderrResult = { bytes: new ArrayBuffer(0), truncated: false };
  if (opts.timeoutMs !== undefined && Number.isFinite(opts.timeoutMs)) {
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill('SIGKILL');
        } catch (err) {
          console.warn('[sandbox] proc.kill on timeout failed:', err);
        }
        if (opts.killOnTimeoutContainer) {
          const target = opts.killOnTimeoutContainer;
          const killer = Bun.spawn(
            [dockerBin(), 'kill', '--signal=SIGKILL', target],
            { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' },
          );
          killer.exited.catch((err) => {
            console.warn(
              `[sandbox] docker kill ${target} on timeout failed:`,
              err,
            );
          });
        }
        resolve('timeout');
      }, opts.timeoutMs);
    });
    const winner = await Promise.race([
      collectIO.then((v) => ['io', v] as const),
      timeoutPromise.then((t) => [t, null] as const),
    ]);
    if (winner[0] === 'io' && winner[1] !== null) {
      [stdoutResult, stderrResult] = winner[1];
    } else {
      // Timer fired before collectors finished. Await collectIO once more so
      // we still pick up whatever bytes were drained before the kill — the
      // pipes should EOF promptly once the process is killed.
      try {
        [stdoutResult, stderrResult] = await collectIO;
      } catch (err) {
        console.warn(
          '[sandbox] post-timeout drain failed; partial buffers:',
          err,
        );
      }
    }
  } else {
    [stdoutResult, stderrResult] = await collectIO;
  }
  await proc.exited;
  if (timer) clearTimeout(timer);

  const exitCode = timedOut ? 124 : (proc.exitCode ?? -1);

  const decoder = new TextDecoder('utf-8', { fatal: false });
  return {
    exitCode,
    stdout: decoder.decode(stdoutResult.bytes),
    stderr: decoder.decode(stderrResult.bytes),
    stdoutTruncated: stdoutResult.truncated,
    stderrTruncated: stderrResult.truncated,
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
