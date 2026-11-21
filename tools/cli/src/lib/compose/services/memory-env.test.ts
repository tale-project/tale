import { afterEach, describe, expect, test } from 'bun:test';

import { parse } from 'yaml';

import { setProjectId } from '../../project/project-context';
import { SPLIT, THREE_WAY, UNIFIED } from '../app-tier';
import { generateColorCompose } from '../generators/generate-color-compose';
import { generateStatefulCompose } from '../generators/generate-stateful-compose';
import type { ComposeService, ServiceConfig } from '../types';
import {
  createBackendApiService,
  createBackendWorkerService,
} from './create-backend-services';
import { createDbService } from './create-db-service';
import { createPlatformService } from './create-platform-service';
import { createSandboxService } from './create-sandbox-service';
import {
  memoryReservationNotice,
  reservedMemoryMib,
  unusedMemoryReservations,
} from './memory-env';

// getProjectId() (used for container_name) throws unless the project context
// has been initialised, so seed it once for these unit tests.
setProjectId('test-project');

// An engine on cgroup v2, the one the reservations are emitted for.
const config = {
  version: '0.2.17',
  registry: 'ghcr.io/tale-project',
  cgroupVersion: 2,
} satisfies ServiceConfig;

const VARS = [
  'DB_MEMORY_RESERVATION',
  'PLATFORM_MEMORY_RESERVATION',
  'BACKEND_API_MEMORY_RESERVATION',
  'BACKEND_WORKER_MEMORY_RESERVATION',
  'TALE_PLATFORM_REPLICAS',
  'TALE_BACKEND_API_REPLICAS',
  'TALE_BACKEND_WORKER_REPLICAS',
] as const;
const original = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));

afterEach(() => {
  for (const name of VARS) {
    const value = original[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function clear(): void {
  for (const name of VARS) delete process.env[name];
}

describe('memory reservations of the stack', () => {
  test('db, platform and both backend roles reserve their defaults', () => {
    clear();
    expect(createDbService(config).mem_reservation).toBe('512m');
    expect(createPlatformService(config, 'blue').mem_reservation).toBe('128m');
    expect(
      createBackendApiService(config, { colour: 'blue' }).mem_reservation,
    ).toBe('256m');
    expect(
      createBackendWorkerService(config, { colour: 'blue' }).mem_reservation,
    ).toBe('256m');
    // The dev fleet's named containers reserve the same.
    expect(createBackendApiService(config).mem_reservation).toBe('256m');
  });

  test('each reservation follows its variable, in whole MiB', () => {
    clear();
    process.env.DB_MEMORY_RESERVATION = '1g';
    process.env.PLATFORM_MEMORY_RESERVATION = '200m';
    process.env.BACKEND_API_MEMORY_RESERVATION = ' 768M ';
    process.env.BACKEND_WORKER_MEMORY_RESERVATION = '1536mb';
    expect(createDbService(config).mem_reservation).toBe('1024m');
    expect(createPlatformService(config, 'green').mem_reservation).toBe('200m');
    expect(createBackendApiService(config).mem_reservation).toBe('768m');
    expect(createBackendWorkerService(config).mem_reservation).toBe('1536m');
  });

  test('0 reserves nothing, and a value that is no size fails the generation', () => {
    clear();
    process.env.DB_MEMORY_RESERVATION = '0';
    expect(createDbService(config)).not.toHaveProperty('mem_reservation');
    process.env.DB_MEMORY_RESERVATION = '2Gi';
    expect(() => createDbService(config)).toThrow(
      'Env var DB_MEMORY_RESERVATION is not a size such as 4g or 4096m: "2Gi"',
    );
  });

  test('a reservation Docker would refuse fails the generation, on every engine', () => {
    clear();
    // Up to the backend's memory limit, which Docker allows a reservation to
    // equal.
    process.env.BACKEND_API_MEMORY_RESERVATION = '12g';
    const backend = createBackendApiService(config);
    expect(backend.mem_limit).toBe('12g');
    expect(backend.mem_reservation).toBe('12288m');
    process.env.BACKEND_WORKER_MEMORY_RESERVATION = '12289m';
    for (const cgroupVersion of [2, 1, null] as const) {
      expect(() =>
        createBackendWorkerService({ ...config, cgroupVersion }),
      ).toThrow(
        'Env var BACKEND_WORKER_MEMORY_RESERVATION must be at most 12288m, the memory limit of backend-worker; got: "12289m"',
      );
    }
    // Under Docker's 6 MiB floor; 0 reserves nothing.
    process.env.DB_MEMORY_RESERVATION = '5m';
    expect(() => createDbService({ ...config, cgroupVersion: 1 })).toThrow(
      'Env var DB_MEMORY_RESERVATION must be 0 or at least 6m; got: "5m"',
    );
    process.env.DB_MEMORY_RESERVATION = '6m';
    expect(createDbService(config).mem_reservation).toBe('6m');
    // The commands ask before they pull or touch anything, on every engine.
    for (const cgroupVersion of [2, 1, null] as const) {
      expect(() => memoryReservationNotice({ cgroupVersion })).toThrow(
        'Env var BACKEND_WORKER_MEMORY_RESERVATION must be at most 12288m',
      );
    }
  });

  test('the spawner learns the sum, every replica of a role counted', () => {
    clear();
    expect(createSandboxService(config).environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: '1152m',
    });
    process.env.DB_MEMORY_RESERVATION = '1g';
    process.env.TALE_BACKEND_API_REPLICAS = '2';
    process.env.TALE_BACKEND_WORKER_REPLICAS = '3';
    // 1024 + 128 + 2 × 256 + 3 × 256
    expect(createSandboxService(config).environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: '2432m',
    });
  });
});

describe('memory reservations on an engine that is not cgroup v2', () => {
  // On cgroup v1 Docker writes a reservation to memory.soft_limit_in_bytes,
  // which makes the service the first that global reclaim takes from.
  const v1 = { ...config, cgroupVersion: 1 } satisfies ServiceConfig;
  const unread = { ...config, cgroupVersion: null } satisfies ServiceConfig;
  const services = (yaml: string) =>
    (parse(yaml) as { services: Record<string, ComposeService> }).services;

  test('the generated stack reserves nothing on cgroup v1 or an engine that reports no version', () => {
    clear();
    for (const engine of [v1, unread]) {
      const stack = {
        ...services(generateStatefulCompose(engine, 'demo.tale.dev')),
        ...services(generateColorCompose(engine, 'blue')),
      };
      for (const [name, service] of Object.entries(stack)) {
        expect(service.mem_reservation, name).toBeUndefined();
      }
      // Admission leaves the same sum free either way.
      expect(stack.sandbox?.environment).toMatchObject({
        SANDBOX_RESERVED_MEMORY: '1152m',
      });
    }
    // An engine that was never read counts as unread.
    expect(
      createDbService({ version: '0.2.17', registry: 'ghcr.io/tale-project' }),
    ).not.toHaveProperty('mem_reservation');
    // The same stack on cgroup v2 reserves for db and the application tier.
    const v2 = {
      ...services(generateStatefulCompose(config, 'demo.tale.dev')),
      ...services(generateColorCompose(config, 'blue')),
    };
    expect(
      Object.entries(v2)
        .filter(([, service]) => service.mem_reservation !== undefined)
        .map(([name, service]) => [name, service.mem_reservation]),
    ).toEqual([
      ['db', '512m'],
      ['platform', '128m'],
      ['backend-api', '256m'],
      ['backend-worker', '256m'],
    ]);
  });

  test('the commands warn once when the reservations are left out', () => {
    clear();
    expect(memoryReservationNotice(config)).toBeNull();
    expect(memoryReservationNotice(v1)).toBe(
      'Docker runs cgroup v1, where a memory reservation is a soft limit that reclaim takes from first: the database and the application tier run without memory reservations, which only cgroup v2 holds.',
    );
    expect(memoryReservationNotice(unread)).toBe(
      'Docker did not report its cgroup version: the database and the application tier run without memory reservations, which only cgroup v2 holds.',
    );
    // Nothing to leave out when every reservation is 0.
    process.env.DB_MEMORY_RESERVATION = '0';
    process.env.PLATFORM_MEMORY_RESERVATION = '0';
    process.env.BACKEND_API_MEMORY_RESERVATION = '0';
    expect(memoryReservationNotice(v1)).not.toBeNull();
    process.env.BACKEND_WORKER_MEMORY_RESERVATION = '0';
    expect(memoryReservationNotice(v1)).toBeNull();
    expect(memoryReservationNotice(unread)).toBeNull();
  });
});

describe('memory reservations follow the shape of the colour', () => {
  const one = { ...config, appTier: UNIFIED } satisfies ServiceConfig;
  const apart = { ...config, appTier: SPLIT } satisfies ServiceConfig;
  const three = { ...config, appTier: THREE_WAY } satisfies ServiceConfig;
  const services = (yaml: string) =>
    (parse(yaml) as { services: Record<string, ComposeService> }).services;

  test('a platform that is a backend process keeps what a backend keeps', () => {
    clear();
    expect(createPlatformService(one, 'blue').mem_reservation).toBe('256m');
    expect(createPlatformService(apart, 'blue').mem_reservation).toBe('256m');
    // As the web tier alone it keeps the web tier's.
    expect(createPlatformService(three, 'blue').mem_reservation).toBe('128m');
  });

  test("its variable stays platform's own, and the api's is not read for it", () => {
    clear();
    process.env.BACKEND_API_MEMORY_RESERVATION = '999m';
    expect(createPlatformService(one, 'blue').mem_reservation).toBe('256m');
    process.env.PLATFORM_MEMORY_RESERVATION = '300m';
    expect(createPlatformService(one, 'blue').mem_reservation).toBe('300m');
    expect(createPlatformService(apart, 'green').mem_reservation).toBe('300m');
    process.env.PLATFORM_MEMORY_RESERVATION = '0';
    expect(createPlatformService(one, 'blue')).not.toHaveProperty(
      'mem_reservation',
    );
  });

  test("it is held to the backend's memory limit, which the web tier alone does not have", () => {
    clear();
    process.env.PLATFORM_MEMORY_RESERVATION = '12g';
    const platform = createPlatformService(one, 'blue');
    expect(platform.mem_limit).toBe('12g');
    expect(platform.mem_reservation).toBe('12288m');
    process.env.PLATFORM_MEMORY_RESERVATION = '12289m';
    for (const shaped of [one, apart])
      for (const cgroupVersion of [2, 1, null] as const)
        expect(() =>
          createPlatformService({ ...shaped, cgroupVersion }, 'blue'),
        ).toThrow(
          'Env var PLATFORM_MEMORY_RESERVATION must be at most 12288m, the memory limit of platform; got: "12289m"',
        );
    expect(createPlatformService(three, 'blue').mem_limit).toBeUndefined();
    expect(createPlatformService(three, 'blue').mem_reservation).toBe('12289m');
    // A deploy reads the sum for the shape it settled on before it changes
    // anything, so the refusal comes there too.
    expect(() => reservedMemoryMib(UNIFIED)).toThrow(
      'Env var PLATFORM_MEMORY_RESERVATION must be at most 12288m',
    );
    expect(reservedMemoryMib(THREE_WAY)).toBe(512 + 12289 + 256 + 256);
  });

  test('the spawner learns what the shape reserves, every replica counted', () => {
    clear();
    // The database and one process.
    expect(createSandboxService(one).environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: '768m',
    });
    // The database, the API and the jobs.
    expect(createSandboxService(apart).environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: '1024m',
    });
    expect(createSandboxService(three).environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: '1152m',
    });
    process.env.TALE_PLATFORM_REPLICAS = '2';
    expect(createSandboxService(one).environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: '1024m',
    });
    // A backend count the one process has no service for reserves nothing.
    process.env.TALE_BACKEND_API_REPLICAS = '3';
    process.env.TALE_BACKEND_WORKER_REPLICAS = '4';
    expect(createSandboxService(one).environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: '1024m',
    });
    // With the jobs apart, platform runs the larger of the two counts asked
    // of it: 512 + 3 × 256 + 4 × 256.
    expect(createSandboxService(apart).environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: '2304m',
    });
    process.env.PLATFORM_MEMORY_RESERVATION = '0';
    expect(createSandboxService(one).environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: '512m',
    });
  });

  test('a reservation set for a service the shape does not run is named, since it protects nothing', () => {
    clear();
    expect(unusedMemoryReservations(UNIFIED)).toEqual([]);
    process.env.BACKEND_API_MEMORY_RESERVATION = '2g';
    process.env.BACKEND_WORKER_MEMORY_RESERVATION = '1g';
    process.env.PLATFORM_MEMORY_RESERVATION = '64m';
    expect(unusedMemoryReservations(UNIFIED)).toEqual([
      'BACKEND_API_MEMORY_RESERVATION',
      'BACKEND_WORKER_MEMORY_RESERVATION',
    ]);
    // With the jobs apart the worker's is read, the api's still is not.
    expect(unusedMemoryReservations(SPLIT)).toEqual([
      'BACKEND_API_MEMORY_RESERVATION',
    ]);
    expect(unusedMemoryReservations(THREE_WAY)).toEqual([]);
    expect(unusedMemoryReservations()).toEqual([]);
    // What the one process reserves is its own variable's, nothing else's.
    expect(createPlatformService(one, 'blue').mem_reservation).toBe('64m');
    expect(reservedMemoryMib(UNIFIED)).toBe(512 + 64);
    expect(reservedMemoryMib(SPLIT)).toBe(512 + 64 + 1024);
    expect(reservedMemoryMib(THREE_WAY)).toBe(512 + 64 + 2048 + 1024);
    process.env.BACKEND_API_MEMORY_RESERVATION = '  ';
    expect(unusedMemoryReservations(UNIFIED)).toEqual([
      'BACKEND_WORKER_MEMORY_RESERVATION',
    ]);
  });

  test('the sum is read without a word: the command that asks for it says what it clamped', () => {
    clear();
    process.env.TALE_PLATFORM_REPLICAS = '99';
    const warned: unknown[] = [];
    const warn = console.warn;
    const log = console.log;
    console.warn = (...args: unknown[]) => warned.push(args);
    console.log = (...args: unknown[]) => warned.push(args);
    try {
      expect(reservedMemoryMib(UNIFIED)).toBe(512 + 16 * 256);
    } finally {
      console.warn = warn;
      console.log = log;
    }
    expect(warned).toEqual([]);
  });

  test('the generated stack of one process reserves for db and platform, and tells the spawner so', () => {
    clear();
    const stack = {
      ...services(generateStatefulCompose(one, 'demo.tale.dev')),
      ...services(generateColorCompose(one, 'blue')),
    };
    expect(
      Object.entries(stack)
        .filter(([, service]) => service.mem_reservation !== undefined)
        .map(([name, service]) => [name, service.mem_reservation]),
    ).toEqual([
      ['db', '512m'],
      ['platform', '256m'],
    ]);
    expect(stack.sandbox?.environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: '768m',
    });
  });
});
