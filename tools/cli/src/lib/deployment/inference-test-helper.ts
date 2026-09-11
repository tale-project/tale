import { expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inferenceFixture } from '../inference/tests/fixture';
import { INFERENCE_IMAGES } from './inference';
import { resolveDeploymentSpec } from './model';
import type { RuntimeDependencies } from './runtime-model';

export async function managedInferenceFixture(
  organization = 'synthetic-client',
) {
  const root = await mkdtemp(join(tmpdir(), 'tale-managed-inference-'));
  const repo = join(root, 'source');
  await mkdir(join(repo, 'tale/inference'), { recursive: true });
  const source = inferenceFixture();
  source.organization = organization;
  const input = {
    ...source,
    nodes: source.nodes.map((node) => ({
      ...node,
      address: { env: 'TALE_NODE_ADDRESS' },
    })),
  };
  await writeFile(
    join(repo, 'tale/inference/spec.json'),
    JSON.stringify(input, null, 2) + '\n',
  );
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString('utf8')
      .trim();
  git('init');
  git('config', 'user.name', 'Synthetic CLI Test');
  git('config', 'user.email', 'cli-test@example.invalid');
  git('-c', 'core.autocrlf=false', 'add', 'tale/inference/spec.json');
  git(
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'test: pin synthetic inference source',
  );
  const revision = git('rev-parse', 'HEAD');
  const spec = resolveDeploymentSpec(
    {
      schemaVersion: 1,
      name: 'north',
      stateDirectory: join(root, 'state'),
      composeProject: 'north',
      origin: 'https://north.example',
      tlsMode: 'external',
      runtime: { revision: 'c'.repeat(40), platform: 'linux/amd64' },
      identity: {
        email: { env: 'OPERATOR_EMAIL' },
        slug: source.organization,
        name: 'North',
        ssoEnabled: false,
      },
      inference: {
        repository: 'https://github.com/north/client',
        revision: { env: 'SOURCE_REF' },
        specPath: 'tale/inference/spec.json',
        overlayNetwork: { env: 'TALE_APP_NETWORK' },
      },
    },
    { SOURCE_REF: revision },
  );
  const calls: string[][] = [];
  const dependencies: RuntimeDependencies = {
    exec: async (command, args, options) => {
      expect(command).toBe('docker');
      expect(options?.silent).toBe(true);
      calls.push(args);
      const image = INFERENCE_IMAGES.find((entry) =>
        args.includes(entry.reference),
      );
      if (!image) throw new Error('unexpected synthetic Docker command');
      return {
        success: true,
        exitCode: 0,
        stderr: '',
        stdout:
          args[0] === 'pull'
            ? ''
            : JSON.stringify([
                {
                  Os: 'linux',
                  Architecture: 'amd64',
                  RepoDigests: [
                    image.repository + '@' + image.reference.split('@')[1],
                  ],
                  Config: { Labels: {} },
                },
              ]),
      };
    },
  };
  const output = join(root, 'output');
  return {
    root,
    repo,
    revision,
    source,
    spec,
    output,
    dependencies,
    calls,
    environment: { TALE_NODE_ADDRESS: '10.201.99.50' },
  };
}
