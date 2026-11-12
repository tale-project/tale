// Instance state changes (start, stop with its grace or forced, freeze,
// unfreeze) and the state reads (an instance's, the project's).

import { describe, expect, test } from 'bun:test';

import { INCUS_STATUS } from './api.ts';
import { FakeIncus } from './fake.ts';
import {
  freezeInstance,
  getInstanceState,
  getProjectState,
  startInstance,
  stopInstance,
  unfreezeInstance,
} from './state.ts';

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`rejected with a non-Error: ${String(error)}`, {
      cause: error,
    });
  }
  throw new Error('expected the promise to reject');
}

function setup() {
  const fake = new FakeIncus({ project: 'stack' });
  fake.seedInstance('db', {}, { ephemeral: false });
  return { fake, client: fake.client() };
}

describe('state changes', () => {
  test('a stop carries its grace and no force; a forced one says so', async () => {
    const { fake, client } = setup();
    await stopInstance(client, 'db', { timeoutSeconds: 60 });
    expect(fake.seen('PUT /1.0/instances/db/state')[0]?.body).toEqual({
      action: 'stop',
      force: false,
      stateful: false,
      timeout: 60,
    });
    await startInstance(client, 'db');
    fake.gracefulStopFails = true;
    expect(
      (await rejection(stopInstance(client, 'db', { timeoutSeconds: 1 })))
        .message,
    ).toContain('not shut down cleanly');
    await stopInstance(client, 'db', { timeoutSeconds: 1, force: true });
    expect(fake.seen('PUT /1.0/instances/db/state')[3]?.body).toMatchObject({
      action: 'stop',
      force: true,
    });
    expect(fake.instances.get('db')?.status).toBe('Stopped');
  });

  test('a stop timeout that is not whole seconds is refused', async () => {
    const { fake, client } = setup();
    expect(
      (await rejection(stopInstance(client, 'db', { timeoutSeconds: 1.5 })))
        .message,
    ).toContain('stop timeout');
    expect(
      (await rejection(stopInstance(client, 'db', { timeoutSeconds: -2 })))
        .message,
    ).toContain('stop timeout');
    expect(
      (await rejection(stopInstance(client, 'db', { timeoutSeconds: -1 })))
        .message,
    ).toContain('waitMs');
    expect(fake.requests).toEqual([]);
  });

  test('freeze holds a running instance, unfreeze lets it go', async () => {
    const { fake, client } = setup();
    await freezeInstance(client, 'db');
    expect(fake.seen('PUT /1.0/instances/db/state')[0]?.body).toMatchObject({
      action: 'freeze',
    });
    const frozen = await getInstanceState(client, 'db');
    expect(frozen.status).toBe('Frozen');
    expect(frozen.statusCode).toBe(INCUS_STATUS.frozen);
    expect((await rejection(freezeInstance(client, 'db'))).message).toContain(
      'running',
    );
    await unfreezeInstance(client, 'db');
    expect((await getInstanceState(client, 'db')).status).toBe('Running');
    expect((await rejection(unfreezeInstance(client, 'db'))).message).toContain(
      'frozen',
    );
  });
});

describe('state reads', () => {
  test('a running instance’s state carries its addresses; a stopped one none', async () => {
    const { client } = setup();
    const state = await getInstanceState(client, 'db');
    expect(state.statusCode).toBe(INCUS_STATUS.running);
    expect(state.network.eth0?.[0]?.family).toBe('inet');
    await stopInstance(client, 'db', { timeoutSeconds: 5 });
    const stopped = await getInstanceState(client, 'db');
    expect(stopped.status).toBe('Stopped');
    expect(stopped.network).toEqual({});
  });

  test('the project’s usage against its limits; -1 is no limit', async () => {
    const { fake, client } = setup();
    fake.projectConfig['limits.disk'] = '50GiB';
    fake.seedVolume('v', { size: '10GiB' });
    const state = await getProjectState(client);
    expect(state.resources.disk).toEqual({
      limit: 50 * 1024 ** 3,
      usage: 10 * 1024 ** 3,
    });
    expect(state.resources.instances).toEqual({ limit: -1, usage: 1 });
    expect(fake.seen('GET /1.0/projects/stack/state')).toHaveLength(1);
  });
});
