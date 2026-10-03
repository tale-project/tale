// Gemini 0.60+ accepts only root-owned system settings. Bake the finite
// settings shapes emitted by our existing interpreter into the image; the
// wrapper selects their content hash, so an old image never silently drops a
// new policy. Only the bridge URL and context filename vary per execution.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { HarnessDefinition } from '@tale/shared/schemas/providers';

import { buildHarnessExec } from '../platform/lib/harnesses/exec-builder';
import type { HarnessCredential } from '../platform/lib/harnesses/types';

export const GEMINI_BRIDGE_URL = '${TALE_GEMINI_BRIDGE_URL}';
export const GEMINI_CONTEXT_FILE = '${TALE_GEMINI_CONTEXT_FILE}';

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${sortedJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function geminiPolicies(fact: HarnessDefinition) {
  const policies = new Map<string, Record<string, unknown>>();
  for (const managed of [false, true]) {
    const credential: HarnessCredential = managed
      ? {
          mode: 'managed',
          gateway: {
            baseUrl: 'http://build.invalid',
            token: 'build-placeholder',
            streamIdleTimeoutMs: 600_000,
            requestTimeoutMs: 600_000,
          },
        }
      : { mode: 'byo', env: {} };
    for (const browser of [false, true]) {
      for (const bridge of managed ? [false, true] : [false]) {
        const exec = buildHarnessExec(fact, {
          workdir: '/agent/workspace',
          prompt: 'Build Gemini settings',
          credential,
          mcp: {
            ...(browser ? { browser: 'headless' as const } : {}),
            ...(bridge ? { bridgeUrl: GEMINI_BRIDGE_URL } : {}),
          },
        });
        const payload: unknown = JSON.parse(exec.stdin ?? '{}');
        if (
          payload === null ||
          typeof payload !== 'object' ||
          !('settings' in payload) ||
          payload.settings === null ||
          typeof payload.settings !== 'object' ||
          Array.isArray(payload.settings)
        ) {
          throw new Error('Gemini harness must emit a settings object');
        }
        const settings = payload.settings;
        const hash = createHash('sha256')
          .update(sortedJson(settings))
          .digest('hex');
        policies.set(`${hash}.json`, {
          ...settings,
          context: { fileName: ['GEMINI.md', GEMINI_CONTEXT_FILE] },
        });
      }
    }
  }
  return policies;
}

if (import.meta.main) {
  const destination = process.argv[2];
  if (!destination) throw new Error('Pass the policy output directory');
  // This is the repository's trusted source file. The catalog/schema and
  // golden exec tests validate it; no dependency install is needed at build.
  const fact = Bun.YAML.parse(
    readFileSync(
      resolve(
        import.meta.dir,
        '../../configs/platform/system/harnesses/gemini/harness.yml',
      ),
      'utf8',
    ),
  ) as HarnessDefinition;
  mkdirSync(destination, { recursive: true, mode: 0o755 });
  for (const [name, policy] of geminiPolicies(fact)) {
    writeFileSync(join(destination, name), `${JSON.stringify(policy)}\n`, {
      mode: 0o644,
    });
  }
}
