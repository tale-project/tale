import { describe, expect, it } from 'vitest';

import { sandboxDevicePlatformSchema } from './sandbox-devices';

const docker = { os: 'linux', arch: 'x64', cpus: 8, memoryBytes: 1024 ** 3 };

describe('sandboxDevicePlatformSchema', () => {
  it('still reads a platform from a device older than raw devices', () => {
    expect(
      sandboxDevicePlatformSchema.parse({ ...docker, dockerVersion: '27.1.1' }),
    ).toEqual({ ...docker, dockerVersion: '27.1.1' });
  });

  it('reads a raw device with its isolation and harnesses', () => {
    const raw = {
      ...docker,
      dockerVersion: null,
      runtime: 'raw',
      isolation: 'isolated',
      harnesses: [
        { id: 'claude-code', version: '2.1.285' },
        { id: 'codex', version: null },
      ],
    };
    expect(sandboxDevicePlatformSchema.parse(raw)).toEqual(raw);
  });

  it('reads a Docker device that reports its runtime with null harnesses', () => {
    const dockerDevice = {
      ...docker,
      runtime: 'docker',
      isolation: null,
      harnesses: null,
    };
    expect(sandboxDevicePlatformSchema.parse(dockerDevice)).toEqual(
      dockerDevice,
    );
  });

  it('refuses an unknown runtime or isolation', () => {
    expect(
      sandboxDevicePlatformSchema.safeParse({ ...docker, runtime: 'vm' })
        .success,
    ).toBe(false);
    expect(
      sandboxDevicePlatformSchema.safeParse({ ...docker, isolation: 'none' })
        .success,
    ).toBe(false);
  });

  it('bounds the harness list and each id', () => {
    const many = Array.from({ length: 33 }, (_, i) => ({
      id: `h${i}`,
      version: null,
    }));
    expect(
      sandboxDevicePlatformSchema.safeParse({ ...docker, harnesses: many })
        .success,
    ).toBe(false);
    expect(
      sandboxDevicePlatformSchema.safeParse({
        ...docker,
        harnesses: [{ id: 'x'.repeat(49), version: null }],
      }).success,
    ).toBe(false);
  });
});
