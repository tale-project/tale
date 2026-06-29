// Tests for the offline CLI (cli.ts): it reads a recording JSON, builds the
// report, and prints the compact report (default) or the faithful Report
// (`--full`). `main` lives behind the `import.meta.main` guard (only true when the
// file is the process entry), so its observable contract is exercised
// out-of-process via `Bun.spawn` over the happy / --full / arg-order / usage /
// bad-file paths. The recorded input is the committed `sample-recording.json`
// golden (the same one `examples.test.ts` pins), so this also guards that the
// offline pipeline stays runnable end to end.

import { describe, expect, test } from 'bun:test';

const CLI = new URL('./cli.ts', import.meta.url).pathname;
const RECORDING = new URL('../examples/sample-recording.json', import.meta.url)
  .pathname;

async function runCli(
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

describe('cli (offline recording analysis)', () => {
  test('default: prints the compact report (numeric score) and exits 0', async () => {
    const { code, stdout, stderr } = await runCli([RECORDING]);
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(stdout);
    // The compact report carries a numeric `score`; the faithful Report does not.
    expect(typeof (parsed as { score?: unknown }).score === 'number').toBe(
      true,
    );
    expect(stderr).toBe('');
  });

  test('--full: prints the faithful Report (session, no compact score)', async () => {
    const { code, stdout } = await runCli([RECORDING, '--full']);
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(stdout);
    expect(Reflect.has(parsed as object, 'session')).toBe(true);
    expect(Reflect.has(parsed as object, 'score')).toBe(false);
  });

  test('--full before the path still works (path = first non-flag arg)', async () => {
    const { code, stdout } = await runCli(['--full', RECORDING]);
    expect(code).toBe(0);
    expect(Reflect.has(JSON.parse(stdout) as object, 'session')).toBe(true);
  });

  test('no path: prints usage to stderr and exits 1 (stdout stays clean)', async () => {
    const { code, stdout, stderr } = await runCli([]);
    expect(code).toBe(1);
    expect(stderr).toContain('usage: bun src/cli.ts');
    expect(stdout).toBe('');
  });

  test('a missing file is reduced to a one-line error and exit 1 (no stack trace)', async () => {
    const { code, stdout, stderr } = await runCli([
      '/no/such/recording-xyz.json',
    ]);
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr.trim().length).toBeGreaterThan(0);
    // The `import.meta.main` catch prints `error.message`, never a raw stack.
    expect(stderr).not.toContain('\n    at ');
  });
});
