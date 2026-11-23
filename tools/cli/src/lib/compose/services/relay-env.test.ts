import { describe, expect, test } from 'bun:test';

import { setProjectId } from '../../project/project-context';
import { SPLIT, THREE_WAY, UNIFIED } from '../app-tier';
import { buildColorCompose } from '../generators/generate-color-compose';
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

/**
 * A session calls the relay at `backend-api:8080`, a name both colours answer
 * on the sandbox network while a deploy flips them, so Docker hands the
 * session the addresses of both. Its HTTP client moves on from an address
 * that refuses the connection to the next one, which is why the first deploy
 * of the relay loses no call: the colour of the earlier release refuses port
 * 8080 at once, having no relay. Within a colour no process may answer that
 * name without a relay of its own, or it would refuse a share of the calls
 * for as long as it runs. Sessions are never handed a colour's own name
 * instead: a turn outlives the colour that started it, a session's
 * `NO_PROXY` exempts `backend-api` alone, and a connected device answers
 * only the names it joined with.
 */
describe('who answers the relay name on the sandbox network', () => {
  for (const tier of [UNIFIED, SPLIT, THREE_WAY]) {
    for (const colour of ['blue', 'green'] as const) {
      test(`${tier.shape}, ${colour}: exactly the processes that serve the API, each with its relay`, () => {
        const { services } = buildColorCompose(
          { ...config, appTier: tier, sandboxNetworkSubnet: '172.30.0.0/16' },
          colour,
        );
        const answering: string[] = [];
        const serving: string[] = [];
        for (const [name, service] of Object.entries(services)) {
          const networks = Array.isArray(service.networks)
            ? {}
            : (service.networks ?? {});
          if (networks.sandbox?.aliases?.includes('backend-api'))
            answering.push(name);
          const role = service.environment?.TALE_ROLE;
          if (role === 'api' || role === 'all') serving.push(name);
        }
        expect(answering).not.toEqual([]);
        expect(answering.sort()).toEqual(serving.sort());
        for (const name of answering) {
          expect(services[name]?.environment).toMatchObject({
            SANDBOX_NETWORK_SUBNET: '172.30.0.0/16',
          });
        }
      });
    }
  }
});
