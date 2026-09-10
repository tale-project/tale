import { afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { stringify } from 'yaml';

import { verifyArtifactBytes } from '../artifacts';
import { buildRelease, type BuildOptions } from '../release';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
export function temporary(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'tale-config-test-'));
  roots.push(root);
  return root;
}
export function fixture(
  clientId = 'acme',
  skills = ['invoice'],
  external: string[] = [],
) {
  const root = temporary();
  const descriptorPath = path.join(
    root,
    `tale/clients/${clientId}/client.json`,
  );
  const directory = path.dirname(descriptorPath);
  const name = `${clientId}-intake`;
  const automation = {
    name,
    displayName: `${clientId} document intake`,
    packPath: `packs/${name}`,
    releasesPath: 'releases',
    logicalSkillSlugs: skills,
    requiredExternalSkills: external,
    historicalReleases: [],
  };
  const descriptor = {
    schemaVersion: 1,
    clientId,
    sourceRepository: 'https://github.com/example/ops',
    automations: [automation],
  };
  mkdirSync(directory, { recursive: true });
  writeFileSync(descriptorPath, JSON.stringify(descriptor));
  const pack = path.join(directory, automation.packPath);
  mkdirSync(pack, { recursive: true });
  const document = {
    name,
    nodes: [
      { id: 'start', type: 'start' },
      ...skills.map((skill, index) => ({
        id: `script-${index}`,
        type: 'sandbox.run_script',
        input: { skill, entry: 'scripts/run.py' },
      })),
      ...(external.length
        ? [
            {
              id: 'author',
              type: 'agent',
              skills: [...skills, ...external],
              prompt: `Use ${skills.map((skill) => `/skills/${skill}`).join(' and ')}. Do not rewrite ${skills[0]}-unrelated.`,
            },
          ]
        : []),
    ],
  };
  const metadata = {
    name: automation.displayName,
    scope: 'project',
    skills,
    settings: { enabled: true },
    subjects: { task: { workflow: name, externalSystem: clientId } },
  };
  writeFileSync(path.join(pack, 'workflow.yml'), stringify(document));
  writeFileSync(path.join(pack, 'automation.yml'), stringify(metadata));
  writeFileSync(path.join(pack, 'README.md'), 'Pack documentation\n');
  for (const skill of skills) {
    mkdirSync(path.join(pack, 'skills', skill, 'scripts'), { recursive: true });
    writeFileSync(
      path.join(pack, 'skills', skill, 'SKILL.md'),
      `---\nname: ${skill}\ndescription: Process documents\n---\n# Skill body\n`,
    );
    writeFileSync(
      path.join(pack, 'skills', skill, 'scripts/run.py'),
      'print("done")\n',
      { mode: 0o755 },
    );
    writeFileSync(path.join(pack, 'skills', skill, '.gitignore'), 'cache/\n');
  }
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '--quiet');
  git('add', '--all');
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  );
  const options = {
    repoRoot: root,
    descriptorPath,
    automationName: name,
    sourceCommit: git('rev-parse', 'HEAD'),
    version: '2.3.4',
    skillOwnerUserId: 'native_owner_test',
    validateNative: verifyArtifactBytes,
  } satisfies BuildOptions;
  return {
    root,
    descriptorPath,
    directory,
    name,
    pack,
    descriptor,
    options,
    git,
    document,
    metadata,
  };
}
export async function released(
  clientId = 'acme',
  skills = ['invoice'],
  external: string[] = [],
) {
  const source = fixture(clientId, skills, external);
  const release = await buildRelease(source.options);
  const manifestPath = path.join(
    source.directory,
    'releases',
    `${source.options.version}.json`,
  );
  return { ...source, release, manifestPath };
}
