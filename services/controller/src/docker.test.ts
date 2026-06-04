import { afterAll, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A unix socket the docker client will dial instead of the real daemon.
const sockPath = join(tmpdir(), `controller-docker-test-${process.pid}.sock`);
rmSync(sockPath, { force: true });

// Server that sends valid headers declaring a Content-Length larger than the
// body it actually writes, then destroys the socket mid-body. This is the
// truncated-response case: without a response 'error' handler the client
// promise never settles and the request hangs forever.
const server = net.createServer((socket) => {
  socket.write(
    'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n',
  );
  socket.write('[');
  socket.destroy();
});

await new Promise<void>((resolve) => {
  server.listen(sockPath, resolve);
});
// docker.ts captures DOCKER_SOCKET at module-eval time, so set it before import.
process.env.DOCKER_SOCKET = sockPath;
const { listContainerIds } = await import('./docker.ts');

afterAll(() => {
  server.close();
  rmSync(sockPath, { force: true });
});

test('dockerRequest rejects (never hangs) on a truncated response', async () => {
  // Awaiting the real promise proves it SETTLES: it must reject promptly via the
  // response 'error' handler, far below the absolute deadline. If the hang-guard
  // regresses, the promise never settles and this test times out instead.
  let rejected = false;
  try {
    await listContainerIds(['p'], ['svc']);
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
}, 5000);
