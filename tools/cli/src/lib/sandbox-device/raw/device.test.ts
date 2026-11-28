import { describe, expect, test } from 'bun:test';

import { planRawDevice, rawJoinPlatform, rawMaxSessions } from './device';

const root = { isRoot: () => true, os: () => 'linux' as const };
const user = { isRoot: () => false, os: () => 'darwin' as const };

describe('planning a raw device', () => {
  test('root gets an isolated device in the system directory', () => {
    const plan = planRawDevice({ service: true }, root, '/root/.tale/sandbox');
    expect(plan).toMatchObject({
      isolation: 'isolated',
      root: '/var/lib/tale-sandbox',
      path: ['/opt/tale-agents/bin'],
      service: 'systemd-system',
    });
  });

  test('a user gets a shared device in the device home, as a user service', () => {
    const plan = planRawDevice(
      { service: true },
      user,
      '/Users/a/.tale/sandbox',
    );
    expect(plan).toMatchObject({
      isolation: 'shared',
      root: '/Users/a/.tale/sandbox',
      service: 'launchd-agent',
    });
  });

  test('refuses isolation without root, and a shared device as root', () => {
    expect(() =>
      planRawDevice({ service: true, isolation: 'isolated' }, user, '/u'),
    ).toThrow(/takes root/);
    expect(() =>
      planRawDevice({ service: true, isolation: 'shared' }, root, '/r'),
    ).toThrow(/never as root/);
  });

  test('refuses a directory a session view cannot carry, and slots of a shared device', () => {
    expect(() =>
      planRawDevice({ service: true, root: '/var/lib/my sandbox' }, root, '/r'),
    ).toThrow(/plain absolute path/);
    expect(() =>
      planRawDevice({ service: true, slots: ['a'] }, user, '/u'),
    ).toThrow(/isolated device/);
    expect(() =>
      planRawDevice({ service: true, path: ['relative'] }, root, '/r'),
    ).toThrow(/absolute/);
  });

  test('--no-service leaves the service to the machine', () => {
    expect(planRawDevice({ service: false }, root, '/r').service).toBe('none');
  });

  test('an isolated device runs no more sessions than it has slots', () => {
    const plan = planRawDevice({ service: true }, root, '/r');
    expect(rawMaxSessions(8, plan, 3)).toBe(3);
    expect(rawMaxSessions(2, plan, 3)).toBe(2);
    expect(rawJoinPlatform(plan, root)).toMatchObject({
      os: 'linux',
      runtime: 'raw',
      isolation: 'isolated',
      dockerVersion: null,
    });
  });
});
