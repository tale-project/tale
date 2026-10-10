import { afterEach, expect, test } from 'bun:test';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { valueHash } from '../config/releases/identity';
import { resolveConfigurationSource } from './configuration-source';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'configuration-source-')),
  );
  roots.push(root);
  await mkdir(join(root, 'cycle'));
  await writeFile(
    join(root, 'cycle', 'policy.md'),
    'Review the complete scope.\n',
  );
  await writeFile(
    join(root, 'cycle', 'flow.yml'),
    'name: example/review\nnodes: []\ntests: []\n',
  );
  const definition = {
    name: 'example/review',
    projectId: 'project-1',
    document: { name: 'example/review', nodes: [], tests: [] },
    settings: null,
    presentation: null,
    taskContract: null,
  };
  const declaration = {
    schemaVersion: 1,
    resources: [
      {
        kind: 'project-instructions',
        config: { projectId: 'project-1', instructions: { file: 'policy.md' } },
      },
      {
        kind: 'automation-definition',
        config: { ...definition, document: { file: 'flow.yml' } },
      },
      {
        kind: 'automation-deployment',
        config: {
          projectId: 'project-1',
          name: definition.name,
          definitionSha256: valueHash(definition),
        },
      },
      {
        kind: 'agent-tools',
        config: {
          projectId: 'project-1',
          agentId: 'agent-1',
          tools: ['task_review', 'task_get', 'task_review'],
        },
      },
    ],
  };
  const source = join(root, 'cycle', 'configuration.json');
  await writeFile(source, JSON.stringify(declaration));
  return {
    root,
    source,
    declaration,
    spec: { configurationSource: 'cycle/configuration.json' },
    specPath: join(root, 'tale.json'),
  };
}

test('captures referenced files as ordinary immutable configuration without retaining source paths', async () => {
  const f = await fixture();
  const result = (await resolveConfigurationSource(f.spec, f.specPath)) as {
    configuration: { resources: { config: Record<string, unknown> }[] };
    configurationSource?: string;
  };
  expect(result.configurationSource).toBeUndefined();
  expect(result.configuration.resources[0]?.config.instructions).toBe(
    'Review the complete scope.\n',
  );
  expect(result.configuration.resources[1]?.config.document).toEqual({
    name: 'example/review',
    nodes: [],
    tests: [],
  });
  expect(result.configuration.resources[3]?.config).toEqual({
    projectId: 'project-1',
    agentId: 'agent-1',
    tools: ['task_get', 'task_review'],
  });
  await writeFile(join(f.root, 'cycle', 'policy.md'), 'Later source edit');
  expect(result.configuration.resources[0]?.config.instructions).toBe(
    'Review the complete scope.\n',
  );
});

test('rejects competing sources, traversal, symlink escapes, secrets and oversized files', async () => {
  const f = await fixture();
  await expect(
    resolveConfigurationSource({ ...f.spec, configuration: {} }, f.specPath),
  ).rejects.toThrow('never both');
  await expect(
    resolveConfigurationSource(
      { configurationSource: '../configuration.json' },
      f.specPath,
    ),
  ).rejects.toThrow();
  await symlink(
    join(f.root, 'cycle', 'policy.md'),
    join(f.root, 'cycle', 'link.md'),
  );
  for (const file of ['../outside.md', 'link.md', '.env']) {
    const changed = JSON.parse(await readFile(f.source, 'utf8'));
    changed.resources[0].config.instructions = { file };
    await writeFile(f.source, JSON.stringify(changed));
    await expect(
      resolveConfigurationSource(f.spec, f.specPath),
    ).rejects.toThrow();
  }
  await writeFile(f.source, JSON.stringify(f.declaration));
  await writeFile(
    join(f.root, 'cycle', 'policy.md'),
    'x'.repeat(512 * 1024 + 1),
  );
  await expect(resolveConfigurationSource(f.spec, f.specPath)).rejects.toThrow(
    'byte limit',
  );
});

test('rejects YAML duplicate keys and changed workflow bytes against the reviewed digest', async () => {
  const f = await fixture();
  await writeFile(
    join(f.root, 'cycle', 'flow.yml'),
    'name: example/review\nname: changed\n',
  );
  await expect(resolveConfigurationSource(f.spec, f.specPath)).rejects.toThrow(
    'YAML is invalid',
  );
  await writeFile(
    join(f.root, 'cycle', 'flow.yml'),
    'name: example/review\nnodes: []\ntests: []\ndescription: changed\n',
  );
  await expect(
    resolveConfigurationSource(f.spec, f.specPath),
  ).rejects.toThrow();
});

test('keeps existing inline deployment input unchanged', async () => {
  const input = { configuration: { schemaVersion: 1, resources: [] } };
  expect(await resolveConfigurationSource(input, '/unused/spec.json')).toBe(
    input,
  );
});
