// Thin Bun-native wrapper around `docker` invocations.
//
// Centralised so docker_args.ts stays a pure argv builder (unit-testable) and
// every actual docker call goes through one shape with consistent stdout/stderr
// handling, stdin piping, and timeouts.

export interface RunDockerOptions {
  stdin?: string;
  // Set true when we expect a binary blob (tar stream) on stdout.
  captureBinaryStdout?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
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

  // Concurrent reads to avoid pipe-back-pressure deadlock.
  const [stdoutBytes, stderrBytes] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
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
