import { describe, expect, test } from 'bun:test';

import {
  GIB,
  inferenceStateDirectory,
  modelIdentity,
  parseInferenceSpec,
  resolveInferenceSpec,
} from './model';
import { inferenceFixture as fixture } from './tests/fixture';

describe('inference specification trust boundary', () => {
  test.each(['{env.SECRET}', 'model\nname', 'model"name', 'model`name'])(
    'refuses catalog placeholder or quoting syntax in model ID %s',
    (apiModel) => {
      const input = fixture();
      input.models[0]!.apiModel = apiModel;
      expect(() => parseInferenceSpec(input)).toThrow(
        'Invalid inference specification',
      );
    },
  );
  test('keeps immutable model identity and conservative reversible defaults', () => {
    const spec = parseInferenceSpec(fixture());
    expect(spec.limits).toEqual({
      memoryReserveBytes: 32 * GIB,
      diskReserveBytes: 32 * GIB,
      ssdCacheBytes: 16 * GIB,
      hotCacheBytes: 0,
      concurrency: 1,
      queuedRequests: 4,
      queueTimeoutSeconds: 1800,
      requestTimeoutSeconds: 1800,
    });
    expect(spec.nodes[0]?.port).toBe(18080);
    expect(inferenceStateDirectory(spec.nodes[0]!)).toBe(
      '/Users/inference/Library/Application Support/Tale/inference/studio-one',
    );
    const first = spec.models[0]!;
    expect(modelIdentity(first)).toBe(
      modelIdentity({ ...first, files: [...first.files].reverse() }),
    );
    expect(modelIdentity(first)).not.toBe(
      modelIdentity({ ...first, revision: 'b'.repeat(40) }),
    );
    expect(modelIdentity(first)).not.toBe(
      modelIdentity({ ...first, contextTokens: 8192 }),
    );
  });

  test.each(['main', 'v1.0', 'a'.repeat(39), 'a'.repeat(40) + '\n'])(
    'refuses moving or malformed model revision %s',
    (revision) => {
      const input = fixture();
      input.models[0]!.revision = revision;
      expect(() => parseInferenceSpec(input)).toThrow(
        'Invalid inference specification',
      );
    },
  );

  test.each([
    '../model.safetensors',
    'sub/../model.safetensors',
    '/model.safetensors',
    'sub\\model.safetensors',
    'MODEL.SAFETENSORS',
    'bad\nname',
  ])('refuses unsafe or Mac-colliding model filename %s', (filename) => {
    const input = fixture();
    input.models[0]!.files.push({
      path: filename,
      bytes: 10,
      sha256: 'c'.repeat(64),
    });
    expect(() => parseInferenceSpec(input)).toThrow(
      'Invalid inference specification',
    );
  });

  test.each([
    '0.0.0.0',
    '8.8.8.8',
    '169.254.169.254',
    'api.example.com',
    '10.70.0.10\n',
  ])(
    'refuses public, wildcard, metadata or unbound DNS address %s',
    (address) => {
      const input = fixture();
      input.nodes[0]!.address = address;
      expect(() => parseInferenceSpec(input)).toThrow(
        'Invalid inference specification',
      );
    },
  );

  test('requires GLM native kernels and preserves separate capability declarations', () => {
    const input = fixture();
    input.models[0]!.requiredKernels = [];
    expect(() => parseInferenceSpec(input)).toThrow(
      'Invalid inference specification',
    );
    const embedding = fixture();
    embedding.models[0]!.capability = 'embedding';
    expect(() => parseInferenceSpec(embedding)).toThrow(
      'Invalid inference specification',
    );
    expect(
      parseInferenceSpec({
        ...embedding,
        models: [{ ...embedding.models[0], embeddingDimensions: 1024 }],
      }).models[0]?.embeddingDimensions,
    ).toBe(1024);
  });

  test('refuses role names and vector widths the native provider boundary cannot represent', () => {
    const input = fixture();
    for (const key of ['a'.repeat(60), 'role_with_underscore']) {
      expect(() =>
        parseInferenceSpec({
          ...input,
          models: [{ ...input.models[0], key }],
          nodes: [{ ...input.nodes[0], models: [key] }],
        }),
      ).toThrow('Invalid inference specification');
    }
    expect(() =>
      parseInferenceSpec({
        ...input,
        models: [
          {
            ...input.models[0],
            capability: 'embedding',
            embeddingDimensions: 16001,
          },
        ],
      }),
    ).toThrow('Invalid inference specification');
  });

  test('refuses duplicate, unknown and uncovered node/model targets', () => {
    const input = fixture();
    expect(() =>
      parseInferenceSpec({ ...input, nodes: [...input.nodes, ...input.nodes] }),
    ).toThrow();
    input.nodes[0]!.models = ['missing'];
    expect(() => parseInferenceSpec(input)).toThrow();
    input.nodes[0]!.models = ['reasoning', 'reasoning'];
    expect(() => parseInferenceSpec(input)).toThrow();
  });

  test('keeps credentials as references and scrubs invalid values', () => {
    const secret = 'never-print-this-secret';
    const input = fixture();
    expect(() => parseInferenceSpec({ ...input, serviceKey: secret })).toThrow(
      'Invalid inference specification',
    );
    input.nodes[0]!.adminKey.env = input.serviceKey.env;
    expect(() => parseInferenceSpec(input)).toThrow();
    expect(() => parseInferenceSpec({ ...fixture(), apiKey: secret })).toThrow(
      'Invalid inference specification',
    );
  });

  test('refuses unsafe byte totals and resource settings', () => {
    const input = fixture();
    input.models[0]!.files[1]!.bytes = Number.MAX_SAFE_INTEGER;
    expect(() => parseInferenceSpec(input)).toThrow();
    expect(() =>
      parseInferenceSpec({ ...fixture(), limits: { memoryReserveBytes: 0 } }),
    ).toThrow();
    expect(() =>
      parseInferenceSpec({ ...fixture(), limits: { concurrency: 0 } }),
    ).toThrow();
  });
  test('resolves only public node addresses from environment and freezes the result', () => {
    const raw = fixture();
    const source = {
      ...raw,
      nodes: [
        { ...raw.nodes[0], address: { env: 'TALE_INFERENCE_NODE_ADDRESS' } },
      ],
    };
    const value = resolveInferenceSpec(source, {
      TALE_INFERENCE_NODE_ADDRESS: '10.70.0.10',
    });
    expect(value.nodes[0]?.address).toBe('10.70.0.10');
    expect(source.nodes[0]?.address).toEqual({
      env: 'TALE_INFERENCE_NODE_ADDRESS',
    });
    expect(() => parseInferenceSpec(source)).toThrow();
    expect(() => resolveInferenceSpec(source, {})).toThrow(
      'address environment',
    );
    expect(() =>
      resolveInferenceSpec(source, {
        TALE_INFERENCE_NODE_ADDRESS: 'https://secret.invalid',
      }),
    ).toThrow('private IPv4');
  });
  test.each([
    'model.py',
    '__pycache__/model.pyc',
    '.git/config',
    'weights.pkl',
    'load.pth',
    'helper.dylib',
  ])('refuses executable model repository file %s', (path) => {
    const raw = fixture();
    raw.models[0]!.files.push({ path, sha256: 'e'.repeat(64), bytes: 5 });
    expect(() => parseInferenceSpec(raw)).toThrow();
  });
});
