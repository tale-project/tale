import { chmod, chown, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { must, type RawHost } from './host';

/**
 * The slot accounts of an isolated raw device: each running session runs as
 * one of them, so sessions cannot read one another's files or signal one
 * another's processes, and ending a session ends every process of its
 * account. `connect --isolation isolated` makes them (or takes the ones
 * `--slot` names, made by whoever manages the machine, such as hostkit), and
 * `disconnect` removes the ones it made.
 */
export interface SlotAccount {
  user: string;
  uid: number;
  gid: number;
  home: string;
}

const ACCOUNT_NAME = /^[a-z_][a-z0-9_-]{0,31}$/;

/** `tale-slot-01`, or on macOS the hidden-account spelling `_tale-slot-01`. */
export function slotName(os: NodeJS.Platform, index: number): string {
  const name = `tale-slot-${String(index).padStart(2, '0')}`;
  return os === 'darwin' ? `_${name}` : name;
}

/** Read an existing account: its ids and home. */
export async function readAccount(
  host: RawHost,
  user: string,
): Promise<SlotAccount> {
  if (!ACCOUNT_NAME.test(user)) {
    throw new Error(`"${user}" is not an account name`);
  }
  if (host.os() === 'darwin') {
    const text = await must(
      host,
      [
        'dscl',
        '.',
        '-read',
        `/Users/${user}`,
        'UniqueID',
        'PrimaryGroupID',
        'NFSHomeDirectory',
      ],
      `reading the account ${user}`,
    );
    const value = (key: string) =>
      new RegExp(`^${key}:\\s*(\\S+)`, 'm').exec(text)?.[1];
    const uid = Number(value('UniqueID'));
    const gid = Number(value('PrimaryGroupID'));
    const home = value('NFSHomeDirectory');
    if (
      !Number.isInteger(uid) ||
      !Number.isInteger(gid) ||
      home === undefined
    ) {
      throw new Error(`the account ${user} has no ids or home`);
    }
    return { user, uid, gid, home };
  }
  const line = (
    await must(host, ['getent', 'passwd', user], `reading the account ${user}`)
  ).trim();
  const fields = line.split(':');
  const uid = Number(fields[2]);
  const gid = Number(fields[3]);
  const home = fields[5];
  if (
    fields.length < 7 ||
    !Number.isInteger(uid) ||
    !Number.isInteger(gid) ||
    !home
  ) {
    throw new Error(`the account ${user} reads as "${line}"`);
  }
  return { user, uid, gid, home };
}

/** Free ids below 500 on macOS, where hidden service accounts live. */
async function freeMacIds(host: RawHost, count: number): Promise<number[]> {
  const used = new Set<number>();
  for (const [path, key] of [
    ['/Users', 'UniqueID'],
    ['/Groups', 'PrimaryGroupID'],
  ] as const) {
    const text = await must(
      host,
      ['dscl', '.', '-list', path, key],
      `listing the ${path.slice(1).toLowerCase()}`,
    );
    for (const line of text.split('\n')) {
      const id = Number(line.trim().split(/\s+/).pop());
      if (Number.isInteger(id)) used.add(id);
    }
  }
  const out: number[] = [];
  for (let id = 470; id > 300 && out.length < count; id -= 1) {
    if (!used.has(id)) out.push(id);
  }
  if (out.length < count) {
    throw new Error('no free account ids left below 500 for the slot accounts');
  }
  return out;
}

/** Make `count` slot accounts with homes under `root/slots`, or take the
 * ones that already exist under their names. */
export async function makeSlotAccounts(
  host: RawHost,
  root: string,
  count: number,
): Promise<SlotAccount[]> {
  const os = host.os();
  const names = Array.from({ length: count }, (_, i) => slotName(os, i + 1));
  const ids = os === 'darwin' ? await freeMacIds(host, count) : [];
  const out: SlotAccount[] = [];
  for (const [index, user] of names.entries()) {
    const home = join(root, 'slots', user);
    const exists = (await host.run(['id', '-u', user])).code === 0;
    if (!exists) {
      if (os === 'darwin') {
        const id = ids[index];
        if (id === undefined) throw new Error('out of account ids');
        for (const argv of [
          ['dscl', '.', '-create', `/Groups/${user}`],
          [
            'dscl',
            '.',
            '-create',
            `/Groups/${user}`,
            'PrimaryGroupID',
            String(id),
          ],
          ['dscl', '.', '-create', `/Groups/${user}`, 'Password', '*'],
          ['dscl', '.', '-create', `/Users/${user}`],
          ['dscl', '.', '-create', `/Users/${user}`, 'UniqueID', String(id)],
          [
            'dscl',
            '.',
            '-create',
            `/Users/${user}`,
            'PrimaryGroupID',
            String(id),
          ],
          [
            'dscl',
            '.',
            '-create',
            `/Users/${user}`,
            'UserShell',
            '/usr/bin/false',
          ],
          ['dscl', '.', '-create', `/Users/${user}`, 'NFSHomeDirectory', home],
          [
            'dscl',
            '.',
            '-create',
            `/Users/${user}`,
            'RealName',
            'Tale sandbox slot',
          ],
          ['dscl', '.', '-create', `/Users/${user}`, 'Password', '*'],
          ['dscl', '.', '-create', `/Users/${user}`, 'IsHidden', '1'],
        ]) {
          await must(host, argv, `making the slot account ${user}`);
        }
      } else {
        await must(
          host,
          [
            'useradd',
            '--system',
            '--user-group',
            '--no-create-home',
            '--home-dir',
            home,
            '--shell',
            '/usr/sbin/nologin',
            '--comment',
            'Tale sandbox slot',
            user,
          ],
          `making the slot account ${user}`,
        );
      }
    }
    const account = await readAccount(host, user);
    await mkdir(account.home, { recursive: true, mode: 0o700 });
    await chown(account.home, account.uid, account.gid);
    await chmod(account.home, 0o700);
    out.push(account);
  }
  return out;
}

/** Remove slot accounts this CLI made. */
export async function removeSlotAccounts(
  host: RawHost,
  slots: readonly SlotAccount[],
): Promise<void> {
  for (const slot of slots) {
    if (host.os() === 'darwin') {
      await host.run(['dscl', '.', '-delete', `/Users/${slot.user}`]);
      await host.run(['dscl', '.', '-delete', `/Groups/${slot.user}`]);
    } else {
      const removed = await host.run(['userdel', slot.user]);
      if (removed.code !== 0 && removed.code !== 6) {
        console.warn(
          `[tale] could not remove the slot account ${slot.user}: ${removed.stderr.trim()}`,
        );
      }
    }
  }
}
