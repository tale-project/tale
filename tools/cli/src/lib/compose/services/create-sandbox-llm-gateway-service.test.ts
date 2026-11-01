import { afterEach, describe, expect, test } from 'bun:test';

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

  test('reads the deployment .env, where its setup token (the gateway admin password) comes from', () => {
    expect(createSandboxLlmGatewayService(config).env_file).toContain('.env');
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

  test('gives the calls in flight 90s to finish when a deploy stops the gateway', () => {
    expect(createSandboxLlmGatewayService(config).stop_grace_period).toBe(
      '90s',
    );
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

describe('createSandboxLlmGatewayService memory limit', () => {
  const original = {
    memory: process.env.SANDBOX_LLM_GATEWAY_MEMORY,
    sessions: process.env.SANDBOX_MAX_SESSIONS,
  };

  afterEach(() => {
    if (original.memory === undefined) {
      delete process.env.SANDBOX_LLM_GATEWAY_MEMORY;
    } else process.env.SANDBOX_LLM_GATEWAY_MEMORY = original.memory;
    if (original.sessions === undefined)
      delete process.env.SANDBOX_MAX_SESSIONS;
    else process.env.SANDBOX_MAX_SESSIONS = original.sessions;
  });

  function limitFor(env: { memory?: string; sessions?: string }) {
    if (env.memory === undefined) delete process.env.SANDBOX_LLM_GATEWAY_MEMORY;
    else process.env.SANDBOX_LLM_GATEWAY_MEMORY = env.memory;
    if (env.sessions === undefined) delete process.env.SANDBOX_MAX_SESSIONS;
    else process.env.SANDBOX_MAX_SESSIONS = env.sessions;
    return createSandboxLlmGatewayService(config).mem_limit;
  }

  // A fixed 512m was OOM-killed every 40 s at about 80 of 320 sessions; 4g
  // held the same deployment.
  test('grows with SANDBOX_MAX_SESSIONS past the 512m that ran out at 80 sessions', () => {
    expect(limitFor({ sessions: '80' })).toBe('1216m');
    expect(limitFor({ sessions: '320' })).toBe('4096m');
  });

  test("keeps 512m for the spawner's default of 8 sessions", () => {
    expect(limitFor({ sessions: '8' })).toBe('512m');
    expect(limitFor({ sessions: '1' })).toBe('512m');
  });

  test('sizes an unset capacity for the 256 sessions the spawner may size itself to', () => {
    expect(limitFor({})).toBe('3328m');
    expect(limitFor({ sessions: ' ' })).toBe('3328m');
    expect(limitFor({ memory: '', sessions: '' })).toBe('3328m');
  });

  test('takes SANDBOX_LLM_GATEWAY_MEMORY over the capacity, in MiB', () => {
    expect(limitFor({ memory: '4g' })).toBe('4096m');
    expect(limitFor({ memory: '4096m' })).toBe('4096m');
    expect(limitFor({ memory: ' 4096MB ' })).toBe('4096m');
    expect(limitFor({ memory: '2g', sessions: '320' })).toBe('2048m');
  });

  test('refuses a memory setting that is no size, or under 512m', () => {
    for (const memory of ['4 GB', 'abc', '-1g', '1.5g', '4t', '9'.repeat(20)]) {
      expect(() => limitFor({ memory })).toThrow(
        `Env var SANDBOX_LLM_GATEWAY_MEMORY is not a size such as 4g or 4096m: ${JSON.stringify(memory)}`,
      );
    }
    for (const memory of ['0', '256m', '511m']) {
      expect(() => limitFor({ memory })).toThrow(
        'Env var SANDBOX_LLM_GATEWAY_MEMORY must be at least 512m',
      );
    }
  });

  test('refuses the Kubernetes spelling, which compose refuses as mem_limit', () => {
    for (const memory of ['4Gi', '4096Mi', '4gi']) {
      expect(() => limitFor({ memory })).toThrow(
        `Env var SANDBOX_LLM_GATEWAY_MEMORY is not a size such as 4g or 4096m: ${JSON.stringify(memory)}`,
      );
    }
  });

  test('refuses a capacity the spawner would refuse at boot', () => {
    expect(() => limitFor({ sessions: 'many' })).toThrow(
      'Env var SANDBOX_MAX_SESSIONS is not a finite number: "many"',
    );
    expect(() => limitFor({ sessions: '0' })).toThrow(
      'Env var SANDBOX_MAX_SESSIONS must be >= 1; got: 0',
    );
  });
});
