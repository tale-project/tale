import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { stringify } from 'yaml';

import { validateNativeRelease } from '../native';
import { buildRelease } from '../release';
import { fixture, temporary } from './fixture';

/** A native-valid, independent client. Component tests also keep deliberately
 * minimal documents to isolate compiler/transport behavior from the engine. */
export function commandFixture(client = 'acme', owned = true) {
  const f = fixture(client, owned ? ['invoice'] : []);
  const document = {
    version: 1,
    name: f.name,
    nodes: [
      owned
        ? {
            id: 'work',
            type: 'sandbox.run_script',
            input: { skill: 'invoice', entry: 'scripts/run.py' },
          }
        : { id: 'work', type: 'transform', code: 'return { received: true };' },
    ],
    output: '{{ nodes.work.output }}',
  };
  const metadata = {
    name: f.descriptor.automations[0].displayName,
    scope: 'project',
    skills: owned ? ['invoice'] : [],
  };
  writeFileSync(path.join(f.pack, 'workflow.yml'), stringify(document));
  writeFileSync(path.join(f.pack, 'automation.yml'), stringify(metadata));
  const commit = () => {
    f.git('add', '--all');
    f.git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'native client fixture',
    );
    return f.git('rev-parse', 'HEAD');
  };
  const sourceCommit = commit();
  return {
    ...f,
    document,
    metadata,
    commit,
    options: {
      ...f.options,
      sourceCommit,
      validateNative: validateNativeRelease,
      skillOwnerUserId: owned ? f.options.skillOwnerUserId : undefined,
    },
  };
}

export async function commandRelease(client = 'acme', owned = true) {
  const f = commandFixture(client, owned);
  const release = await buildRelease(f.options);
  const catalogueCommit = f.commit();
  const manifestPath = path.join(
    f.directory,
    'releases',
    `${release.manifest.version}.json`,
  );
  const stageOptions = {
    repoRoot: f.root,
    descriptorPath: path.relative(f.root, f.descriptorPath),
    automationName: f.name,
    version: release.manifest.version,
    catalogueCommit,
    catalogueRepository: f.descriptor.sourceRepository,
    clientId: client,
    opsCommit: 'a'.repeat(40),
    output: path.join(temporary(), 'stage'),
  };
  return { ...f, release, catalogueCommit, manifestPath, stageOptions };
}
