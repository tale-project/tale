import { describe, expect, test } from 'bun:test';

import { parse } from 'yaml';

import { setProjectId } from '../../project/project-context';
import type { ServiceConfig } from '../types';
import { generateColorCompose } from './generate-color-compose';

// getProjectId() (used for container_name) throws unless seeded.
setProjectId('tale');

const config = {
  version: '0.2.17',
  registry: 'ghcr.io/tale-project',
} satisfies ServiceConfig;

describe('generateColorCompose ↔ container naming contract', () => {
  // `tale restore` discovers running containers by candidate names
  // {P-platform, P-platform-blue, P-platform-green} (restore.ts), and the
  // blue/green deploy flow addresses the colors by the same convention. If
  // the color compose renamed the `platform` service key or its container,
  // that discovery would silently match zero containers on a blue-green
  // deployment. Pin the naming convention here.
  for (const color of ['blue', 'green'] as const) {
    test(`emits compose service key + container platform-${color}`, () => {
      const compose = parse(generateColorCompose(config, color)) as {
        services: Record<string, { container_name?: string }>;
      };
      expect(Object.keys(compose.services)).toContain(`platform-${color}`);
      expect(compose.services[`platform-${color}`]?.container_name).toBe(
        `tale-platform-${color}`,
      );
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
  for (const color of ['blue', 'green'] as const) {
    test(`platform-${color} sets stop_grace_period >= ${MIN_GRACE_SECONDS}s`, () => {
      const compose = parse(generateColorCompose(config, color)) as {
        services: Record<string, { stop_grace_period?: string }>;
      };
      const grace = compose.services[`platform-${color}`]?.stop_grace_period;
      expect(grace).toBeDefined();
      expect(grace).toMatch(/^\d+s$/);
      expect(Number.parseInt(grace as string, 10)).toBeGreaterThanOrEqual(
        MIN_GRACE_SECONDS,
      );
    });
  }
});
