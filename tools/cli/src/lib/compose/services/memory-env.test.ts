import { afterEach, describe, expect, test } from 'bun:test';

import {
  MEMORY_BUDGET_BYTES,
  MEMORY_BUDGET_SHARES_MIB,
} from '@tale/shared/memory-budget';
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
import { createObjectStorageService } from './create-object-storage-service';
import { createPlatformService } from './create-platform-service';
import { createProxyService } from './create-proxy-service';
import { createSandboxEgressService } from './create-sandbox-egress-service';
import { createSandboxService } from './create-sandbox-service';
import {
  APP_TIER_SHARE_MIB,
  composeSize,
  goMemory,
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

const RESERVATION_VARS = [
  'DB_MEMORY_RESERVATION',
  'PLATFORM_MEMORY_RESERVATION',
  'BACKEND_API_MEMORY_RESERVATION',
  'BACKEND_WORKER_MEMORY_RESERVATION',
  'OBJECT_STORE_MEMORY_RESERVATION',
  'PROXY_MEMORY_RESERVATION',
  'SANDBOX_MEMORY_RESERVATION',
  'SANDBOX_EGRESS_MEMORY_RESERVATION',
] as const;
const VARS = [
  ...RESERVATION_VARS,
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

/** What every stack reserves outside the application tier, at the defaults:
 *  db 120, object-store 35, proxy 35, sandbox 20, sandbox-egress 10. */
const STACK_MIB = 120 + 35 + 35 + 20 + 10;

const proxyOf = (engine: ServiceConfig = config) =>
  createProxyService(engine, 'localhost', ['test-project']);
const versitygwOf = (engine: ServiceConfig = config) =>
  createObjectStorageService({ ...engine, objectStore: 'versitygw' });
const minioOf = (engine: ServiceConfig = config) =>
  createObjectStorageService({ ...engine, objectStore: 'minio' });

describe('memory reservations of the stack', () => {
  test('every service that reserves takes its share of the budget', () => {
    clear();
    expect(createDbService(config).mem_reservation).toBe('120m');
    expect(versitygwOf().mem_reservation).toBe('35m');
    // The store's share whichever server holds the blobs.
    expect(minioOf().mem_reservation).toBe('35m');
    expect(proxyOf().mem_reservation).toBe('35m');
    expect(createSandboxService(config).mem_reservation).toBe('20m');
    expect(createSandboxEgressService(config).mem_reservation).toBe('10m');
    // A caller that names no shape gets the three services.
    expect(createPlatformService(config, 'blue').mem_reservation).toBe('64m');
    expect(
      createBackendApiService(config, { colour: 'blue' }).mem_reservation,
    ).toBe('128m');
    expect(
      createBackendWorkerService(config, { colour: 'blue' }).mem_reservation,
    ).toBe('64m');
    // The dev fleet's named containers reserve the same.
    expect(createBackendApiService(config).mem_reservation).toBe('128m');
    expect(createBackendWorkerService(config).mem_reservation).toBe('64m');
  });

  test('the shares add up to the 500 MB budget, whatever the shape', () => {
    clear();
    const shares = Object.values(MEMORY_BUDGET_SHARES_MIB).reduce(
      (sum, mib) => sum + mib,
      0,
    );
    for (const tier of [UNIFIED, SPLIT, THREE_WAY]) {
      expect(reservedMemoryMib(tier), tier.shape).toBe(476);
      // Every share of the budget reserved, and nothing beside them.
      expect(reservedMemoryMib(tier), tier.shape).toBe(shares);
      // 500,000,000 bytes is 476.8 MiB.
      expect(reservedMemoryMib(tier) * 1024 ** 2).toBeLessThanOrEqual(
        MEMORY_BUDGET_BYTES,
      );
    }
    expect(STACK_MIB + APP_TIER_SHARE_MIB).toBe(476);
  });

  test("each part reserves its share of @tale/shared's budget, the spawner and its egress proxy theirs between them", () => {
    clear();
    const mib = (service: ComposeService) =>
      Number.parseInt(String(service.mem_reservation), 10);
    expect(mib(createDbService(config))).toBe(
      MEMORY_BUDGET_SHARES_MIB.postgres,
    );
    expect(mib(versitygwOf())).toBe(MEMORY_BUDGET_SHARES_MIB['object-store']);
    expect(mib(proxyOf())).toBe(MEMORY_BUDGET_SHARES_MIB.edge);
    // The CLI's own division of the share of the two (20 and 10), which must
    // add up to it.
    expect(
      mib(createSandboxService(config)) +
        mib(createSandboxEgressService(config)),
    ).toBe(MEMORY_BUDGET_SHARES_MIB['spawner-egress']);
    // Each shape divides the app tier's between its services (below).
    expect(APP_TIER_SHARE_MIB).toBe(MEMORY_BUDGET_SHARES_MIB['app-tier']);
  });

  test('each reservation follows its variable, in whole MiB', () => {
    clear();
    process.env.DB_MEMORY_RESERVATION = '1g';
    process.env.PLATFORM_MEMORY_RESERVATION = '200m';
    process.env.BACKEND_API_MEMORY_RESERVATION = ' 768M ';
    process.env.BACKEND_WORKER_MEMORY_RESERVATION = '1536mb';
    process.env.OBJECT_STORE_MEMORY_RESERVATION = '48m';
    process.env.PROXY_MEMORY_RESERVATION = '65536k';
    process.env.SANDBOX_MEMORY_RESERVATION = '100m';
    process.env.SANDBOX_EGRESS_MEMORY_RESERVATION = '32M';
    expect(createDbService(config).mem_reservation).toBe('1024m');
    expect(createPlatformService(config, 'green').mem_reservation).toBe('200m');
    expect(createBackendApiService(config).mem_reservation).toBe('768m');
    expect(createBackendWorkerService(config).mem_reservation).toBe('1536m');
    expect(versitygwOf().mem_reservation).toBe('48m');
    expect(minioOf().mem_reservation).toBe('48m');
    expect(proxyOf().mem_reservation).toBe('64m');
    expect(createSandboxService(config).mem_reservation).toBe('100m');
    expect(createSandboxEgressService(config).mem_reservation).toBe('32m');
  });

  test('0 reserves nothing, and a value that is no size fails the generation', () => {
    clear();
    for (const name of RESERVATION_VARS) process.env[name] = '0';
    const stack = [
      createDbService(config),
      versitygwOf(),
      minioOf(),
      proxyOf(),
      createSandboxService(config),
      createSandboxEgressService(config),
      createPlatformService(config, 'blue'),
      createBackendApiService(config),
      createBackendWorkerService(config),
    ];
    for (const service of stack)
      expect(service, service.image).not.toHaveProperty('mem_reservation');
    process.env.DB_MEMORY_RESERVATION = '2Gi';
    expect(() => createDbService(config)).toThrow(
      'Env var DB_MEMORY_RESERVATION is not a size such as 4g or 4096m: "2Gi"',
    );
    process.env.PROXY_MEMORY_RESERVATION = 'lots';
    expect(() => proxyOf()).toThrow(
      'Env var PROXY_MEMORY_RESERVATION is not a size such as 4g or 4096m: "lots"',
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
    process.env.OBJECT_STORE_MEMORY_RESERVATION = '5m';
    expect(() => versitygwOf({ ...config, cgroupVersion: null })).toThrow(
      'Env var OBJECT_STORE_MEMORY_RESERVATION must be 0 or at least 6m; got: "5m"',
    );
    process.env.OBJECT_STORE_MEMORY_RESERVATION = '';
    // The commands ask before they pull or touch anything, on every engine.
    for (const cgroupVersion of [2, 1, null] as const) {
      expect(() => memoryReservationNotice({ cgroupVersion })).toThrow(
        'Env var BACKEND_WORKER_MEMORY_RESERVATION must be at most 12288m',
      );
    }
  });

  test('the spawner and its egress proxy are held to their own memory limits, on every engine', () => {
    clear();
    // Up to the limit, which Docker allows a reservation to equal.
    process.env.SANDBOX_MEMORY_RESERVATION = '1g';
    expect(createSandboxService(config).mem_limit).toBe('1g');
    expect(createSandboxService(config).mem_reservation).toBe('1024m');
    process.env.SANDBOX_MEMORY_RESERVATION = '1025m';
    for (const cgroupVersion of [2, 1, null] as const)
      expect(() => createSandboxService({ ...config, cgroupVersion })).toThrow(
        'Env var SANDBOX_MEMORY_RESERVATION must be at most 1024m, the memory limit of sandbox; got: "1025m"',
      );
    delete process.env.SANDBOX_MEMORY_RESERVATION;
    process.env.SANDBOX_EGRESS_MEMORY_RESERVATION = '512m';
    expect(createSandboxEgressService(config).mem_limit).toBe('512m');
    expect(createSandboxEgressService(config).mem_reservation).toBe('512m');
    process.env.SANDBOX_EGRESS_MEMORY_RESERVATION = '513m';
    for (const cgroupVersion of [2, 1, null] as const)
      expect(() =>
        createSandboxEgressService({ ...config, cgroupVersion }),
      ).toThrow(
        'Env var SANDBOX_EGRESS_MEMORY_RESERVATION must be at most 512m, the memory limit of sandbox-egress; got: "513m"',
      );
    // The commands ask before they pull or touch anything.
    expect(() => memoryReservationNotice({ cgroupVersion: 2 })).toThrow(
      'Env var SANDBOX_EGRESS_MEMORY_RESERVATION must be at most 512m',
    );
    expect(() => reservedMemoryMib(UNIFIED)).toThrow(
      'Env var SANDBOX_EGRESS_MEMORY_RESERVATION must be at most 512m',
    );
  });

  test('the spawner learns the sum, every replica of a role counted', () => {
    clear();
    expect(createSandboxService(config).environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: '476m',
    });
    process.env.DB_MEMORY_RESERVATION = '1g';
    process.env.TALE_BACKEND_API_REPLICAS = '2';
    process.env.TALE_BACKEND_WORKER_REPLICAS = '3';
    // 1024 + 35 + 35 + 20 + 10, then 64 + 2 × 128 + 3 × 64
    expect(createSandboxService(config).environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: '1636m',
    });
    // The spawner and its egress proxy count their own reservations.
    process.env.SANDBOX_MEMORY_RESERVATION = '0';
    process.env.SANDBOX_EGRESS_MEMORY_RESERVATION = '100m';
    expect(createSandboxService(config).environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: `${1636 - 20 - 10 + 100}m`,
    });
  });

  test('a size in MiB reads as compose writes it', () => {
    expect(composeSize(1024)).toBe('1g');
    expect(composeSize(12 * 1024)).toBe('12g');
    expect(composeSize(512)).toBe('512m');
    expect(composeSize(140)).toBe('140m');
  });
});

describe('the Go services: a heap held to their share, and a backstop', () => {
  const environmentOf = (service: ComposeService) => service.environment ?? {};

  test('the edge and versitygw hold their heap to 80 % of the share, and stop at four times it', () => {
    clear();
    for (const service of [proxyOf(), versitygwOf()]) {
      expect(environmentOf(service).GOMEMLIMIT, service.image).toBe('28MiB');
      expect(service.mem_limit, service.image).toBe('140m');
    }
    expect(goMemory('proxy')).toEqual({
      limit: { mem_limit: '140m' },
      environment: { GOMEMLIMIT: '28MiB' },
    });
    // The edge keeps what else it is given.
    expect(environmentOf(proxyOf())).toMatchObject({
      TALE_PROXY_PROJECTS: 'test-project',
    });
    expect(environmentOf(versitygwOf())).toMatchObject({
      VGW_REGION: '${OBJECT_STORE_REGION:-us-east-1}',
    });
  });

  test('both follow the reservation variable, in whole MiB, on every cgroup version', () => {
    clear();
    process.env.PROXY_MEMORY_RESERVATION = '100m';
    process.env.OBJECT_STORE_MEMORY_RESERVATION = '64m';
    for (const cgroupVersion of [2, 1, null] as const) {
      const engine = { ...config, cgroupVersion };
      expect(environmentOf(proxyOf(engine)).GOMEMLIMIT).toBe('80MiB');
      expect(proxyOf(engine).mem_limit).toBe('400m');
      // 80 % of 64 is 51.2: whole MiB, rounded down.
      expect(environmentOf(versitygwOf(engine)).GOMEMLIMIT).toBe('51MiB');
      expect(versitygwOf(engine).mem_limit).toBe('256m');
    }
    // The reservation itself only on cgroup v2.
    expect(proxyOf().mem_reservation).toBe('100m');
    expect(proxyOf({ ...config, cgroupVersion: 1 })).not.toHaveProperty(
      'mem_reservation',
    );
    process.env.PROXY_MEMORY_RESERVATION = '1g';
    expect(goMemory('proxy')).toEqual({
      limit: { mem_limit: '4g' },
      environment: { GOMEMLIMIT: '819MiB' },
    });
    // At Docker's floor the heap limit stays a size Go reads.
    process.env.PROXY_MEMORY_RESERVATION = '6m';
    expect(goMemory('proxy')).toEqual({
      limit: { mem_limit: '24m' },
      environment: { GOMEMLIMIT: '4MiB' },
    });
  });

  test('a reservation of 0 leaves both out', () => {
    clear();
    process.env.PROXY_MEMORY_RESERVATION = '0';
    process.env.OBJECT_STORE_MEMORY_RESERVATION = '0';
    for (const service of [proxyOf(), versitygwOf()]) {
      expect(environmentOf(service), service.image).not.toHaveProperty(
        'GOMEMLIMIT',
      );
      expect(service, service.image).not.toHaveProperty('mem_limit');
      expect(service, service.image).not.toHaveProperty('mem_reservation');
    }
    expect(goMemory('object-store')).toEqual({ limit: {}, environment: {} });
  });

  test('MinIO gets neither, and the Docker API proxy reserves nothing', () => {
    clear();
    const minio = minioOf();
    expect(environmentOf(minio)).not.toHaveProperty('GOMEMLIMIT');
    expect(minio).not.toHaveProperty('mem_limit');
    const stateful = (
      parse(generateStatefulCompose(config, 'demo.tale.dev')) as {
        services: Record<string, ComposeService>;
      }
    ).services;
    expect(stateful['docker-api']).not.toHaveProperty('mem_reservation');
    expect(stateful['docker-api']).not.toHaveProperty('mem_limit');
    expect(environmentOf(stateful['docker-api']!)).not.toHaveProperty(
      'GOMEMLIMIT',
    );
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
        SANDBOX_RESERVED_MEMORY: '476m',
      });
      // The Go services keep their heap limit and their backstop.
      for (const name of ['proxy', 'object-store']) {
        expect(stack[name]?.environment?.GOMEMLIMIT, name).toBe('28MiB');
        expect(stack[name]?.mem_limit, name).toBe('140m');
      }
    }
    // An engine that was never read counts as unread.
    expect(
      createDbService({ version: '0.2.17', registry: 'ghcr.io/tale-project' }),
    ).not.toHaveProperty('mem_reservation');
    // The same stack on cgroup v2 reserves for every service of the budget.
    const v2 = {
      ...services(generateStatefulCompose(config, 'demo.tale.dev')),
      ...services(generateColorCompose(config, 'blue')),
    };
    expect(
      Object.entries(v2)
        .filter(([, service]) => service.mem_reservation !== undefined)
        .map(([name, service]) => [name, service.mem_reservation]),
    ).toEqual([
      ['db', '120m'],
      ['object-store', '35m'],
      ['proxy', '35m'],
      ['sandbox-egress', '10m'],
      ['sandbox', '20m'],
      ['platform', '64m'],
      ['backend-api', '128m'],
      ['backend-worker', '64m'],
    ]);
  });

  test('the commands warn once when the reservations are left out', () => {
    clear();
    expect(memoryReservationNotice(config)).toBeNull();
    expect(memoryReservationNotice(v1)).toBe(
      "Docker runs cgroup v1, where a memory reservation is a soft limit that reclaim takes from first: the stack's services run without memory reservations, which only cgroup v2 holds.",
    );
    expect(memoryReservationNotice(unread)).toBe(
      "Docker did not report its cgroup version: the stack's services run without memory reservations, which only cgroup v2 holds.",
    );
    // Nothing to leave out when every reservation is 0.
    for (const name of RESERVATION_VARS.slice(0, -1)) process.env[name] = '0';
    expect(memoryReservationNotice(v1)).not.toBeNull();
    process.env.SANDBOX_EGRESS_MEMORY_RESERVATION = '0';
    expect(memoryReservationNotice(v1)).toBeNull();
    expect(memoryReservationNotice(unread)).toBeNull();
  });

  test('a reservation set only for a service the shape does not run leaves nothing out', () => {
    clear();
    for (const name of RESERVATION_VARS) process.env[name] = '0';
    process.env.BACKEND_API_MEMORY_RESERVATION = '1g';
    process.env.BACKEND_WORKER_MEMORY_RESERVATION = '1g';
    // One process runs neither backend service.
    expect(memoryReservationNotice({ ...v1, appTier: UNIFIED })).toBeNull();
    // With the jobs apart the worker is run, and reserves.
    expect(memoryReservationNotice({ ...v1, appTier: SPLIT })).not.toBeNull();
    expect(memoryReservationNotice(v1)).not.toBeNull();
  });
});

describe('memory reservations follow the shape of the colour', () => {
  const one = { ...config, appTier: UNIFIED } satisfies ServiceConfig;
  const apart = { ...config, appTier: SPLIT } satisfies ServiceConfig;
  const three = { ...config, appTier: THREE_WAY } satisfies ServiceConfig;
  const services = (yaml: string) =>
    (parse(yaml) as { services: Record<string, ComposeService> }).services;

  test("each shape divides the application tier's share between its services", () => {
    clear();
    const reserved = (engine: ServiceConfig) =>
      Object.entries(services(generateColorCompose(engine, 'blue'))).map(
        ([name, service]) => [name, service.mem_reservation],
      );
    expect(reserved(one)).toEqual([['platform', '256m']]);
    expect(reserved(apart)).toEqual([
      ['platform', '192m'],
      ['backend-worker', '64m'],
    ]);
    expect(reserved(three)).toEqual([
      ['platform', '64m'],
      ['backend-api', '128m'],
      ['backend-worker', '64m'],
    ]);
    for (const engine of [one, apart, three]) {
      const sum = reserved(engine).reduce(
        (total, [, size]) => total + Number.parseInt(String(size), 10),
        0,
      );
      expect(sum, engine.appTier.shape).toBe(APP_TIER_SHARE_MIB);
    }
  });

  test('the services outside the application tier reserve the same in every shape', () => {
    clear();
    for (const engine of [one, apart, three]) {
      expect(createDbService(engine).mem_reservation).toBe('120m');
      expect(versitygwOf(engine).mem_reservation).toBe('35m');
      expect(proxyOf(engine).mem_reservation).toBe('35m');
      expect(createSandboxService(engine).mem_reservation).toBe('20m');
      expect(createSandboxEgressService(engine).mem_reservation).toBe('10m');
    }
  });

  test("its variable stays platform's own, and the api's is not read for it", () => {
    clear();
    process.env.BACKEND_API_MEMORY_RESERVATION = '999m';
    expect(createPlatformService(one, 'blue').mem_reservation).toBe('256m');
    expect(createPlatformService(apart, 'blue').mem_reservation).toBe('192m');
    process.env.PLATFORM_MEMORY_RESERVATION = '300m';
    for (const engine of [one, apart, three])
      expect(createPlatformService(engine, 'green').mem_reservation).toBe(
        '300m',
      );
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
    expect(reservedMemoryMib(THREE_WAY)).toBe(STACK_MIB + 12289 + 128 + 64);
  });

  test('the spawner learns what the shape reserves, every replica counted', () => {
    clear();
    // The stack and one process; the API and the jobs apart; three services:
    // the same share.
    for (const engine of [one, apart, three])
      expect(createSandboxService(engine).environment).toMatchObject({
        SANDBOX_RESERVED_MEMORY: '476m',
      });
    process.env.TALE_PLATFORM_REPLICAS = '2';
    expect(createSandboxService(one).environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: `${STACK_MIB + 2 * 256}m`,
    });
    // A backend count the one process has no service for reserves nothing.
    process.env.TALE_BACKEND_API_REPLICAS = '3';
    process.env.TALE_BACKEND_WORKER_REPLICAS = '4';
    expect(createSandboxService(one).environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: `${STACK_MIB + 2 * 256}m`,
    });
    // With the jobs apart, platform runs the larger of the two counts asked
    // of it: 3 × 192 + 4 × 64.
    expect(createSandboxService(apart).environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: `${STACK_MIB + 3 * 192 + 4 * 64}m`,
    });
    process.env.PLATFORM_MEMORY_RESERVATION = '0';
    expect(createSandboxService(one).environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: `${STACK_MIB}m`,
    });
  });

  test('a reservation set for a service the shape does not run is named, since it protects nothing', () => {
    clear();
    expect(unusedMemoryReservations(UNIFIED)).toEqual([]);
    process.env.BACKEND_API_MEMORY_RESERVATION = '2g';
    process.env.BACKEND_WORKER_MEMORY_RESERVATION = '1g';
    process.env.PLATFORM_MEMORY_RESERVATION = '64m';
    // Every service outside the application tier runs in every shape.
    process.env.OBJECT_STORE_MEMORY_RESERVATION = '40m';
    process.env.PROXY_MEMORY_RESERVATION = '40m';
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
    const stack = STACK_MIB + 5 + 5;
    expect(reservedMemoryMib(UNIFIED)).toBe(stack + 64);
    expect(reservedMemoryMib(SPLIT)).toBe(stack + 64 + 1024);
    expect(reservedMemoryMib(THREE_WAY)).toBe(stack + 64 + 2048 + 1024);
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
      expect(reservedMemoryMib(UNIFIED)).toBe(STACK_MIB + 16 * 256);
    } finally {
      console.warn = warn;
      console.log = log;
    }
    expect(warned).toEqual([]);
  });

  test('the generated stack of one process reserves for every service of the budget, and tells the spawner so', () => {
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
      ['db', '120m'],
      ['object-store', '35m'],
      ['proxy', '35m'],
      ['sandbox-egress', '10m'],
      ['sandbox', '20m'],
      ['platform', '256m'],
    ]);
    expect(stack.sandbox?.environment).toMatchObject({
      SANDBOX_RESERVED_MEMORY: '476m',
    });
  });
});
