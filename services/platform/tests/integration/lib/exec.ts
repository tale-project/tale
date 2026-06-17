/**
 * Thin wrappers around `Bun.spawn` for the container test suite. Replaces the
 * shell-command plumbing the bash scripts relied on (`$(...)`, `cmd 2>&1`,
 * heredoc stdin) with explicit, typed helpers.
 */

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** stdout followed by stderr — the TS analogue of `cmd 2>&1`. */
  combined: string;
}

export interface RunOptions {
  cwd?: string;
  /** Extra env vars merged over `process.env`. */
  env?: Record<string, string | undefined>;
  /** String or bytes piped to the process stdin. */
  stdin?: string | Uint8Array;
}

function mergedEnv(
  extra?: Record<string, string | undefined>,
): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) base[k] = v;
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) base[k] = v;
    }
  }
  return base;
}

/** Normalize the optional stdin into something `Bun.spawn` accepts. */
function spawnStdin(stdin: RunOptions['stdin']): Blob | 'ignore' {
  if (stdin === undefined) return 'ignore';
  // Copy bytes into an ArrayBuffer-backed view: lib.dom's `BlobPart` rejects
  // the `ArrayBufferLike`-generic `Uint8Array` this file's tsconfig now sees.
  return new Blob([typeof stdin === 'string' ? stdin : new Uint8Array(stdin)]);
}

/** Run a command and capture its output. Never throws on a non-zero exit. */
export async function capture(
  cmd: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: mergedEnv(opts.env),
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: spawnStdin(opts.stdin),
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr, combined: stdout + stderr };
}

/**
 * Run a command, streaming stdout/stderr straight to this process's streams
 * (the bash `cmd 2>&1` to the terminal). Returns the exit code; never throws.
 */
export async function stream(
  cmd: string[],
  opts: RunOptions = {},
): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: mergedEnv(opts.env),
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: spawnStdin(opts.stdin),
  });
  return await proc.exited;
}

/** True when the command exits 0. Output is discarded (`cmd >/dev/null 2>&1`). */
export async function ok(
  cmd: string[],
  opts: RunOptions = {},
): Promise<boolean> {
  const { exitCode } = await capture(cmd, opts);
  return exitCode === 0;
}

/** Trimmed stdout of a command, or '' when it fails (the `$(cmd 2>/dev/null || echo "")` idiom). */
export async function stdoutOf(
  cmd: string[],
  opts: RunOptions = {},
): Promise<string> {
  const { stdout, exitCode } = await capture(cmd, opts);
  return exitCode === 0 ? stdout.trim() : '';
}

/** Resolve the repo root from this file's location (services/platform/tests/integration/lib → repo root). */
export function projectRoot(): string {
  return new URL('../../../../../', import.meta.url).pathname.replace(
    /\/$/,
    '',
  );
}
