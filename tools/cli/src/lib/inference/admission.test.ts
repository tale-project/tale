import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { INFERENCE_ADMISSION_SOURCE } from './admission';

test('model-free Python ASGI gate: shared FIFO, cancellation, native settlement and 64-item batches', async () => {
  const python =
    process.env.TALE_TEST_PYTHON ?? Bun.which('python3') ?? Bun.which('python');
  expect(python).toBeTruthy();
  const root = await mkdtemp(join(tmpdir(), 'tale-asgi-admission-'));
  try {
    const source = join(root, 'runtime-admission.py');
    await writeFile(source, INFERENCE_ADMISSION_SOURCE);
    const fixture = join(root, 'admission-fixture.py');
    await writeFile(
      fixture,
      await readFile(new URL('./tests/admission_fixture.py', import.meta.url)),
    );
    const child = Bun.spawn([python!, fixture, source], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
    expect(stderr).toContain('Ran 12 tests');
    expect(stderr).toContain('OK');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
