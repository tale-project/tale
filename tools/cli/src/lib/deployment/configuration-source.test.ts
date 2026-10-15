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

import { stringify } from 'yaml';

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

test('reads the configuration declaration written as YAML to the same result as JSON', async () => {
  const f = await fixture();
  const fromJson = await resolveConfigurationSource(f.spec, f.specPath);
  await writeFile(
    join(f.root, 'cycle', 'configuration.yml'),
    stringify(f.declaration),
  );
  expect(
    await resolveConfigurationSource(
      { configurationSource: 'cycle/configuration.yml' },
      join(f.root, 'tale.yml'),
    ),
  ).toEqual(fromJson);
  // A declaration YAML spells twice is refused before any schema reads it.
  await writeFile(
    join(f.root, 'cycle', 'configuration.yml'),
    'schemaVersion: 1\nschemaVersion: 1\nresources: []\n',
  );
  await expect(
    resolveConfigurationSource(
      { configurationSource: 'cycle/configuration.yml' },
      join(f.root, 'tale.yml'),
    ),
  ).rejects.toThrow('Deployment declaration YAML is invalid.');
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

test('merges included declaration files, each resolving its own references, before validating the whole', async () => {
  const f = await fixture();
  await mkdir(join(f.root, 'cycle', 'agents'));
  await writeFile(
    join(f.root, 'cycle', 'agents', 'reviewer.md'),
    'Review closely.\n',
  );
  await writeFile(
    join(f.root, 'cycle', 'agents', 'agents.yml'),
    stringify({
      schemaVersion: 1,
      resources: [
        {
          kind: 'agent-instructions',
          config: {
            projectId: 'project-1',
            agentId: 'agent-1',
            instructions: { file: 'reviewer.md' },
          },
        },
      ],
    }),
  );
  await writeFile(
    f.source,
    JSON.stringify({ ...f.declaration, include: ['agents/agents.yml'] }),
  );
  const result = (await resolveConfigurationSource(f.spec, f.specPath)) as {
    configuration: { resources: { kind: string; config: object }[] };
  };
  expect(result.configuration.resources.map(({ kind }) => kind)).toEqual([
    'project-instructions',
    'automation-definition',
    'automation-deployment',
    'agent-tools',
    'agent-instructions',
  ]);
  expect(result.configuration.resources[4]?.config).toEqual({
    projectId: 'project-1',
    agentId: 'agent-1',
    instructions: 'Review closely.',
  });
  // The bundle holds the merged declaration: no include survives.
  expect(JSON.stringify(result)).not.toContain('include');
});

test('refuses a file included twice, an include cycle and an include outside its directory', async () => {
  const f = await fixture();
  const part = { schemaVersion: 1, include: ['configuration.json'] };
  await writeFile(join(f.root, 'cycle', 'part.json'), JSON.stringify(part));
  for (const [include, refusal] of [
    [['part.json'], 'included more than once'],
    [['other.json', 'other.json'], 'included more than once'],
    [['../outside.json'], 'is not a declaration'],
    [['policy.md'], 'must be JSON or YAML'],
  ] as const) {
    await writeFile(
      join(f.root, 'cycle', 'other.json'),
      JSON.stringify({ schemaVersion: 1 }),
    );
    await writeFile(f.source, JSON.stringify({ ...f.declaration, include }));
    await expect(
      resolveConfigurationSource(f.spec, f.specPath),
      JSON.stringify(include),
    ).rejects.toThrow(refusal);
  }
});

test('reads a file several resources name once, and holds 512 resources across its files', async () => {
  const f = await fixture();
  const instructions = (count: number, from = 0) =>
    Array.from({ length: count }, (_, index) => ({
      kind: 'project-instructions',
      config: {
        projectId: `project-${from + index}`,
        instructions: { file: 'policy.md' },
      },
    }));
  // 512 references to one file: counted once against the file limit.
  await writeFile(
    join(f.root, 'cycle', 'more.json'),
    JSON.stringify({ schemaVersion: 1, resources: instructions(312, 200) }),
  );
  await writeFile(
    f.source,
    JSON.stringify({
      schemaVersion: 1,
      resources: instructions(200),
      include: ['more.json'],
    }),
  );
  const result = (await resolveConfigurationSource(f.spec, f.specPath)) as {
    configuration: { resources: { config: { instructions: string } }[] };
  };
  expect(result.configuration.resources).toHaveLength(512);
  expect(
    new Set(
      result.configuration.resources.map(({ config }) => config.instructions),
    ),
  ).toEqual(new Set(['Review the complete scope.\n']));
  await writeFile(
    join(f.root, 'cycle', 'more.json'),
    JSON.stringify({ schemaVersion: 1, resources: instructions(313, 200) }),
  );
  await expect(resolveConfigurationSource(f.spec, f.specPath)).rejects.toThrow(
    'more than 512 resources',
  );
});
