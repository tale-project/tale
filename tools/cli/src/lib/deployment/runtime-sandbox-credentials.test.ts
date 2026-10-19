import { afterEach, describe, expect, test } from 'bun:test';
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

import { SANDBOX_INCUS_FILES } from './runtime-sandbox';
import { assertIncusCredentials } from './runtime-sandbox-credentials';

const describePosix = describe.skipIf(process.platform === 'win32');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
/** A state directory with a credentials directory the check accepts. The
 * check walks the real ancestors, so the system temporary directory is
 * resolved first (it is a link on macOS). */
function layout() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'incus-credentials-')));
  roots.push(root);
  const state = join(root, 'state');
  const directory = join(state, 'sandbox-incus');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  for (const name of SANDBOX_INCUS_FILES)
    writeFileSync(join(directory, name), 'PEM-CONTENT-MARKER\n', {
      mode: 0o600,
    });
  return { state, directory };
}

describe('the Incus credentials check', () => {
  test('refuses a host that has no POSIX account ids before it looks at any file', () => {
    const account = process.getuid;
    const host = process as { getuid?: typeof account };
    host.getuid = undefined;
    try {
      expect(() => assertIncusCredentials('/state-that-is-not-read')).toThrow(
        'needs a POSIX host',
      );
    } finally {
      host.getuid = account;
    }
  });
});

describePosix('the Incus credentials check on a POSIX host', () => {
  test('accepts a private directory of three private files', () => {
    const { state } = layout();
    expect(() => assertIncusCredentials(state)).not.toThrow();
  });

  test('looks at metadata only and never puts file content in a message', () => {
    const { state, directory } = layout();
    chmodSync(join(directory, 'client.key'), 0o640);
    let message = '';
    try {
      assertIncusCredentials(state);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(join(directory, 'client.key'));
    expect(message).not.toContain('PEM-CONTENT-MARKER');
  });

  test('names the directory when it is missing', () => {
    const { state, directory } = layout();
    rmSync(directory, { recursive: true });
    expect(() => assertIncusCredentials(state)).toThrow(
      `credentials directory ${directory} is missing`,
    );
  });

  test('names the first file that is missing', () => {
    const { state, directory } = layout();
    rmSync(join(directory, 'client.crt'));
    expect(() => assertIncusCredentials(state)).toThrow(
      `credential file ${join(directory, 'client.crt')} is missing`,
    );
  });
});
