import { describe, expect, test } from 'bun:test';

import { setProjectId } from '../../project/project-context';
import type { ServiceConfig } from '../types';
import { createLlmGatewayService } from './create-llm-gateway-service';

// getProjectId() (used for container_name) throws unless the project context
// has been initialised, so seed it once for these unit tests.
setProjectId('test-project');

const config = {
  version: '0.2.17',
  registry: 'ghcr.io/tale-project',
} satisfies ServiceConfig;

describe('createLlmGatewayService', () => {
  test('uses the tale-llm-gateway image at the configured registry + version', () => {
    expect(createLlmGatewayService(config).image).toBe(
      'ghcr.io/tale-project/tale-llm-gateway:0.2.17',
    );
  });

  test('names the container <projectId>-llm-gateway', () => {
    expect(createLlmGatewayService(config).container_name).toBe(
      'test-project-llm-gateway',
    );
  });

  test('mounts the llm-gateway-data volume at /app/data', () => {
    expect(createLlmGatewayService(config).volumes).toContain(
      'llm-gateway-data:/app/data',
    );
  });

  test('joins BOTH the internal and sandbox networks', () => {
    const networks = createLlmGatewayService(config).networks;
    if (Array.isArray(networks) || networks === undefined) {
      throw new Error('llm-gateway networks should be the object form');
    }
    expect(networks.internal).toBeDefined();
    expect(networks.sandbox).toBeDefined();
  });

  test('healthchecks the gateway on :8080/health via wget', () => {
    const command = createLlmGatewayService(config).healthcheck?.test;
    if (!Array.isArray(command)) {
      throw new Error(
        'llm-gateway healthcheck test should be a CMD-SHELL array',
      );
    }
    const shell = command.join(' ');
    expect(shell).toContain('wget');
    expect(shell).toContain('http://127.0.0.1:8080/health');
  });
});
