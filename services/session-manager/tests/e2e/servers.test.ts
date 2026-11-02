import { describe, expect, it } from 'vitest';

import {
  addressOf,
  describePlan,
  E2eSetupError,
  healthUrl,
  planFrom,
  serverSettings,
  soloAddress,
} from './servers.ts';

describe('planFrom', () => {
  it('runs four workers on four servers from port 3204 on a machine with cores to spare', () => {
    expect(planFrom({}, 12)).toEqual({
      backendPort: 3204,
      controlPort: 4204,
      workers: 4,
      servers: 4,
      baseUrl: undefined,
    });
  });

  it('runs as many workers as there are cores when there are fewer than four', () => {
    expect(planFrom({}, 2)).toMatchObject({ workers: 2, servers: 2 });
    expect(planFrom({}, 1)).toMatchObject({ workers: 1, servers: 1 });
    expect(planFrom({}, 4)).toMatchObject({ workers: 4, servers: 4 });
  });

  it('still runs one worker when the core count is nonsense', () => {
    expect(planFrom({}, 0)).toMatchObject({ workers: 1 });
    expect(planFrom({}, Number.NaN)).toMatchObject({ workers: 1 });
  });

  it('takes the worker count from E2E_WORKERS, however many cores there are', () => {
    expect(planFrom({ E2E_WORKERS: '8' }, 2)).toMatchObject({
      workers: 8,
      servers: 8,
    });
    expect(planFrom({ E2E_WORKERS: '1' }, 12)).toMatchObject({
      workers: 1,
      servers: 1,
    });
  });

  it('takes the workers from E2E_SERVERS when only the servers are set', () => {
    expect(planFrom({ E2E_SERVERS: '3' }, 12)).toMatchObject({
      workers: 3,
      servers: 3,
    });
  });

  it('may start more servers than there are workers, never fewer', () => {
    expect(planFrom({ E2E_WORKERS: '2', E2E_SERVERS: '4' }, 12)).toMatchObject({
      workers: 2,
      servers: 4,
    });
    expect(() => planFrom({ E2E_WORKERS: '4', E2E_SERVERS: '2' }, 12)).toThrow(
      /E2E_WORKERS=4 needs a server for each worker, but E2E_SERVERS=2/,
    );
  });

  it('moves the servers with E2E_BACKEND_PORT, the control servers a thousand above', () => {
    const plan = planFrom({ E2E_BACKEND_PORT: '3260' }, 12);
    expect(plan).toMatchObject({ backendPort: 3260, controlPort: 4260 });
    expect(addressOf(plan, 3)).toMatchObject({
      port: 3263,
      controlPort: 4263,
    });
  });

  it('starts the control servers at E2E_CONTROL_PORT when it is set', () => {
    const plan = planFrom({ E2E_CONTROL_PORT: '5000', E2E_WORKERS: '2' }, 12);
    expect(addressOf(plan, 0).controlPort).toBe(5000);
    expect(addressOf(plan, 1).controlPort).toBe(5001);
  });

  it('treats an empty setting as not set', () => {
    expect(
      planFrom(
        {
          E2E_BACKEND_PORT: '',
          E2E_CONTROL_PORT: ' ',
          E2E_WORKERS: '',
          E2E_SERVERS: '',
          E2E_BASE_URL: '',
        },
        12,
      ),
    ).toEqual(planFrom({}, 12));
  });

  it.each([
    ['E2E_WORKERS', 'many'],
    ['E2E_WORKERS', '0'],
    ['E2E_WORKERS', '-2'],
    ['E2E_WORKERS', '2.5'],
    ['E2E_WORKERS', '65'],
    ['E2E_SERVERS', '0'],
    ['E2E_BACKEND_PORT', '0'],
    ['E2E_BACKEND_PORT', 'http'],
    ['E2E_BACKEND_PORT', '65536'],
    ['E2E_CONTROL_PORT', '-1'],
  ])('refuses %s=%s with a sentence that names the setting', (name, value) => {
    expect(() => planFrom({ [name]: value }, 12)).toThrow(E2eSetupError);
    expect(() => planFrom({ [name]: value }, 12)).toThrow(
      new RegExp(`${name} must be a whole number`),
    );
  });

  it('keeps the dev server to one worker: it is one place for the page to go', () => {
    const dev = { E2E_BASE_URL: 'http://localhost:3004' };
    expect(planFrom(dev, 12)).toMatchObject({
      workers: 1,
      servers: 1,
      baseUrl: 'http://localhost:3004',
    });
    expect(planFrom({ ...dev, E2E_WORKERS: '1' }, 12)).toMatchObject({
      workers: 1,
    });
    expect(() => planFrom({ ...dev, E2E_WORKERS: '2' }, 12)).toThrow(
      /E2E_BASE_URL sends every worker to the same dev server.*E2E_WORKERS=1/,
    );
    expect(() => planFrom({ ...dev, E2E_SERVERS: '2' }, 12)).toThrow(
      /E2E_WORKERS=1/,
    );
  });

  it('refuses servers that would run past the last port', () => {
    expect(() =>
      planFrom({ E2E_BACKEND_PORT: '65534', E2E_WORKERS: '4' }, 12),
    ).toThrow(/run past port 65535/);
    expect(() =>
      planFrom(
        {
          E2E_BACKEND_PORT: '3204',
          E2E_CONTROL_PORT: '65534',
          E2E_WORKERS: '4',
        },
        12,
      ),
    ).toThrow(/run past port 65535/);
  });

  it('refuses backend and control ports that overlap', () => {
    // 3204-3207 and 3206-3209 would give a backend and a control server one port.
    expect(() =>
      planFrom({ E2E_CONTROL_PORT: '3206', E2E_WORKERS: '4' }, 12),
    ).toThrow(/overlap: move E2E_CONTROL_PORT/);
    // The default offset keeps up to a thousand servers apart; 64 is the limit.
    expect(() => planFrom({ E2E_CONTROL_PORT: '3205' }, 12)).toThrow(/overlap/);
    expect(
      planFrom({ E2E_CONTROL_PORT: '3208', E2E_WORKERS: '4' }, 12),
    ).toMatchObject({ controlPort: 3208 });
  });
});

describe('addressOf', () => {
  const plan = planFrom({ E2E_BACKEND_PORT: '3260' }, 12);

  it('gives worker i the backend and control port i above the first', () => {
    expect(addressOf(plan, 0)).toEqual({
      index: 0,
      port: 3260,
      controlPort: 4260,
      origin: 'http://localhost:3260',
      controlUrl: 'http://127.0.0.1:4260',
    });
    expect(addressOf(plan, 3)).toMatchObject({
      port: 3263,
      controlPort: 4263,
      origin: 'http://localhost:3263',
      controlUrl: 'http://127.0.0.1:4263',
    });
  });

  it('gives no two workers a port in common', () => {
    const ports = Array.from({ length: plan.servers }, (_one, index) => {
      const { port, controlPort } = addressOf(plan, index);
      return [port, controlPort];
    }).flat();
    expect(new Set(ports).size).toBe(ports.length);
  });

  it('refuses a worker that has no server, and says how to get one', () => {
    expect(() => addressOf(plan, 4)).toThrow(
      /Worker 4 has no server of its own: 4 are started.*E2E_WORKERS/,
    );
    expect(() => addressOf(plan, -1)).toThrow(E2eSetupError);
    expect(() => addressOf(plan, 1.5)).toThrow(E2eSetupError);
    expect(() => addressOf(planFrom({ E2E_WORKERS: '1' }, 12), 1)).toThrow(
      /1 is started/,
    );
  });
});

describe('healthUrl', () => {
  it('names the last server, which the launcher starts last', () => {
    expect(healthUrl(planFrom({ E2E_BACKEND_PORT: '3260' }, 12))).toBe(
      'http://localhost:3263/api/health',
    );
    expect(healthUrl(planFrom({ E2E_WORKERS: '1' }, 12))).toBe(
      'http://localhost:3204/api/health',
    );
    expect(
      healthUrl(planFrom({ E2E_WORKERS: '2', E2E_SERVERS: '5' }, 12)),
    ).toBe('http://localhost:3208/api/health');
  });
});

describe('describePlan', () => {
  it('says where the servers are in one line', () => {
    expect(describePlan(planFrom({ E2E_BACKEND_PORT: '3260' }, 12))).toBe(
      '4 servers, backend :3260-3263, control :4260-4263',
    );
    expect(describePlan(planFrom({ E2E_WORKERS: '1' }, 12))).toBe(
      '1 server, backend :3204, control :4204',
    );
  });
});

describe('soloAddress', () => {
  it('is the server `bun tests/e2e/server.ts` starts: the ports as they always meant', () => {
    expect(soloAddress({})).toMatchObject({ port: 3204, controlPort: 4204 });
    expect(soloAddress({ E2E_BACKEND_PORT: '3215' })).toMatchObject({
      port: 3215,
      controlPort: 4215,
    });
    expect(
      soloAddress({ E2E_BACKEND_PORT: '3215', E2E_CONTROL_PORT: '9999' }),
    ).toMatchObject({ port: 3215, controlPort: 9999 });
  });

  it('is one server whatever the suite is set to run', () => {
    expect(
      soloAddress({
        E2E_WORKERS: '8',
        E2E_SERVERS: '8',
        E2E_BACKEND_PORT: '3260',
      }),
    ).toMatchObject({ port: 3260, controlPort: 4260 });
  });

  it('refuses ports that are not ports', () => {
    expect(() => soloAddress({ E2E_BACKEND_PORT: 'x' })).toThrow(
      /E2E_BACKEND_PORT must be a whole number/,
    );
  });
});

describe('serverSettings', () => {
  it("defaults to the dev server on 3004, a 400 ms start, a 150 ms check and the service's own dist", () => {
    expect(serverSettings({})).toEqual({
      appPort: 3004,
      launchDelayMs: 400,
      checkDelayMs: 150,
      distDir: undefined,
    });
  });

  it('reads the delays, the dev server port and a private build from the environment', () => {
    expect(
      serverSettings({
        E2E_APP_PORT: '5173',
        E2E_LAUNCH_DELAY_MS: '0',
        E2E_CHECK_DELAY_MS: '25',
        E2E_DIST_DIR: '/tmp/private-build',
      }),
    ).toEqual({
      appPort: 5173,
      launchDelayMs: 0,
      checkDelayMs: 25,
      distDir: '/tmp/private-build',
    });
  });

  it('refuses a delay that is not a number of milliseconds', () => {
    expect(() => serverSettings({ E2E_LAUNCH_DELAY_MS: 'slow' })).toThrow(
      /E2E_LAUNCH_DELAY_MS must be a whole number/,
    );
    expect(() => serverSettings({ E2E_CHECK_DELAY_MS: '-5' })).toThrow(
      /E2E_CHECK_DELAY_MS must be a whole number/,
    );
  });
});
