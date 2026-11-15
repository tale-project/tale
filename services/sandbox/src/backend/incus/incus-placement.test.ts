// Where a new session goes among several Incus hosts: the most headroom
// across the session cap, memory and disk, never a drained host or one that
// cannot be asked, and the room each host's project states.

import { describe, expect, test } from 'bun:test';

import { FakeIncus } from '@tale/incus/fake';

import {
  chooseEndpoint,
  type EndpointCandidate,
  judgeRoom,
  readProjectRoom,
  withStandbysFreed,
} from './incus-placement.ts';
import { rejection } from './incus-test-support.ts';

const GIB = 1024 ** 3;
const NEED = { memoryBytes: 2 * GIB, diskBytes: 10 * GIB };

function host(
  name: string,
  room: Partial<NonNullable<EndpointCandidate['room']>> = {},
  extra: Partial<EndpointCandidate> = {},
): EndpointCandidate {
  return {
    name,
    drained: false,
    room: { sessions: 0, maxSessions: 10, ...room },
    ...extra,
  };
}

describe('choosing a host', () => {
  test('takes the host with the most sessions left under its cap', () => {
    const placement = chooseEndpoint(
      [
        host('a', { sessions: 6, maxSessions: 10 }),
        host('b', { sessions: 2, maxSessions: 10 }),
        host('c', { sessions: 5, maxSessions: 20 }),
      ],
      NEED,
    );
    expect(placement.chosen).toBe('b');
    expect(placement.headroom).toBeCloseTo(0.7);
  });

  test('takes the tightest bound of each host: memory can outweigh free slots', () => {
    const placement = chooseEndpoint(
      [
        host('slots', {
          sessions: 1,
          memory: { free: 4 * GIB, limit: 40 * GIB },
        }),
        host('memory', {
          sessions: 5,
          memory: { free: 30 * GIB, limit: 40 * GIB },
        }),
      ],
      NEED,
    );
    // slots: min(8/10, 2/40) = 0.05; memory: min(4/10, 28/40) = 0.4
    expect(placement.chosen).toBe('memory');
  });

  test('passes over a drained host, one that cannot be asked, and one without room', () => {
    const placement = chooseEndpoint(
      [
        host('drained', {}, { drained: true }),
        {
          name: 'down',
          drained: false,
          unavailable: 'unreachable: ECONNREFUSED',
        },
        host('capped', { sessions: 10, maxSessions: 10 }),
        host('short', { memory: { free: GIB, limit: 64 * GIB } }),
        host('full-disk', { disk: { free: 5 * GIB, limit: 500 * GIB } }),
      ],
      NEED,
    );
    expect(placement.chosen).toBeUndefined();
    expect(placement.skipped).toEqual([
      { name: 'drained', reason: 'drained', full: false },
      { name: 'down', reason: 'unreachable: ECONNREFUSED', full: false },
      {
        name: 'capped',
        reason: 'its session cap is reached (10/10)',
        full: true,
      },
      {
        name: 'short',
        reason:
          'its project has 1.0 GiB of memory left and a session takes 2.0 GiB',
        full: true,
      },
      {
        name: 'full-disk',
        reason: 'it has 5.0 GiB of disk left and a workspace takes 10.0 GiB',
        full: true,
      },
    ]);
  });

  test('the first declared host wins a tie', () => {
    expect(chooseEndpoint([host('a'), host('b')], NEED).chosen).toBe('a');
  });

  test('a bound a host does not state is not guessed', () => {
    expect(judgeRoom({ sessions: 3, maxSessions: 4 }, NEED)).toEqual({
      headroom: 0,
    });
  });
});

describe("a host's room", () => {
  test("is its project's memory and disk limits, less what they hold", async () => {
    const fake = new FakeIncus();
    fake.projectConfig = {
      ...fake.projectConfig,
      'limits.memory': '16GiB',
      'limits.disk': '100GiB',
    };
    fake.seedInstance('tale-sbx-ses-a', { 'limits.memory': '4GiB' });
    fake.seedVolume('tale-ses-ws-a', { size: '10GiB' });
    expect(await readProjectRoom(fake.client(), 'tank', 'node-1')).toEqual({
      memory: { free: 12 * GIB, limit: 16 * GIB },
      disk: { free: 90 * GIB, limit: 100 * GIB },
    });
  });

  test('leaves out what the project does not limit', async () => {
    const fake = new FakeIncus();
    fake.fail({
      match: 'GET /1.0/storage-pools/*/resources',
      status: 403,
      message: 'not authorized',
      times: 3,
    });
    expect(await readProjectRoom(fake.client(), 'tank', 'node-1')).toEqual({});
  });

  test('throws when the project state cannot be read', async () => {
    const fake = new FakeIncus();
    fake.fail({
      match: 'GET /1.0/projects/*/state',
      status: 500,
      message: 'down',
      times: 3,
    });
    const err = await rejection(
      readProjectRoom(fake.client(), 'tank', 'node-1'),
    );
    expect(err.message).toContain('down');
  });
});

describe('the warm standbys of a host', () => {
  test('give their memory back to the sessions: a full pool leaves the host its cap', () => {
    // A cap of 10 at 2 GiB each, the project limited to 20 GiB: 8 sessions
    // and 2 standbys fill it, yet a create takes a standby over.
    const memory = { free: 0, limit: 20 * GIB };
    const before = judgeRoom({ sessions: 8, maxSessions: 10, memory }, NEED);
    expect('reason' in before ? before.reason : '').toContain('memory left');
    const freed = withStandbysFreed(memory, 2, 2 * GIB);
    expect(freed).toEqual({ free: 4 * GIB, limit: 20 * GIB });
    const after = judgeRoom(
      { sessions: 8, maxSessions: 10, memory: freed },
      NEED,
    );
    expect('headroom' in after ? after.headroom : -1).toBeCloseTo(0.1);
  });

  test('never free more than the limit, and leave an unlimited project unbounded', () => {
    expect(
      withStandbysFreed({ free: 18 * GIB, limit: 20 * GIB }, 3, 2 * GIB),
    ).toEqual({
      free: 20 * GIB,
      limit: 20 * GIB,
    });
    expect(withStandbysFreed(undefined, 3, 2 * GIB)).toBeUndefined();
    const room = { free: GIB, limit: 20 * GIB };
    expect(withStandbysFreed(room, 0, 2 * GIB)).toBe(room);
  });
});
