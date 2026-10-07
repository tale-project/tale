import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

import { boundedOutput } from '../docker/bounded-output';
import { acceptanceRequest } from './acceptance-request';

const identity =
  'v1;service=platform;instance=11111111-1111-4111-8111-111111111111';

for (const mode of ['tls', 'proxy'])
  test.skipIf(mode === 'tls' && process.platform === 'win32')(
    `actual ${mode} transport preserves trust and bypasses ambient proxies in an isolated process`,
    async () => {
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
      expect(result.success, result.stderr).toBe(true);
      expect(result.stdout).toBe('accepted');
    },
    35_000,
  );

for (const mode of [
  'redirect',
  'missing',
  'oversized',
  'stalled',
  'duplicate',
] as const)
  test(`direct observation refuses ${mode} response within its owned deadline`, async () => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => {
        const headers = new Headers({ 'Tale-Serving-Identity': identity });
        if (mode === 'redirect')
          return new Response(null, {
            status: 302,
            headers: { location: 'https://example.invalid' },
          });
        if (mode === 'missing') headers.delete('Tale-Serving-Identity');
        if (mode === 'duplicate')
          headers.append('Tale-Serving-Identity', identity);
        if (mode === 'stalled')
          return new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode('{'));
              },
            }),
            { headers },
          );
        return new Response(mode === 'oversized' ? 'x'.repeat(65537) : '{}', {
          headers,
        });
      },
    });
    try {
      await expect(
        acceptanceRequest(
          `http://127.0.0.1:${server.port}/api/health`,
          AbortSignal.timeout(100),
        ),
      ).rejects.toThrow();
    } finally {
      await server.stop(true);
    }
  });
