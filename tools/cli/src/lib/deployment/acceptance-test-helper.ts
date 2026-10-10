import { fileURLToPath } from 'node:url';

import { boundedOutput } from '../docker/bounded-output';

/** Own each native socket lifecycle outside the suite's long-lived Bun VM. */
export async function acceptanceHttpProbe(mode: string) {
  const fixture = fileURLToPath(
    new URL('../../../tests/fixtures/acceptance-http.ts', import.meta.url),
  );
  const child = Bun.spawn([process.execPath, fixture, mode], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    detached: process.platform !== 'win32',
    env: { PATH: process.env.PATH },
  });
  const result = await boundedOutput(child, {
    timeout: 30,
    maxOutputBytes: 65536,
  });
  return { ...result, pid: child.pid };
}
