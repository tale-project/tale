import { describe, expect, test } from 'bun:test';

import { parse } from 'yaml';

import { setProjectId } from '../../project/project-context';
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
      ]);
      expect(compose.services['backend-api']?.volumes).toEqual([
        'config-data:/app/data',
      ]);
    }
  });
});
