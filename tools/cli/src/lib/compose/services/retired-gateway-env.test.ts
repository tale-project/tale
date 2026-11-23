import { describe, expect, test } from 'bun:test';

import { setProjectId } from '../../project/project-context';
import { SPLIT, THREE_WAY, UNIFIED } from '../app-tier';
import { buildColorCompose } from '../generators/generate-color-compose';
import type { ServiceConfig } from '../types';

setProjectId('test-project');

const config = {
  version: '0.6.0',
  registry: 'ghcr.io/tale-project',
} satisfies ServiceConfig;

/**
 * Once the sandbox LLM gateway an earlier release ran is gone, a colour tells
 * every backend role so, with SANDBOX_LLM_GATEWAY_URL empty: the backend then
 * reads the gateway as retired without looking its name up, a lookup that a
 * host whose resolver cannot answer reports as unfinished rather than as a
 * name that does not exist (tale-project/tale#4942).
 */
describe('what a colour tells its backend of the retired gateway', () => {
  for (const tier of [UNIFIED, SPLIT, THREE_WAY]) {
    test(`${tier.shape}: every backend role hears that it is retired once its container is gone`, () => {
      const { services } = buildColorCompose(
        { ...config, appTier: tier, gatewayRetired: true },
        'blue',
      );
      for (const [name, service] of Object.entries(services)) {
        if (service.environment?.TALE_ROLE === undefined) {
          // The web tier alone asks the gateway nothing.
          expect(service.environment ?? {}, name).not.toHaveProperty(
            'SANDBOX_LLM_GATEWAY_URL',
          );
          continue;
        }
        expect(service.environment, name).toMatchObject({
          SANDBOX_LLM_GATEWAY_URL: '',
        });
      }
    });

    test(`${tier.shape}: while the gateway is there, no role is told anything of it`, () => {
      for (const known of [{ gatewayRetired: false }, {}]) {
        const { services } = buildColorCompose(
          { ...config, appTier: tier, ...known },
          'green',
        );
        for (const [name, service] of Object.entries(services)) {
          expect(service.environment ?? {}, name).not.toHaveProperty(
            'SANDBOX_LLM_GATEWAY_URL',
          );
        }
      }
    });
  }
});
