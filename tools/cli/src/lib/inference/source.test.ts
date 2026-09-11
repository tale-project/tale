import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sha256 } from '../config/releases/identity';
import {
  prepareManagedInference,
  verifyManagedInference,
} from '../deployment/inference';
import { managedInferenceFixture } from '../deployment/inference-test-helper';
import { withDeploymentSources } from '../deployment/sources';
import { prepareInferenceFromSource, verifyInferenceBundle } from './bundle';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
  delete process.env.TALE_NODE_ADDRESS;
});
const acquire: typeof withDeploymentSources = (requests, options, work) =>
  withDeploymentSources(
    requests,
    {
      ...options,
      run: async (command, args, config) => {
        expect(command).toBe('git');
        const stdout = execFileSync(command, args, {
          cwd: config?.cwd,
          env: config?.env,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 30_000,
        }).toString('utf8');
        return { success: true, exitCode: 0, stdout, stderr: '' };
      },
    },
    work,
  );
async function fixture() {
  const f = await managedInferenceFixture();
  roots.push(f.root);
  const sources = join(f.root, 'sources.json');
  await writeFile(
    sources,
    JSON.stringify({
      [`${f.spec.inference!.repository}@${f.revision}`]: f.repo,
    }),
  );
  process.env.TALE_NODE_ADDRESS = f.environment.TALE_NODE_ADDRESS;
  const options = {
    repository: f.spec.inference!.repository,
    sourceRef: f.revision,
    spec: f.spec.inference!.specPath,
    sources,
    output: join(f.root, 'standalone'),
  };
  return { ...f, options };
}

describe('committed inference preparation without model downloads', () => {
  test('standalone and managed paths preserve the same committed bytes and bundle identity', async () => {
    const f = await fixture();
    const original = await readFile(join(f.repo, f.options.spec));
    await writeFile(join(f.repo, f.options.spec), '{"dirty":"ignored"}');
    const standalone = await prepareInferenceFromSource(f.options, acquire);
    expect(standalone.source?.sha256).toBe(sha256(original));
    expect(standalone.source?.revision).toBe(f.revision);
    expect(Buffer.from(standalone.source!.content)).toEqual(original);
    expect(standalone.spec.nodes[0]?.address).toBe(
      f.environment.TALE_NODE_ADDRESS,
    );
    await prepareManagedInference(
      f.repo,
      f.output,
      f.spec,
      f.dependencies,
      f.environment,
    );
    const managed = await verifyManagedInference(f.output, f.spec);
    expect(managed.bundle).toEqual(standalone);
    expect(
      await verifyInferenceBundle(f.options.output, standalone.bundleSha256),
    ).toEqual(standalone);
    expect(await readFile(join(f.repo, f.options.spec), 'utf8')).toBe(
      '{"dirty":"ignored"}',
    );
  }, 30_000);

  test.each(['source', 'revision', 'resolved-address'] as const)(
    'refuses changed %s under the selected bundle hash',
    async (kind) => {
      const f = await fixture();
      const bundle = await prepareInferenceFromSource(f.options, acquire);
      const value = structuredClone(bundle);
      if (kind === 'source') value.source!.content += '\n';
      if (kind === 'revision') value.source!.revision = 'f'.repeat(40);
      if (kind === 'resolved-address')
        value.spec.nodes[0]!.address = '10.1.2.3';
      await writeFile(
        join(f.options.output, 'inference.json'),
        JSON.stringify(value),
      );
      await expect(
        verifyInferenceBundle(f.options.output, bundle.bundleSha256),
      ).rejects.toThrow();
    },
    30_000,
  );

  test('refuses moving refs, missing source paths and source-key ambiguity before output', async () => {
    const f = await fixture();
    for (const change of [
      { sourceRef: 'main' },
      { spec: '../escape.json' },
      { spec: 'missing.json' },
    ]) {
      await expect(
        prepareInferenceFromSource({ ...f.options, ...change }, acquire),
      ).rejects.toThrow();
    }
  }, 30_000);
});
