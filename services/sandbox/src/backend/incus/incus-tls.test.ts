// The files behind the Incus connection are checked at boot: a server
// certificate the TLS stack cannot pin, a key that is not the certificate's
// and an expired certificate each stop the spawner in words, not as an opaque
// handshake error on the first request.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readIncusTlsMaterial } from './incus-tls.ts';
import {
  makeTestCertificates,
  type TestCertificates,
} from './test-certificates.ts';

let certs: TestCertificates | null = null;
let warn: ReturnType<typeof spyOn<typeof console, 'warn'>>;

beforeAll(() => {
  certs = makeTestCertificates();
});

// The fixtures live two days, inside the two-week expiry warning: keep the
// suite's output to its own findings.
beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

afterAll(() => {
  certs?.dispose();
});

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the promise to reject');
}

describe('readIncusTlsMaterial', () => {
  test('hands back the three PEMs of a pinnable setup', async () => {
    if (certs === null) return;
    const material = await readIncusTlsMaterial({
      clientCertFile: certs.client.certFile,
      clientKeyFile: certs.client.keyFile,
      serverCertFile: certs.server.certFile,
    });
    expect(material).toEqual({
      ca: certs.server.cert,
      cert: certs.client.cert,
      key: certs.client.key,
    });
  });

  test('refuses the certificate shape Incus makes by default, and says why', async () => {
    if (certs === null) return;
    const message = await failure(
      readIncusTlsMaterial({
        clientCertFile: certs.client.certFile,
        clientKeyFile: certs.client.keyFile,
        serverCertFile: certs.incusDefault.certFile,
      }),
    );
    expect(message).toContain('SANDBOX_INCUS_SERVER_CERT_FILE');
    expect(message).toContain('CA:FALSE');
    expect(message).toContain('keyCertSign');
    expect(message).toContain('never turned off');
  });

  test('names the variable of a file that cannot be read', async () => {
    if (certs === null) return;
    const message = await failure(
      readIncusTlsMaterial({
        clientCertFile: join(certs.dir, 'absent.crt'),
        clientKeyFile: certs.client.keyFile,
        serverCertFile: certs.server.certFile,
      }),
    );
    expect(message).toContain('SANDBOX_INCUS_CLIENT_CERT_FILE');
    expect(message).toContain('absent.crt');
  });

  test('refuses a file that holds no certificate', async () => {
    if (certs === null) return;
    const notACertificate = join(certs.dir, 'not-a-cert.pem');
    writeFileSync(notACertificate, 'hello');
    const message = await failure(
      readIncusTlsMaterial({
        clientCertFile: certs.client.certFile,
        clientKeyFile: certs.client.keyFile,
        serverCertFile: notACertificate,
      }),
    );
    expect(message).toContain('SANDBOX_INCUS_SERVER_CERT_FILE');
    expect(message).toContain('no PEM certificate');
  });

  test('refuses a key that belongs to another certificate', async () => {
    if (certs === null) return;
    const message = await failure(
      readIncusTlsMaterial({
        clientCertFile: certs.client.certFile,
        clientKeyFile: certs.otherClient.keyFile,
        serverCertFile: certs.server.certFile,
      }),
    );
    expect(message).toContain('SANDBOX_INCUS_CLIENT_KEY_FILE');
    expect(message).toContain('private key');
  });

  test('refuses a key file that is not a key', async () => {
    if (certs === null) return;
    const message = await failure(
      readIncusTlsMaterial({
        clientCertFile: certs.client.certFile,
        clientKeyFile: certs.client.certFile,
        serverCertFile: certs.server.certFile,
      }),
    );
    expect(message).toContain('SANDBOX_INCUS_CLIENT_KEY_FILE');
  });

  test('refuses an expired certificate', async () => {
    if (certs === null) return;
    const later = Date.now() + 365 * 24 * 60 * 60 * 1000;
    const message = await failure(
      readIncusTlsMaterial(
        {
          clientCertFile: certs.client.certFile,
          clientKeyFile: certs.client.keyFile,
          serverCertFile: certs.server.certFile,
        },
        later,
      ),
    );
    expect(message).toContain('expired');
  });

  test('refuses a certificate that is not valid yet', async () => {
    if (certs === null) return;
    const earlier = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const message = await failure(
      readIncusTlsMaterial(
        {
          clientCertFile: certs.client.certFile,
          clientKeyFile: certs.client.keyFile,
          serverCertFile: certs.server.certFile,
        },
        earlier,
      ),
    );
    expect(message).toContain('not valid before');
  });

  test('warns, but carries on, when a certificate is close to its end', async () => {
    if (certs === null) return;
    await readIncusTlsMaterial({
      clientCertFile: certs.client.certFile,
      clientKeyFile: certs.client.keyFile,
      serverCertFile: certs.server.certFile,
    });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toContain('expires on');
  });
});
