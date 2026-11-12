// The client the Incus runtime builds from the certificate files: the
// spawner's operation budget reaches every call it makes. @tale/incus takes
// that budget as a parameter, so this is where the spawner proves it hands it
// over.

import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { createServer, type Server } from 'node:net';

import {
  makeTestCertificates,
  type TestCertificates,
} from '@tale/incus/test-certificates';

import { withOperationBudget } from '../../operation-budget.ts';
import { IncusRuntime } from './incus-runtime.ts';
import { incusTestConfig } from './incus-test-config.ts';

let made: TestCertificates | undefined;
const silent: Server[] = [];

beforeAll(async () => {
  made = await makeTestCertificates();
});

afterAll(() => {
  for (const server of silent) server.close();
  made?.dispose();
});

test('an operation budget that ends cancels the call the runtime’s client has in flight', async () => {
  const certs = made;
  if (certs === undefined) throw new Error('the certificates were not made');
  // A node that accepts the connection and never answers: only the caller's
  // cancellation ends the call before the client's own timeout.
  let connected: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => {
    connected = resolve;
  });
  const hole = createServer(() => connected());
  silent.push(hole);
  await new Promise<void>((resolve) =>
    hole.listen(0, '127.0.0.1', () => resolve()),
  );
  const address = hole.address();
  const port =
    typeof address === 'object' && address !== null ? address.port : 0;
  const runtime = new IncusRuntime(
    incusTestConfig({
      endpoint: `https://127.0.0.1:${port}`,
      clientCertFile: certs.client.certFile,
      clientKeyFile: certs.client.keyFile,
      serverCertFile: certs.server.certFile,
      apiTimeoutMs: 60_000,
    }),
  );
  // The fixtures live two days, inside the certificate expiry warning.
  const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const caller = new AbortController();
    const outcome = withOperationBudget(
      60_000,
      async () => (await runtime.connect()).client.getServer(),
      caller.signal,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    await reached;
    caller.abort(new Error('the request is over'));
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : '').toBe(
      'the request is over',
    );
  } finally {
    warn.mockRestore();
  }
});
