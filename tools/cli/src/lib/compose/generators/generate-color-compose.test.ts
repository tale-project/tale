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

describe('generateColorCompose ↔ controller restart contract', () => {
  // The controller resolves rotatable services by candidate labels
  // {rag, rag-blue, rag-green} across projects {P, P-blue, P-green}
  // (services/controller/src/targets.ts). If the color compose renamed the
  // `rag` service key or its container, "Apply & restart" would silently match
  // zero containers on a blue-green deployment. Pin the naming convention here.
  for (const color of ['blue', 'green'] as const) {
    test(`emits compose service key + container rag-${color}`, () => {
      const compose = parse(generateColorCompose(config, color)) as {
        services: Record<string, { container_name?: string }>;
      };
      expect(Object.keys(compose.services)).toContain(`rag-${color}`);
      expect(compose.services[`rag-${color}`]?.container_name).toBe(
        `tale-rag-${color}`,
      );
    });
  }
});
