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
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  makeTestCertificates,
  type TestCertificate,
  type TestCertificates,
} from '@tale/incus/test-certificates';

import { CliError, ExitCode } from '../../../utils/fail';
import {
  INCUS_DIRECTORY_VARIABLE,
  managedIncusDirectory,
  readIncusCredentials,
  workspaceIncusDirectory,
} from './credentials';

const describePosix = describe.skipIf(process.platform === 'win32');

let made: TestCertificates | undefined;
let warn: ReturnType<typeof spyOn<typeof console, 'warn'>>;
const roots: string[] = [];

beforeAll(async () => {
  made = await makeTestCertificates();
});
afterAll(() => {
  made?.dispose();
});
// The fixtures live two days, inside the two-week expiry warning.
beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function certificates(): TestCertificates {
  if (made === undefined) throw new Error('the certificates were not made');
  return made;
}

/** A private credentials directory holding the given client and server. The
 * custody check walks real ancestors, so the temporary root is resolved. */
function directory(
  client: TestCertificate,
  server: TestCertificate,
  mode = 0o600,
): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tale-incus-creds-')));
  roots.push(root);
  const target = join(root, '.tale', 'incus');
  mkdirSync(target, { recursive: true, mode: 0o700 });
  chmodSync(target, 0o700);
  for (const [name, content] of [
    ['client.crt', client.cert],
    ['client.key', client.key],
    ['server.crt', server.cert],
  ] as const) {
    writeFileSync(join(target, name), content, { mode });
    chmodSync(join(target, name), mode);
  }
  return target;
}

async function refusal(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('where the Incus credentials live', () => {
  test('a workspace keeps them in .tale/incus', () => {
    expect(workspaceIncusDirectory('/srv/acme', {})).toBe(
      join('/srv/acme', '.tale', 'incus'),
    );
  });

  test('TALE_INCUS_DIR moves them, to an absolute directory only', () => {
    expect(
      workspaceIncusDirectory('/srv/acme', {
        [INCUS_DIRECTORY_VARIABLE]: '/etc/tale/incus',
      }),
    ).toBe('/etc/tale/incus');
    expect(() =>
      workspaceIncusDirectory('/srv/acme', {
        [INCUS_DIRECTORY_VARIABLE]: 'relative/incus',
      }),
    ).toThrow('absolute');
  });

  test('a managed deployment keeps them beside the spawner credentials', () => {
    expect(managedIncusDirectory('/opt/tale-acme')).toBe(
      join('/opt/tale-acme', 'incus'),
    );
  });
});

describePosix('reading the Incus credentials', () => {
  test('hands back the material of a private, pinnable directory', async () => {
    const certs = certificates();
    expect(
      await readIncusCredentials(directory(certs.client, certs.server)),
    ).toEqual({
      ca: certs.server.cert,
      cert: certs.client.cert,
      key: certs.client.key,
    });
  });

  test('refuses files open to group or others (0600 enforced)', async () => {
    const certs = certificates();
    const error = await refusal(
      readIncusCredentials(directory(certs.client, certs.server, 0o644)),
    );
    expect(error.info.code).toBe(ExitCode.Precondition);
    expect(error.message).toContain('mode 0600');
  });

  test('names a missing directory and how to fill it', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'tale-incus-none-')));
    roots.push(root);
    const error = await refusal(readIncusCredentials(join(root, 'incus')));
    expect(error.message).toContain('is missing');
    expect(error.message).toContain(INCUS_DIRECTORY_VARIABLE);
  });

  test('refuses a server certificate the connection cannot pin', async () => {
    const certs = certificates();
    const error = await refusal(
      readIncusCredentials(directory(certs.client, certs.incusDefault)),
    );
    expect(error.info.code).toBe(ExitCode.Precondition);
    expect(error.message).toContain('CA:FALSE');
    expect(error.message).not.toContain('SANDBOX_INCUS_');
  });

  test('refuses a key that belongs to another certificate', async () => {
    const certs = certificates();
    const mixed = { ...certs.client, key: certs.otherClient.key };
    const error = await refusal(
      readIncusCredentials(directory(mixed, certs.server)),
    );
    expect(error.message).toContain('private key');
  });
});
