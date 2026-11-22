import { describe, expect, test } from 'bun:test';

import { setProjectId } from '../../project/project-context';
import type { ServiceConfig } from '../types';
import {
  createBackendApiService,
  createBackendWorkerService,
  createPlatformBackendService,
} from './create-backend-services';

setProjectId('test-project');

const config = {
  version: '0.6.0',
  registry: 'ghcr.io/tale-project',
} satisfies ServiceConfig;

/**
 * The model relay runs in every process that serves the API, on a port of
 * its own, and binds its address in the sandbox network alone where the
 * deploy says which subnet that is (tale-project/tale#4942).
 */
describe('where the model relay listens', () => {
  test('a process that serves the API is told the sandbox subnet the deploy read', () => {
    const subnet = { ...config, sandboxNetworkSubnet: '172.30.0.0/16' };
    expect(
      createBackendApiService(subnet, { colour: 'blue' }).environment,
    ).toMatchObject({ SANDBOX_NETWORK_SUBNET: '172.30.0.0/16' });
    expect(
      createPlatformBackendService(subnet, 'green', 'all').environment,
    ).toMatchObject({ SANDBOX_NETWORK_SUBNET: '172.30.0.0/16' });
    expect(
      createPlatformBackendService(subnet, 'green', 'api').environment,
    ).toMatchObject({ SANDBOX_NETWORK_SUBNET: '172.30.0.0/16' });
  });

  test('without a subnet read, the process reads .env, and without one there listens beside the API', () => {
    expect(createBackendApiService(config).environment).toMatchObject({
      SANDBOX_NETWORK_SUBNET: '${SANDBOX_NETWORK_SUBNET:-}',
    });
  });

  test('a worker runs no relay and is told nothing of it', () => {
    expect(
      createBackendWorkerService({
        ...config,
        sandboxNetworkSubnet: '172.30.0.0/16',
      }).environment,
    ).not.toHaveProperty('SANDBOX_NETWORK_SUBNET');
  });
});
