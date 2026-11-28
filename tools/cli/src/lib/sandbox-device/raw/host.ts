import { spawn } from 'node:child_process';
import { homedir, userInfo } from 'node:os';

/**
 * What a raw device asks of the machine it runs on: programs it runs and who
 * it runs as. Everything that changes the machine goes through it, so the
 * device's rules are tested against a fake host.
 */
export interface RawHost {
  run(
    argv: string[],
    options?: { input?: string; timeoutMs?: number },
  ): Promise<{ code: number; stdout: string; stderr: string }>;
  isRoot(): boolean;
  uid(): number;
  os(): NodeJS.Platform;
  home(): string;
  user(): string;
  /** The `tale` binary this process runs from. */
  execPath(): string;
}

async function runProgram(
  argv: string[],
  options: { input?: string; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const [program, ...args] = argv;
  if (program === undefined) throw new Error('nothing to run');
  return await new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: options.timeoutMs ?? 120_000,
      killSignal: 'SIGKILL',
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({
        code: code ?? (signal === null ? 1 : 128),
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
    child.stdin.on('error', (error: Error) => {
      // The program may exit before it reads its input; its answer says why.
      console.warn(`[tale] ${program} did not take its input:`, error.message);
    });
    child.stdin.end(options.input ?? '');
  });
}

export const realHost: RawHost = {
  run: runProgram,
  isRoot: () => process.getuid?.() === 0,
  uid: () => process.getuid?.() ?? -1,
  os: () => process.platform,
  home: homedir,
  user: () => userInfo().username,
  execPath: () => process.execPath,
};

/** Run a program that must succeed; its error output explains a failure. */
export async function must(
  host: RawHost,
  argv: string[],
  what: string,
  options: { input?: string; timeoutMs?: number } = {},
): Promise<string> {
  const result = await host.run(argv, options);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(
      `${what} failed (${argv[0]} exited ${result.code})${detail ? `: ${detail}` : ''}`,
    );
  }
  return result.stdout;
}
