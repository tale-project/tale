import { describe, expect, test } from 'bun:test';

import { setProjectId } from '../../project/project-context';
import type { ServiceConfig } from '../types';
import { createSandboxLlmGatewayService } from './create-sandbox-llm-gateway-service';

// getProjectId() (used for container_name) throws unless the project context
// has been initialised, so seed it once for these unit tests.
setProjectId('test-project');

const config = {
  version: '0.2.17',
  registry: 'ghcr.io/tale-project',
} satisfies ServiceConfig;

describe('createSandboxLlmGatewayService', () => {
  test('uses the tale-sandbox-llm-gateway image at the configured registry + version', () => {
    expect(createSandboxLlmGatewayService(config).image).toBe(
      'ghcr.io/tale-project/tale-sandbox-llm-gateway:0.2.17',
    );
  });

  test('names the container <projectId>-sandbox-llm-gateway', () => {
    expect(createSandboxLlmGatewayService(config).container_name).toBe(
      'test-project-sandbox-llm-gateway',
    );
  });

  test('keeps the pre-rename llm-gateway-data volume at /app/data', () => {
    expect(createSandboxLlmGatewayService(config).volumes).toContain(
      'llm-gateway-data:/app/data',
    );
  });

  test('joins BOTH networks with a transitional `llm-gateway` alias', () => {
    const networks = createSandboxLlmGatewayService(config).networks;
    if (Array.isArray(networks) || networks === undefined) {
      throw new Error('sandbox-llm-gateway networks should be the object form');
    }
    expect(networks.internal?.aliases).toContain('llm-gateway');
    expect(networks.sandbox?.aliases).toContain('llm-gateway');
  });

  test('healthchecks the gateway on :8080/health via wget', () => {
    const healthcheck = createSandboxLlmGatewayService(config).healthcheck;
    const command =
      healthcheck !== undefined && 'test' in healthcheck
        ? healthcheck.test
        : undefined;
    if (!Array.isArray(command)) {
      throw new Error(
        'sandbox-llm-gateway healthcheck test should be a CMD-SHELL array',
      );
    }
    const shell = command.join(' ');
    expect(shell).toContain('wget');
    expect(shell).toContain('http://127.0.0.1:8080/health');
  });
});
