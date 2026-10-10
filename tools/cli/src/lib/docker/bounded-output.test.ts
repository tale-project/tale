import { expect, setDefaultTimeout, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

setDefaultTimeout(15_000);

const fixture = fileURLToPath(
  new URL('../../../tests/fixtures/exec-bounded.ts', import.meta.url),
);
async function probe(mode: string) {
  const child = Bun.spawn([process.execPath, fixture, mode], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    return JSON.parse(stdout);
  } finally {
    clearTimeout(timer);
  }
}
test('bounded capture preserves literal stdin, stderr and nonzero status', async () => {
  expect(await probe('stdin')).toEqual({
    success: false,
    stdout: 'literal $value',
    stderr: 'diagnostic',
    exitCode: 7,
  });
});
test('combined byte budget refuses output without echoing it', async () => {
  expect(await probe('bytes')).toEqual({
    error: 'Command output exceeded its byte limit.',
  });
});
test('bounded capture kills and settles a TERM-ignoring child', async () => {
  expect(await probe('timeout')).toEqual({
    error: 'Command exceeded its time limit.',
  });
});
test.skipIf(process.platform === 'win32')(
  'bounded capture kills the handshaken child and descendant',
  async () => {
    const result = await probe('descendant');
    expect(result.error).toBe('Command exceeded its time limit.');
    expect(result.started).toHaveLength(2);
    for (const pid of result.started) expect(pid).toBeGreaterThan(0);
    expect(result.remaining).toEqual([]);
  },
);
