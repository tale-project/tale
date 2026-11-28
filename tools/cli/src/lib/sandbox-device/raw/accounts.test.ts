import { describe, expect, test } from 'bun:test';

import { readAccount, slotName } from './accounts';
import type { RawHost } from './host';

function host(os: NodeJS.Platform, answers: Record<string, string>): RawHost {
  return {
    run: async (argv) => {
      const key = argv.join(' ');
      const stdout = answers[key];
      return stdout === undefined
        ? { code: 2, stdout: '', stderr: `unknown: ${key}` }
        : { code: 0, stdout, stderr: '' };
    },
    isRoot: () => true,
    uid: () => 0,
    os: () => os,
    home: () => '/root',
    user: () => 'root',
    execPath: () => '/usr/local/bin/tale',
  };
}

describe('slot accounts', () => {
  test('are named alike on both systems, hidden on macOS', () => {
    expect(slotName('linux', 3)).toBe('tale-slot-03');
    expect(slotName('darwin', 12)).toBe('_tale-slot-12');
  });

  test('read an account from passwd on Linux', async () => {
    const linux = host('linux', {
      'getent passwd tale-slot-01':
        'tale-slot-01:x:998:998:Tale sandbox slot:/var/lib/tale-sandbox/slots/tale-slot-01:/usr/sbin/nologin\n',
    });
    expect(await readAccount(linux, 'tale-slot-01')).toEqual({
      user: 'tale-slot-01',
      uid: 998,
      gid: 998,
      home: '/var/lib/tale-sandbox/slots/tale-slot-01',
    });
  });

  test('read an account from the directory service on macOS', async () => {
    const mac = host('darwin', {
      'dscl . -read /Users/_tale-slot-01 UniqueID PrimaryGroupID NFSHomeDirectory':
        'NFSHomeDirectory: /usr/local/var/tale-sandbox/slots/_tale-slot-01\nPrimaryGroupID: 470\nUniqueID: 470\n',
    });
    expect(await readAccount(mac, '_tale-slot-01')).toEqual({
      user: '_tale-slot-01',
      uid: 470,
      gid: 470,
      home: '/usr/local/var/tale-sandbox/slots/_tale-slot-01',
    });
  });

  test('refuse a name that is no account name', async () => {
    await expect(
      readAccount(host('linux', {}), 'root; rm -rf /'),
    ).rejects.toThrow(/not an account name/);
  });
});
