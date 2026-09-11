import { describe, expect, test } from 'bun:test';

import { GIB, parseInferenceSpec } from './model';
import {
  admitInference,
  hardwareSchema,
  planInference,
  type InferenceHardware,
} from './plan';
import { inferenceFixture } from './tests/fixture';

const hardware = (): InferenceHardware => ({
  platform: 'darwin',
  architecture: 'arm64',
  macOSMajor: 15,
  user: 'inference',
  home: '/Users/inference',
  hostName: 'studio-one',
  uid: 501,
  administrator: false,
  launchdUserDomain: true,
  addresses: ['10.70.0.10'],
  memoryBytes: 512 * GIB,
  freeDiskBytes: 1024 * GIB,
  metalWorkingSetBytes: 480 * GIB,
  availableKernels: ['glm_moe_dsa'],
});

describe('inference destination admission', () => {
  test('admits one evictable active role while retaining every declared model on disk', () => {
    const raw = inferenceFixture();
    const spec = parseInferenceSpec({
      ...raw,
      models: [390, 19, 4].map((size, index) =>
        Object.assign({}, raw.models[0], {
          key: `role-${index}`,
          apiModel: `Model-${index}`,
          files: [
            { path: 'config.json', bytes: 100, sha256: 'a'.repeat(64) },
            {
              path: 'model.safetensors',
              bytes: size * GIB,
              sha256: 'b'.repeat(64),
            },
          ],
        }),
      ),
      nodes: [{ ...raw.nodes[0], models: ['role-0', 'role-1', 'role-2'] }],
    });
    const result = admitInference(spec, 'studio-one', hardware());
    expect(result.weightsBytes).toBe(413 * GIB);
    expect(result.largestRoleWeightsBytes).toBe(390 * GIB);
    expect(result.softTargetBytes).toBe(408 * GIB);
    expect(result.maximumConcurrentRoles).toBe(1);
    expect(result.residency).toBe('evictable-on-demand');
    expect(result.requiredMemoryBytes).toBe(480.5 * GIB);
    expect(result.requiredFreeDiskBytes).toBeGreaterThan(413 * GIB);
    expect(result.coldSwitchLatencyMeasured).toBe(false);
    spec.models[0]!.files[1]!.bytes = 409 * GIB;
    expect(() => admitInference(spec, 'studio-one', hardware())).toThrow(
      'soft admission',
    );
  });
  test('reports absence of hardware without inventing readiness or performance', () => {
    const [plan] = planInference(parseInferenceSpec(inferenceFixture()));
    expect(plan?.ready).toBe(false);
    expect(plan?.performanceMeasured).toBe(false);
    expect(plan?.reasons).toEqual([
      'Destination hardware has not been observed.',
    ]);
  });
  test('counts weights, working memory, cache and all reserved bytes', () => {
    const spec = parseInferenceSpec(inferenceFixture());
    const admitted = admitInference(spec, 'studio-one', hardware());
    expect(admitted.requiredMemoryBytes).toBe(44 * GIB);
    expect(admitted.modelBytes).toBe(4 * GIB + 100);
    expect(admitted.ready).toBe(true);
    expect(admitted.requiredFreeDiskBytes).toBeGreaterThan(52 * GIB);
  });
  test('allows replay after exact model byte verification without erasing the disk reserve', () => {
    const spec = parseInferenceSpec(inferenceFixture());
    const before = admitInference(spec, 'studio-one', hardware());
    const observed = {
      ...hardware(),
      freeDiskBytes: before.requiredFreeDiskBytes - before.modelBytes,
    };
    expect(() => admitInference(spec, 'studio-one', observed)).toThrow(
      'Free disk',
    );
    expect(
      admitInference(spec, 'studio-one', observed, false, before.modelBytes)
        .ready,
    ).toBe(true);
    expect(() =>
      admitInference(
        spec,
        'studio-one',
        { ...observed, freeDiskBytes: 0 },
        false,
        before.modelBytes,
      ),
    ).toThrow('Free disk');
    expect(() =>
      admitInference(
        spec,
        'studio-one',
        observed,
        false,
        before.modelBytes + 1,
      ),
    ).toThrow('byte credit');
  });
  test('uses an observed explicit Metal cap without assuming that physical RAM is GPU capacity', () => {
    const spec = parseInferenceSpec(inferenceFixture());
    const observed = {
      ...hardware(),
      metalWorkingSetBytes: 6 * GIB,
      metalWiredLimitBytes: 0,
    };
    expect(() => admitInference(spec, 'studio-one', observed)).toThrow(
      'Metal effective',
    );
    expect(
      admitInference(spec, 'studio-one', {
        ...observed,
        metalWiredLimitBytes: 12 * GIB,
      }).effectiveMetalLimitBytes,
    ).toBe(12 * GIB);
    expect(() =>
      admitInference(spec, 'studio-one', {
        ...hardware(),
        metalWiredLimitBytes: 4 * GIB,
      }),
    ).toThrow('Metal effective');
    expect(() =>
      admitInference(spec, 'studio-one', {
        ...observed,
        memoryBytes: 12 * GIB,
        metalWiredLimitBytes: 100 * GIB,
      }),
    ).toThrow('Physical memory');
  });
  test.each([
    { platform: 'linux' },
    { architecture: 'x64' },
    { macOSMajor: 14 },
    { user: 'root' },
    { home: '/tmp/home' },
    { hostName: 'wrong' },
    { uid: 0 },
    { administrator: true },
    { launchdUserDomain: false },
    { addresses: [] },
    { memoryBytes: GIB },
    { freeDiskBytes: GIB },
    { metalWorkingSetBytes: GIB },
    { availableKernels: [] },
  ])('refuses an unqualified destination %j', (change) => {
    expect(() =>
      admitInference(
        parseInferenceSpec(inferenceFixture()),
        'studio-one',
        hardwareSchema.parse({
          ...hardware(),
          ...change,
        }),
      ),
    ).toThrow('Inference admission refused');
  });
  test('permits only kernel/Metal absence before verified runtime installation', () => {
    const observed = hardware();
    delete observed.availableKernels;
    delete observed.metalWorkingSetBytes;
    const spec = parseInferenceSpec(inferenceFixture());
    expect(() => admitInference(spec, 'studio-one', observed)).toThrow();
    expect(() =>
      admitInference(spec, 'studio-one', observed, true),
    ).not.toThrow();
    expect(() =>
      admitInference(
        spec,
        'studio-one',
        { ...observed, freeDiskBytes: 0 },
        true,
      ),
    ).toThrow();
  });
  test('does not treat another Mac as enough RAM for an experimental sharded model', () => {
    const spec = parseInferenceSpec({
      ...inferenceFixture(),
      mode: 'experimental-sharding',
    });
    expect(() => admitInference(spec, 'studio-one', hardware())).toThrow(
      'Experimental sharding',
    );
    expect(() => admitInference(spec, 'unknown', hardware())).toThrow(
      'not declared',
    );
  });
});
