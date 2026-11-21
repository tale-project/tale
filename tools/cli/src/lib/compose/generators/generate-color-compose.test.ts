import { describe, expect, test } from 'bun:test';

import { parse } from 'yaml';

import { setProjectId } from '../../project/project-context';
import { SPLIT, THREE_WAY, UNIFIED, type AppTier } from '../app-tier';
import { ONE_PROCESS_POOLS } from '../services/create-backend-services';
import type { ComposeService, ServiceConfig } from '../types';
import { generateColorCompose } from './generate-color-compose';

// getProjectId() (used for the external volume/network names) throws unless
// seeded.
setProjectId('tale');

const config = {
  version: '0.2.17',
  registry: 'ghcr.io/tale-project',
} satisfies ServiceConfig;

const COLORS = ['blue', 'green'] as const;

function servicesOf(
  color: (typeof COLORS)[number],
): Record<string, ComposeService> {
  return (
    parse(generateColorCompose(config, color)) as {
      services: Record<string, ComposeService>;
    }
  ).services;
}

describe('generateColorCompose ↔ the replica-set contract', () => {
  // A pinned `container_name` and `docker compose --scale` are mutually
  // exclusive: two containers cannot share one name, so compose refuses to
  // replicate a named service. The colour's compose PROJECT already carries
  // the colour, so the services are named plainly and the CLI finds their
  // replicas by compose label instead of by a reconstructed name.
  for (const color of COLORS) {
    test(`${color} carries the whole application tier, unnamed and scalable`, () => {
      const services = servicesOf(color);
      expect(Object.keys(services).sort()).toEqual([
        'backend-api',
        'backend-worker',
        'platform',
      ]);
      for (const [name, service] of Object.entries(services)) {
        expect(
          service.container_name,
          `${name} must not pin a container_name — --scale would fail`,
        ).toBeUndefined();
      }
    });

    // The database, the blob store and the proxy live in the STATEFUL
    // compose, which is a different compose project. Compose has no
    // cross-project dependencies, so a `depends_on` naming them makes the
    // whole file invalid ("depends on undefined service").
    test(`${color} declares no cross-project depends_on`, () => {
      for (const [name, service] of Object.entries(servicesOf(color))) {
        expect(
          service.depends_on,
          `${name} cannot depend on a service in another compose project`,
        ).toBeUndefined();
      }
    });

    // Both colours answer the shared alias while they overlap; the
    // colour-suffixed one is how the deploy reaches ONE colour meanwhile.
    test(`${color} serves the shared aliases plus its own`, () => {
      const services = servicesOf(color);
      const platform = services.platform?.networks as Record<
        string,
        { aliases?: string[] }
      >;
      expect(platform.internal?.aliases).toEqual([
        'platform',
        `platform-${color}`,
      ]);

      const api = services['backend-api']?.networks as Record<
        string,
        { aliases?: string[] }
      >;
      // Dual-homed: a session container reaches the connectors bridge and
      // the host-call door on the sandbox network directly.
      expect(api.internal?.aliases).toEqual([
        'backend-api',
        `backend-api-${color}`,
      ]);
      expect(api.sandbox?.aliases).toEqual([
        'backend-api',
        `backend-api-${color}`,
      ]);

      // The worker holds NO shared alias — nothing addresses it by name, it
      // is reached only through the job queue.
      const worker = services['backend-worker']?.networks as Record<
        string,
        { aliases?: string[] }
      >;
      expect(worker.internal?.aliases).toEqual([`backend-worker-${color}`]);
    });

    // Each backend replica has to know which colour it is, or a drain aimed
    // at the colour being retired would silence the one that just took over.
    test(`${color} tells each backend role its colour`, () => {
      const services = servicesOf(color);
      expect(services['backend-api']?.environment?.TALE_COLOR).toBe(color);
      expect(services['backend-worker']?.environment?.TALE_COLOR).toBe(color);
    });
  }
});

describe('generateColorCompose ↔ graceful-shutdown budget', () => {
  // The platform entrypoint's SIGTERM trap drains for SHUTDOWN_DRAIN_SECONDS
  // (6) + SHUTDOWN_GRACE_SECONDS (5) + up to SHUTDOWN_TIMEOUT_SECONDS (30) ≈
  // 41s. `docker stop` (no -t) honors the container StopTimeout set by
  // stop_grace_period, so this MUST cover that budget — otherwise Docker's
  // default 10s SIGKILLs the old colour mid-drain on a flip, cutting in-flight
  // HTTP/SSE chat streams. Pin a floor so a SHUTDOWN_* default bump trips here.
  const MIN_GRACE_SECONDS = 41;
  for (const color of COLORS) {
    test(`${color} platform sets stop_grace_period >= ${MIN_GRACE_SECONDS}s`, () => {
      const grace = servicesOf(color).platform?.stop_grace_period;
      expect(grace).toBeDefined();
      expect(grace).toMatch(/^\d+s$/);
      expect(Number.parseInt(grace as string, 10)).toBeGreaterThanOrEqual(
        MIN_GRACE_SECONDS,
      );
    });
  }
});

describe('generateColorCompose ↔ the backend stop budget', () => {
  // A stopping backend drains for SHUTDOWN_DRAIN_MS (api 15 s, worker 90 s)
  // and needs 15 s more to close its stores; a worker that is SIGKILLed
  // first leaves its automation runs to lapse instead of handing them on.
  for (const color of COLORS) {
    test(`${color} gives each backend role room for its drain`, () => {
      const services = servicesOf(color);
      expect(services['backend-api']?.stop_grace_period).toBe('30s');
      expect(services['backend-worker']?.stop_grace_period).toBe('120s');
    });
  }

  // A deploy generates its compose file, so the drain an operator sets in
  // the project `.env` is the only knob: the grace follows it up, never
  // below the role's own.
  test('keeps the grace 15 s above a longer SHUTDOWN_DRAIN_MS', () => {
    const before = process.env.SHUTDOWN_DRAIN_MS;
    try {
      process.env.SHUTDOWN_DRAIN_MS = '300000';
      const longer = servicesOf('blue');
      expect(longer['backend-api']?.stop_grace_period).toBe('315s');
      expect(longer['backend-worker']?.stop_grace_period).toBe('315s');

      process.env.SHUTDOWN_DRAIN_MS = '5000';
      const shorter = servicesOf('blue');
      expect(shorter['backend-api']?.stop_grace_period).toBe('30s');
      expect(shorter['backend-worker']?.stop_grace_period).toBe('120s');

      process.env.SHUTDOWN_DRAIN_MS = 'ninety seconds';
      expect(servicesOf('blue')['backend-worker']?.stop_grace_period).toBe(
        '120s',
      );
    } finally {
      if (before === undefined) delete process.env.SHUTDOWN_DRAIN_MS;
      else process.env.SHUTDOWN_DRAIN_MS = before;
    }
  });
});

describe('generateColorCompose ↔ the shared config store', () => {
  // Durable state does NOT rotate: both colours mount the same external
  // config volume, the backend read-write and the web tier read-only.
  test('both colours mount the same external config-data volume', () => {
    for (const color of COLORS) {
      const compose = parse(generateColorCompose(config, color)) as {
        volumes: Record<string, { external?: boolean; name?: string }>;
        services: Record<string, ComposeService>;
      };
      expect(compose.volumes['config-data']).toEqual({
        external: true,
        name: 'tale_config-data',
      });
      expect(compose.services.platform?.volumes).toEqual([
        'config-data:/app/data:ro',
        'static-assets:/app/static-assets',
      ]);
      expect(compose.volumes['static-assets']).toEqual({
        external: true,
        name: 'tale_static-assets',
      });
      expect(compose.services['backend-api']?.volumes).toEqual([
        'config-data:/app/data',
      ]);
    }
  });
});

describe('generateColorCompose ↔ tale deploy --host', () => {
  const origin = {
    host: 'tale.example.com',
    siteUrl: 'https://tale.example.com:8443',
  };

  test('every role serves the host of the run instead of .env', () => {
    const services = (
      parse(generateColorCompose(config, 'blue', origin)) as {
        services: Record<string, ComposeService>;
      }
    ).services;
    for (const [name, service] of Object.entries(services)) {
      expect(service.environment, name).toMatchObject({
        HOST: 'tale.example.com',
        SITE_URL: 'https://tale.example.com:8443',
      });
    }
    // Compose fills `${SITE_URL}` from .env, not from the service's own
    // environment, so the browser's blob URL carries the run's origin.
    for (const name of ['backend-api', 'backend-worker']) {
      expect(services[name]?.environment?.OBJECT_STORE_PUBLIC_ENDPOINT).toBe(
        '${OBJECT_STORE_PUBLIC_ENDPOINT:-https://tale.example.com:8443}',
      );
    }
  });

  test('without --host every role reads HOST and SITE_URL from .env', () => {
    for (const [name, service] of Object.entries(servicesOf('blue'))) {
      expect(service.env_file, name).toEqual(['.env']);
      expect(service.environment?.HOST, name).toBeUndefined();
      expect(service.environment?.SITE_URL, name).toBeUndefined();
    }
  });
});

describe('generateColorCompose ↔ the shape of the application tier', () => {
  type Networks = Record<string, { aliases?: string[] }>;
  const shaped = (
    appTier: AppTier,
    color: (typeof COLORS)[number] = 'blue',
  ): Record<string, ComposeService> =>
    (
      parse(generateColorCompose({ ...config, appTier }, color)) as {
        services: Record<string, ComposeService>;
      }
    ).services;
  /** Run `body` with these variables set, then put the environment back. */
  const withEnv = (values: Record<string, string>, body: () => void): void => {
    const before = Object.fromEntries(
      Object.keys(values).map((name) => [name, process.env[name]]),
    );
    try {
      Object.assign(process.env, values);
      body();
    } finally {
      for (const [name, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  };

  test('a caller that names no shape gets the three services, as before the shapes', () => {
    expect(
      generateColorCompose({ ...config, appTier: THREE_WAY }, 'blue'),
    ).toBe(generateColorCompose(config, 'blue'));
  });

  for (const color of COLORS) {
    test(`${color}, one process: platform alone is the app, the API and the jobs`, () => {
      const services = shaped(UNIFIED, color);
      expect(Object.keys(services)).toEqual(['platform']);
      const platform = services.platform;
      expect(platform?.image).toBe('ghcr.io/tale-project/tale-platform:0.2.17');
      expect(platform?.container_name).toBeUndefined();
      expect(platform?.depends_on).toBeUndefined();
      expect(platform?.environment).toMatchObject({
        TALE_ROLE: 'all',
        TALE_COLOR: color,
        // The API's port. The app listens on APP_PORT, 3000 unless set.
        PORT: '3005',
        TALE_CONFIG_DIR: '/app/data',
        SANDBOX_HTTP_API_BASE_URL: 'http://backend-api:3005',
      });
      expect(platform?.environment?.APP_PORT).toBeUndefined();
      expect(platform?.environment?.DATABASE_URL).toContain('@db:5432/');
      // It writes the config store, and publishes the app's bundles.
      expect(platform?.volumes).toEqual([
        'config-data:/app/data',
        'static-assets:/app/static-assets',
      ]);
      // A backend process: the egress firewall and the backend's bounds.
      expect(platform?.cap_add).toEqual(['NET_ADMIN']);
      expect(platform?.mem_limit).toBe('12g');
      expect(platform?.pids_limit).toBe(4096);
      // Healthy when it serves the app, which it does once the API is up.
      expect(platform?.healthcheck).toEqual({
        test: [
          'CMD-SHELL',
          'curl -sf http://localhost:3000/api/health && [ -f /tmp/platform-ready ]',
        ],
        interval: '5s',
        timeout: '3s',
        retries: 3,
        start_period: '180s',
      });
    });

    test(`${color}, one process: platform answers both serving names, the API's on the sandbox network too`, () => {
      const networks = shaped(UNIFIED, color).platform?.networks as Networks;
      expect(networks.internal?.aliases).toEqual([
        'platform',
        `platform-${color}`,
        'backend-api',
        `backend-api-${color}`,
      ]);
      expect(networks.sandbox?.aliases).toEqual([
        'backend-api',
        `backend-api-${color}`,
      ]);
    });

    test(`${color}, one process: platform declares the web tier's routes and the API's, under the colour's names`, () => {
      const three = shaped(THREE_WAY, color);
      const labels = shaped(UNIFIED, color).platform?.labels ?? {};
      // Exactly what the two services of a colour of three declare between
      // them: the edge routes a colour of either shape alike.
      expect(labels).toEqual({
        ...three.platform?.labels,
        ...three['backend-api']?.labels,
      });
      expect(
        labels[
          `traefik.http.services.platform-${color}.loadbalancer.server.url`
        ],
      ).toBe('http://platform:3000');
      expect(
        labels[
          `traefik.http.services.backend-api-${color}.loadbalancer.server.url`
        ],
      ).toBe('http://backend-api:3005');
      // A container that declares two services must name one per router.
      const routers = Object.keys(labels).filter((key) =>
        /^traefik\.http\.routers\.[^.]+\.rule$/.test(key),
      );
      expect(routers.length).toBeGreaterThan(4);
      for (const rule of routers)
        expect(labels[rule.replace(/\.rule$/, '.service')], rule).toMatch(
          new RegExp(`^(platform|backend-api)-${color}(-direct)?$`),
        );
    });

    test(`${color}, the jobs apart: platform is the API and the app, backend-worker runs the jobs`, () => {
      const services = shaped(SPLIT, color);
      expect(Object.keys(services).toSorted()).toEqual([
        'backend-worker',
        'platform',
      ]);
      expect(services.platform?.environment).toMatchObject({
        TALE_ROLE: 'api',
        TALE_COLOR: color,
        PORT: '3005',
      });
      expect(services['backend-worker']?.environment).toMatchObject({
        TALE_ROLE: 'worker',
        TALE_COLOR: color,
      });
      // The same doors as the one process: only the jobs moved out.
      const one = shaped(UNIFIED, color).platform;
      expect(services.platform?.labels).toEqual(one?.labels);
      expect(services.platform?.networks).toEqual(one?.networks);
      expect(services.platform?.volumes).toEqual(one?.volumes);
      expect(services.platform?.healthcheck).toEqual(one?.healthcheck);
      // And the worker is the worker of a colour of three.
      expect(services['backend-worker']).toEqual(
        shaped(THREE_WAY, color)['backend-worker'],
      );
    });
  }

  test('the routers of two colours never share a name, whatever shapes overlap in a flip', () => {
    const routerNames = (labels: Record<string, string> = {}) =>
      Object.keys(labels)
        .filter((key) => key !== 'traefik.enable')
        .map((key) => key.split('.').slice(0, 4).join('.'));
    for (const tier of [UNIFIED, SPLIT, THREE_WAY])
      for (const other of [UNIFIED, SPLIT, THREE_WAY]) {
        const blue = Object.values(shaped(tier, 'blue')).flatMap((service) =>
          routerNames(service.labels),
        );
        const green = new Set(
          Object.values(shaped(other, 'green')).flatMap((service) =>
            routerNames(service.labels),
          ),
        );
        expect(blue.filter((name) => green.has(name))).toEqual([]);
      }
  });

  test('a platform that runs the jobs gets the room a worker gets to hand its runs on', () => {
    expect(shaped(UNIFIED).platform?.stop_grace_period).toBe('120s');
    // Without the jobs: the wait for the edge, the api's drain, and 15 s.
    expect(shaped(SPLIT).platform?.stop_grace_period).toBe('45s');
    expect(shaped(SPLIT)['backend-worker']?.stop_grace_period).toBe('120s');
  });

  test('its grace holds the wait for the edge before the drain, each following its variable', () => {
    // 6 s for the edge, the operator's drain, 15 s above.
    withEnv({ SHUTDOWN_DRAIN_MS: '300000' }, () => {
      expect(shaped(UNIFIED).platform?.stop_grace_period).toBe('321s');
      expect(shaped(SPLIT).platform?.stop_grace_period).toBe('321s');
    });
    // A longer wait for the edge, before the role's own drain.
    withEnv({ SHUTDOWN_DRAIN_SECONDS: '60' }, () => {
      expect(shaped(UNIFIED).platform?.stop_grace_period).toBe('165s');
      expect(shaped(SPLIT).platform?.stop_grace_period).toBe('90s');
    });
    withEnv(
      { SHUTDOWN_DRAIN_SECONDS: '60', SHUTDOWN_DRAIN_MS: '120000' },
      () => {
        expect(shaped(UNIFIED).platform?.stop_grace_period).toBe('195s');
      },
    );
    // A drain shorter than the role's still never lowers the grace, and a
    // wait the platform would refuse keeps its default.
    withEnv(
      { SHUTDOWN_DRAIN_SECONDS: 'a while', SHUTDOWN_DRAIN_MS: '5000' },
      () => {
        expect(shaped(UNIFIED).platform?.stop_grace_period).toBe('120s');
        expect(shaped(SPLIT).platform?.stop_grace_period).toBe('45s');
      },
    );
  });

  test('one process opens few database connections, each size a default that .env replaces', () => {
    // Every connection is a PostgreSQL process on the other side, and the
    // polls of an idle deployment keep a pool's connections open.
    const environment = shaped(UNIFIED).platform?.environment ?? {};
    expect(ONE_PROCESS_POOLS).toEqual({
      DATABASE_POOL_MAX: 4,
      JOBS_DATABASE_POOL_MAX: 3,
      AUTH_DATABASE_POOL_MAX: 2,
      KNOWLEDGE_DB_POOL_MAX: 5,
    });
    expect(environment.DATABASE_POOL_MAX).toBe('${DATABASE_POOL_MAX:-4}');
    expect(environment.AUTH_DATABASE_POOL_MAX).toBe(
      '${AUTH_DATABASE_POOL_MAX:-2}',
    );
    expect(environment.KNOWLEDGE_DB_POOL_MAX).toBe(
      '${KNOWLEDGE_DB_POOL_MAX:-5}',
    );
    // The job queue's pool follows an application pool .env sized, as it
    // did before it had a variable of its own.
    expect(environment.JOBS_DATABASE_POOL_MAX).toBe(
      '${JOBS_DATABASE_POOL_MAX:-${DATABASE_POOL_MAX:-3}}',
    );
  });

  test('the pools of one process hold its queue, its listener and its workers', () => {
    // The backend warns at boot when the knowledge pool is below the jobs a
    // worker runs at once (WORKER_CONCURRENCY, 5 unless set).
    expect(ONE_PROCESS_POOLS.KNOWLEDGE_DB_POOL_MAX).toBeGreaterThanOrEqual(5);
    // A serializable transaction holds one connection for its whole length,
    // and the job queue fetches while it settles a job.
    expect(ONE_PROCESS_POOLS.DATABASE_POOL_MAX).toBeGreaterThanOrEqual(2);
    expect(ONE_PROCESS_POOLS.JOBS_DATABASE_POOL_MAX).toBeGreaterThanOrEqual(2);
    for (const size of Object.values(ONE_PROCESS_POOLS))
      expect(Number.isInteger(size) && size > 0).toBe(true);
  });

  test('a process that is not the whole application keeps the backend’s own pool sizes', () => {
    // With the jobs apart, or as three services, a process is a replica
    // among others: the sizes are the backend's, or the operator's.
    const sized = (service: ComposeService | undefined): string[] =>
      Object.keys(service?.environment ?? {}).filter((name) =>
        name.endsWith('_POOL_MAX'),
      );
    expect(sized(shaped(UNIFIED).platform).toSorted()).toEqual([
      'AUTH_DATABASE_POOL_MAX',
      'DATABASE_POOL_MAX',
      'JOBS_DATABASE_POOL_MAX',
      'KNOWLEDGE_DB_POOL_MAX',
    ]);
    for (const service of Object.values(shaped(SPLIT)))
      expect(sized(service)).toEqual([]);
    for (const service of Object.values(shaped(THREE_WAY)))
      expect(sized(service)).toEqual([]);
  });

  test('--host reaches platform in every shape, with the blob URL of the run', () => {
    const origin = {
      host: 'tale.example.com',
      siteUrl: 'https://tale.example.com:8443',
    };
    for (const appTier of [UNIFIED, SPLIT]) {
      const platform = (
        parse(generateColorCompose({ ...config, appTier }, 'blue', origin)) as {
          services: Record<string, ComposeService>;
        }
      ).services.platform;
      expect(platform?.environment).toMatchObject({
        HOST: 'tale.example.com',
        SITE_URL: 'https://tale.example.com:8443',
        OBJECT_STORE_PUBLIC_ENDPOINT:
          '${OBJECT_STORE_PUBLIC_ENDPOINT:-https://tale.example.com:8443}',
      });
    }
  });

  test('every shape mounts the same two external volumes and joins the same two networks', () => {
    for (const appTier of [UNIFIED, SPLIT, THREE_WAY]) {
      const compose = parse(
        generateColorCompose({ ...config, appTier }, 'blue'),
      ) as {
        volumes: Record<string, unknown>;
        networks: Record<string, unknown>;
      };
      expect(Object.keys(compose.volumes).toSorted()).toEqual([
        'config-data',
        'static-assets',
      ]);
      expect(Object.keys(compose.networks).toSorted()).toEqual([
        'internal',
        'sandbox',
      ]);
    }
  });
});
