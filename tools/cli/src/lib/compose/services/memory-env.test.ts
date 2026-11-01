import { afterEach, describe, expect, test } from 'bun:test';

import { setProjectId } from '../../project/project-context';
import type { ServiceConfig } from '../types';
import {
  createBackendApiService,
  createBackendWorkerService,
} from './create-backend-services';
import { createDbService } from './create-db-service';
import { createPlatformService } from './create-platform-service';
import { createSandboxService } from './create-sandbox-service';

// getProjectId() (used for container_name) throws unless the project context
// has been initialised, so seed it once for these unit tests.
setProjectId('test-project');

const config = {
  version: '0.2.17',
  registry: 'ghcr.io/tale-project',
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
