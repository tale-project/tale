import { describe, expect, test } from 'bun:test';

import {
  memoryProofSchema,
  observeMemoryPressure,
  withMemoryAdmission,
} from './pressure';

describe('target memory admission without changing host memory policy', () => {
  test('decodes only read-only sysctl output and the exported normal dispatch mask', async () => {
    const calls: string[][] = [];
    const result = await observeMemoryPressure(
      async (command, args, options) => {
        expect(['/usr/sbin/sysctl', '/usr/bin/vm_stat']).toContain(command);
        expect(options?.silent).toBe(true);
        calls.push(args);
        return {
          success: true,
          exitCode: 0,
          stderr: '',
          stdout:
            command === '/usr/bin/vm_stat'
              ? 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nSwapouts: 1234.\n'
              : args[1] === 'vm.swapusage'
                ? 'total = 1024.00M  used = 1.50M  free = 1022.50M (encrypted)'
                : '1\n',
        };
      },
    );
    expect(result).toEqual({
      pressure: 1,
      swapUsedBytes: 1572864,
      swapOutPages: 1234,
    });
    expect(
      calls.every(
        (args) => args.length === 0 || (args[0] === '-n' && args.length === 2),
      ),
    ).toBe(true);
  });
  test('refuses missing or malformed pressure observations', async () => {
    await expect(
      observeMemoryPressure(async () => ({
        success: true,
        exitCode: 0,
        stdout: 'private malformed output',
        stderr: '',
      })),
    ).rejects.toThrow('could not prove');
  });
  test('does not start a workload while baseline memory pressure is present', async () => {
    let started = false;
    await expect(
      withMemoryAdmission(
        async () => {
          started = true;
        },
        async () => ({ pressure: 2, swapUsedBytes: 0, swapOutPages: 100 }),
      ),
    ).rejects.toThrow('already reports');
    expect(started).toBe(false);
  });
  test.each(['swap', 'churn', 'counter-reset', 'pressure', 'unavailable'])(
    'refuses %s after a completed synthetic workload',
    async (mode) => {
      let samples = 0;
      await expect(
        withMemoryAdmission(
          async () => 'completed',
          async () => {
            samples++;
            if (samples > 1 && mode === 'unavailable')
              throw new Error('private host data');
            return {
              pressure: samples > 1 && mode === 'pressure' ? 4 : 1,
              swapUsedBytes: samples > 1 && mode === 'swap' ? 1 : 0,
              swapOutPages:
                samples > 1
                  ? mode === 'churn'
                    ? 101
                    : mode === 'counter-reset'
                      ? 0
                      : 100
                  : 100,
            };
          },
        ),
      ).rejects.toThrow('not admitted');
    },
  );
  test('preserves result and explicitly bounds the no-pressure observation', async () => {
    const result = await withMemoryAdmission(
      async () => 42,
      async () => ({ pressure: 1, swapUsedBytes: 10, swapOutPages: 100 }),
    );
    expect(result.result).toBe(42);
    expect(result.memory.samples).toBe(2);
    expect(result.memory.continuousPressureMonitoring).toBe(false);
    expect(result.memory.noSwapGrowthObserved).toBe(true);
    expect(result.memory.baselineSwapOutPages).toBe(100);
    expect(result.memory.finalSwapOutPages).toBe(100);
    expect(
      memoryProofSchema.safeParse({ ...result.memory, finalSwapUsedBytes: 11 })
        .success,
    ).toBe(false);
    expect(
      memoryProofSchema.safeParse({
        ...result.memory,
        maximumSampledSwapUsedBytes: 0,
      }).success,
    ).toBe(false);
    expect(
      memoryProofSchema.safeParse({ ...result.memory, finalSwapOutPages: 101 })
        .success,
    ).toBe(false);
  });
  test('retains a pressure hold even when the final sample recovers', async () => {
    let samples = 0;
    await expect(
      withMemoryAdmission(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 2100));
        },
        async () => ({
          pressure: ++samples === 2 ? 2 : 1,
          swapUsedBytes: 0,
          swapOutPages: 100,
        }),
      ),
    ).rejects.toThrow('not admitted');
    expect(samples).toBe(3);
  });
});
