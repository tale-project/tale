// Taking an instance away: the stop, the wait for an ephemeral instance to
// delete itself, the delete of one that stays, and the check that the
// instance removed is the one that was meant.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { FakeIncus } from './fake-incus.ts';
import { removeIncusInstance } from './incus-remove.ts';
import { rejection } from './incus-test-support.ts';

let warn: ReturnType<typeof spyOn<typeof console, 'warn'>>;

beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

const NAME = 'tale-sbx-ses-aaaaaaaaaaaaaaaaaaaaaaaa';
const instant = async () => undefined;

function stops(fake: FakeIncus) {
  return fake.seen('PUT /1.0/instances/*/state').map((r) => r.body);
}

describe('removeIncusInstance', () => {
  test('answers absent for an instance that is not there, touching nothing', async () => {
    const fake = new FakeIncus();
    expect(
      await removeIncusInstance(fake.client(), NAME, { sleep: instant }),
    ).toBe('absent');
    expect(stops(fake)).toEqual([]);
  });

  test('stops a running ephemeral instance by force and leaves its deletion to Incus', async () => {
    const fake = new FakeIncus();
    fake.seedInstance(NAME, {});
    expect(
      await removeIncusInstance(fake.client(), NAME, { sleep: instant }),
    ).toBe('removed');
    expect(stops(fake)).toEqual([
      { action: 'stop', force: true, stateful: false, timeout: -1 },
    ]);
    expect(fake.seen('DELETE /1.0/instances/*')).toHaveLength(0);
    expect(fake.instances.has(NAME)).toBe(false);
  });

  test('gives a graceful stop the grace first, then forces what is left', async () => {
    const fake = new FakeIncus();
    fake.seedInstance(NAME, {});
    const removed = await removeIncusInstance(fake.client(), NAME, {
      sleep: instant,
      graceMs: 20_000,
    });
    expect(removed).toBe('removed');
    // The graceful stop ended it; the forced one finds it stopped (or gone)
    // and is not an error.
    expect(stops(fake)[0]).toMatchObject({
      action: 'stop',
      force: false,
      timeout: 20,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  test('forces the stop when the graceful one fails, and says so', async () => {
    const fake = new FakeIncus();
    fake.gracefulStopFails = true;
    fake.seedInstance(NAME, {});
    expect(
      await removeIncusInstance(fake.client(), NAME, {
        sleep: instant,
        graceMs: 5_000,
      }),
    ).toBe('removed');
    expect(stops(fake)).toMatchObject([{ force: false }, { force: true }]);
    expect(String(warn.mock.calls[0]?.[0])).toContain('graceful stop');
  });

  test('deletes an instance that stays after its stop', async () => {
    const fake = new FakeIncus();
    fake.seedInstance(NAME, {}, { ephemeral: false });
    expect(
      await removeIncusInstance(fake.client(), NAME, { sleep: instant }),
    ).toBe('removed');
    expect(fake.seen('DELETE /1.0/instances/*')).toHaveLength(1);
    expect(fake.instances.has(NAME)).toBe(false);
  });

  test('deletes an instance nothing deletes for it at once, without waiting', async () => {
    const fake = new FakeIncus();
    fake.seedInstance(NAME, {}, { ephemeral: false });
    const sleeps: number[] = [];
    expect(
      await removeIncusInstance(fake.client(), NAME, {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
    ).toBe('removed');
    expect(sleeps).toEqual([]);
    // The reads, the stop and the delete, in that order, apart from the
    // waits on the operations the last two start.
    expect(
      fake.requests
        .map((r) => `${r.method} ${r.path.split('/').at(-1)}`)
        .filter((entry) => entry !== 'GET wait'),
    ).toEqual(['GET ' + NAME, 'PUT state', 'DELETE ' + NAME, 'GET ' + NAME]);
  });

  test('tries again, from its polls, a delete that failed', async () => {
    const fake = new FakeIncus();
    fake.seedInstance(NAME, {}, { ephemeral: false });
    fake.fail({
      match: 'DELETE /1.0/instances/*',
      status: 500,
      message: 'storage is busy',
    });
    expect(
      await removeIncusInstance(fake.client(), NAME, { sleep: instant }),
    ).toBe('removed');
    expect(fake.seen('DELETE /1.0/instances/*')).toHaveLength(2);
    expect(String(warn.mock.calls[0]?.[0])).toContain('deleting');
  });

  test('removes a stopped instance without stopping it again', async () => {
    const fake = new FakeIncus();
    fake.seedInstance(NAME, {}, { ephemeral: false, status: 'Stopped' });
    expect(
      await removeIncusInstance(fake.client(), NAME, { sleep: instant }),
    ).toBe('removed');
    expect(stops(fake)).toEqual([]);
  });

  test('leaves an instance that is not the one meant, from the start', async () => {
    const fake = new FakeIncus();
    const seeded = fake.seedInstance(NAME, {});
    expect(
      await removeIncusInstance(fake.client(), NAME, {
        sleep: instant,
        createdAt: `${seeded.createdAt}-another`,
      }),
    ).toBe('replaced');
    expect(stops(fake)).toEqual([]);
    expect(fake.instances.has(NAME)).toBe(true);
  });

  test('removes the instance meant when its creation time is given', async () => {
    const fake = new FakeIncus();
    const seeded = fake.seedInstance(NAME, {});
    expect(
      await removeIncusInstance(fake.client(), NAME, {
        sleep: instant,
        createdAt: seeded.createdAt,
      }),
    ).toBe('removed');
  });

  test('reports a replacement that took the name while the instance went', async () => {
    const fake = new FakeIncus();
    const seeded = fake.seedInstance(NAME, {}, { ephemeral: false });
    // A peer makes the name's next instance the moment this one is gone.
    fake.onDeleted = () => {
      fake.onDeleted = undefined;
      fake.seedInstance(NAME, {});
    };
    expect(
      await removeIncusInstance(fake.client(), NAME, {
        sleep: instant,
        createdAt: seeded.createdAt,
      }),
    ).toBe('replaced');
    // The replacement runs on.
    expect(fake.instances.get(NAME)?.status).toBe('Running');
  });

  test('throws when the instance cannot be made to go', async () => {
    const fake = new FakeIncus();
    fake.seedInstance(NAME, {});
    fake.fail({
      match: 'PUT /1.0/instances/*/state',
      status: 500,
      message: 'cannot stop',
      times: 10,
    });
    fake.fail({
      match: 'DELETE /1.0/instances/*',
      status: 500,
      message: 'cannot delete',
      times: 10,
    });
    const error = await rejection(
      removeIncusInstance(fake.client(), NAME, { sleep: instant }),
    );
    expect(error.message).toContain('still there after its removal');
    expect(fake.instances.has(NAME)).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});
