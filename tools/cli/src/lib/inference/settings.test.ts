import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GIB, parseInferenceSpec } from './model';
import {
  containsSettings,
  inferenceSecrets,
  launchAgentPlist,
  omlxModelSettings,
  omlxSettings,
} from './settings';
import { inferenceFixture } from './tests/fixture';

describe('pinned oMLX service settings', () => {
  test('separates admin/service secrets, model roles and bounded resource controls', () => {
    const spec = parseInferenceSpec(inferenceFixture());
    const node = spec.nodes[0]!;
    const secrets = inferenceSecrets(spec, node, {
      [node.adminKey.env]: 'a'.repeat(32),
      [spec.serviceKey.env]: 's'.repeat(32),
    });
    const settings = omlxSettings(
      spec,
      node,
      '/Users/inference/Library/Application Support/Tale/inference/studio-one',
      'd'.repeat(64),
      secrets,
      512 * GIB,
    );
    expect(settings.server.host).toBe('127.0.0.1,10.70.0.10');
    expect(settings.server.cors_origins).toEqual([]);
    expect(settings.model.model_fallback).toBe(false);
    expect(settings.server.distributed_inference_enabled).toBe(false);
    expect(settings.auth.skip_api_key_verification).toBe(false);
    expect(settings.auth.api_key).not.toBe(settings.auth.sub_keys[0]!.key);
    expect(settings.scheduler).toEqual({
      max_concurrent_requests: 1,
      embedding_batch_size: 1,
      chunked_prefill: true,
    });
    expect(settings.memory.memory_guard_custom_ceiling_gb).toBe(480);
    expect(settings.cache.hot_cache_max_size).toBe('0B');
    const models = Object.values(omlxModelSettings(spec, node).models);
    expect(models[0]?.model_alias).toBe('Example-Model');
    expect(models[0]?.model_type_override).toBe('llm');
    expect(models[0]?.is_default).toBe(false);
    expect(models[0]?.is_pinned).toBe(false);
  });
  test.each([
    undefined,
    'short',
    'a b'.repeat(20),
    'a\n'.repeat(32),
    'a'.repeat(257),
  ])(
    'refuses unsafe secret material without including it in the error',
    (key) => {
      const spec = parseInferenceSpec(inferenceFixture());
      const node = spec.nodes[0]!;
      expect(() =>
        inferenceSecrets(spec, node, {
          [node.adminKey.env]: key,
          [spec.serviceKey.env]: 's'.repeat(32),
        }),
      ).toThrow(
        'Inference API keys require 32–256 URL-safe characters from their declared environment variables.',
      );
    },
  );
  test('refuses reuse of the admin key for service requests', () => {
    const spec = parseInferenceSpec(inferenceFixture());
    const node = spec.nodes[0]!;
    expect(() =>
      inferenceSecrets(spec, node, {
        [node.adminKey.env]: 'a'.repeat(32),
        [spec.serviceKey.env]: 'a'.repeat(32),
      }),
    ).toThrow('Inference requires separate admin and service keys');
  });
  test('accepts materialized upstream defaults but refuses explicit setting drift', () => {
    expect(
      containsSettings(
        { one: { fixed: false, materialized: true } },
        { one: { fixed: false } },
      ),
    ).toBe(true);
    expect(
      containsSettings({ one: { fixed: true } }, { one: { fixed: false } }),
    ).toBe(false);
    expect(
      containsSettings(
        { values: ['expected', 'extra'] },
        { values: ['expected'] },
      ),
    ).toBe(false);
    expect(containsSettings(null, { one: false })).toBe(false);
  });
  test.skipIf(process.platform !== 'darwin')(
    'validates real plist argv with spaces through Apple plutil without executing Python',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'tale-inference-plist-'));
      try {
        const spec = parseInferenceSpec(inferenceFixture());
        const node = spec.nodes[0]!;
        const file = join(root, 'agent.plist');
        const state =
          '/Users/inference/Library/Application Support/Tale/inference/studio-one';
        await writeFile(
          file,
          launchAgentPlist(
            node,
            state,
            'd'.repeat(64),
            `${state}/runtime/oMLX.app`,
          ),
        );
        // This is a native parser integration, independent of the Docker exec
        // mocks installed globally by other Bun test files.
        expect(
          execFileSync('/usr/bin/plutil', ['-lint', file], {
            encoding: 'utf8',
          }),
        ).toContain(': OK');
        const args = execFileSync(
          '/usr/bin/plutil',
          ['-extract', 'ProgramArguments', 'json', '-o', '-', file],
          { encoding: 'utf8' },
        );
        expect(JSON.parse(args)).toEqual([
          `${state}/runtime/oMLX.app/Contents/Resources/Python/cpython-3.11/bin/python3`,
          '-s',
          `${state}/releases/${'d'.repeat(64)}/runtime-admission.py`,
        ]);
        const text = await readFile(file, 'utf8');
        expect(text).not.toContain('TALE_SECRETS');
        expect(text).not.toContain('OMLX_API_KEY');
        expect(text).toContain('HF_HUB_OFFLINE');
        expect(text).toContain('WEB_CONCURRENCY');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
