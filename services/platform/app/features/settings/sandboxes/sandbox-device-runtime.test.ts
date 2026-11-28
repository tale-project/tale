import { describe, expect, it } from 'vitest';

import type { SandboxDevicePlatform } from '@/lib/shared/schemas/sandbox-devices';

import {
  deviceRuntime,
  dockerEngineOf,
  harnessDisplayName,
  harnessList,
} from './sandbox-device-runtime';

const base = { os: 'linux', arch: 'x64' };

describe('harnessDisplayName', () => {
  it('names the shipped harnesses as the product does', () => {
    expect(harnessDisplayName('claude-code')).toBe('Claude Code');
    expect(harnessDisplayName('codex')).toBe('Codex');
    expect(harnessDisplayName('gemini')).toBe('Gemini CLI');
    expect(harnessDisplayName('qwen-code')).toBe('Qwen Code');
    expect(harnessDisplayName('opencode')).toBe('OpenCode');
  });

  it('shows an unknown id as its own slug, and never a prototype member', () => {
    expect(harnessDisplayName('future-agent')).toBe('future-agent');
    expect(harnessDisplayName('constructor')).toBe('constructor');
  });
});

describe('harnessList', () => {
  it('joins each name with its version, and drops a missing one', () => {
    expect(
      harnessList([
        { id: 'claude-code', version: '2.1.285' },
        { id: 'codex', version: null },
        { id: 'pi', version: '0.9.0' },
      ]),
    ).toBe('Claude Code 2.1.285, Codex, Pi 0.9.0');
  });
});

describe('deviceRuntime', () => {
  it('reads a device without a runtime as Docker', () => {
    expect(deviceRuntime({ ...base })).toBe('docker');
  });

  it('reads the runtime a device reports', () => {
    expect(deviceRuntime({ ...base, runtime: 'raw' })).toBe('raw');
  });
});

describe('dockerEngineOf', () => {
  const old = {
    ...base,
    dockerVersion: '20.10.24',
  } satisfies SandboxDevicePlatform;

  it('returns the engine of a Docker device', () => {
    expect(dockerEngineOf(old)).toBe('20.10.24');
    expect(dockerEngineOf({ ...old, runtime: 'docker' })).toBe('20.10.24');
  });

  it('names no engine for a raw device, or for no platform', () => {
    expect(dockerEngineOf({ ...old, runtime: 'raw' })).toBeNull();
    expect(dockerEngineOf(null)).toBeNull();
  });
});
