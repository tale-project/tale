// Reading an instance's lifecycle from what Incus reports.

import { describe, expect, test } from 'bun:test';

import {
  INCUS_STATUS,
  type IncusInstance,
  type IncusInstanceState,
} from './incus-api.ts';
import {
  hasEnded,
  instanceAddress,
  isRunning,
  isStartingOrRunning,
  startupExpired,
  STARTUP_SLACK_MS,
} from './incus-lifecycle.ts';
import { LABEL } from './incus-naming.ts';

function state(network: IncusInstanceState['network']): IncusInstanceState {
  return { status: 'Running', statusCode: INCUS_STATUS.running, network };
}

function address(family: string, value: string, scope = 'global') {
  return { family, address: value, scope };
}

describe('instanceAddress', () => {
  test('is the IPv4 address on the session NIC', () => {
    expect(
      instanceAddress(
        state({
          lo: [address('inet', '127.0.0.1', 'local')],
          eth0: [
            address('inet6', 'fd42::2'),
            address('inet', '10.9.0.12'),
            address('inet6', 'fe80::1', 'link'),
          ],
        }),
      ),
    ).toBe('10.9.0.12');
  });

  test('prefers eth0 to another interface', () => {
    expect(
      instanceAddress(
        state({
          docker0: [address('inet', '172.17.0.1')],
          eth0: [address('inet', '10.9.0.12')],
        }),
      ),
    ).toBe('10.9.0.12');
  });

  test('is undefined while the instance has none, or only the loopback', () => {
    expect(instanceAddress(undefined)).toBeUndefined();
    expect(instanceAddress(state({}))).toBeUndefined();
    expect(
      instanceAddress(state({ lo: [address('inet', '127.0.0.1', 'local')] })),
    ).toBeUndefined();
    expect(
      instanceAddress(state({ eth0: [address('inet6', 'fd42::2')] })),
    ).toBeUndefined();
  });

  test('takes only what is an IPv4 address and has global scope', () => {
    expect(
      instanceAddress(
        state({
          eth0: [
            address('inet', '169.254.1.1', 'link'),
            address('inet', 'not-an-address'),
            address('inet', '10.9.0.13'),
          ],
        }),
      ),
    ).toBe('10.9.0.13');
  });
});

describe('statuses', () => {
  function instance(statusCode: number): IncusInstance {
    return {
      name: 'x',
      status: 'x',
      statusCode,
      ephemeral: true,
      config: {},
      devices: {},
      profiles: [],
      createdAt: '2026-10-11T12:00:00Z',
    };
  }

  test('running, starting and ended are told apart', () => {
    const running = instance(INCUS_STATUS.running);
    const starting = instance(INCUS_STATUS.starting);
    const stopping = instance(INCUS_STATUS.stopping);
    const stopped = instance(INCUS_STATUS.stopped);
    const failed = instance(INCUS_STATUS.error);
    expect(
      [running, starting, stopping, stopped, failed].map(isRunning),
    ).toEqual([true, false, false, false, false]);
    expect(
      [running, starting, stopping, stopped, failed].map(isStartingOrRunning),
    ).toEqual([true, true, false, false, false]);
    // An instance that is stopping is on its way out, not ended yet.
    expect(
      [running, starting, stopping, stopped, failed].map(hasEnded),
    ).toEqual([false, false, false, true, true]);
  });
});

describe('startupExpired', () => {
  const created = Date.parse('2026-10-11T12:00:00Z');
  function instance(config: Record<string, string>, createdAt: string) {
    return {
      name: 'x',
      status: 'Stopped',
      statusCode: INCUS_STATUS.stopped,
      ephemeral: false,
      config,
      devices: {},
      profiles: [],
      createdAt,
    };
  }
  const budget = 180_000;

  test('counts from the creator’s declared deadline, plus slack', () => {
    const deadline = created + 10 * 60_000;
    const subject = instance(
      {
        [LABEL.created]: String(created),
        [LABEL.startupDeadline]: String(deadline),
      },
      '2026-10-11T12:00:00Z',
    );
    expect(startupExpired(subject, deadline + STARTUP_SLACK_MS, budget)).toBe(
      false,
    );
    expect(
      startupExpired(subject, deadline + STARTUP_SLACK_MS + 1, budget),
    ).toBe(true);
  });

  test('falls back to the create timeout from the instance’s birth', () => {
    const subject = instance(
      { [LABEL.created]: String(created) },
      '2026-10-11T12:00:00Z',
    );
    expect(
      startupExpired(subject, created + budget + STARTUP_SLACK_MS, budget),
    ).toBe(false);
    expect(
      startupExpired(subject, created + budget + STARTUP_SLACK_MS + 1, budget),
    ).toBe(true);
  });

  test('ignores a declared deadline that precedes the birth', () => {
    const subject = instance(
      { [LABEL.created]: String(created), [LABEL.startupDeadline]: '5' },
      '2026-10-11T12:00:00Z',
    );
    expect(startupExpired(subject, created + 1_000, budget)).toBe(false);
  });

  test('keeps an instance created just now safe whatever stamp it carries', () => {
    // A creator's clock far in the past: Incus's creation time governs.
    const subject = instance({ [LABEL.created]: '1' }, '2026-10-11T12:00:00Z');
    expect(startupExpired(subject, created + 1_000, budget)).toBe(false);
  });

  test('is never true when Incus gave no creation time', () => {
    expect(startupExpired(instance({}, ''), Date.now() * 2, budget)).toBe(
      false,
    );
  });
});
