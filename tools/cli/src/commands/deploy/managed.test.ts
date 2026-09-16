import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoPath } from '../../lib/config/releases/identity';
import { ConfigError } from '../../lib/config/releases/model';
import { fixture as clientFixture } from '../../lib/config/releases/tests/fixture';
import { prepareDeployment } from '../../lib/deployment/prepare';
import { CliError, ExitCode } from '../../utils/fail';
import { managedResult } from './managed';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const describePosix = describe.skipIf(process.platform === 'win32');

async function preparation() {
  const client = clientFixture();
  const root = await mkdtemp(join(tmpdir(), 'tale-prepare-refusal-'));
  roots.push(root);
  const binary = join(root, 'tale');
  const elf = Buffer.alloc(128);
  elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  elf.writeUInt16LE(62, 18);
  await writeFile(binary, elf);
  await writeFile(`${binary}.mjs`, '#!/usr/bin/env bun\nprocess.exit(0);\n');
  const spec = join(root, 'spec.json');
  await writeFile(
    spec,
    JSON.stringify({
      schemaVersion: 1,
      name: 'fresh-team',
      composeProject: 'fresh',
      stateDirectory: join(root, 'state'),
      origin: 'https://native.example.invalid',
      tlsMode: 'external',
      runtime: { revision: 'a'.repeat(40) },
      identity: {
        bootstrap: 'fresh',
        email: { env: 'TALE_EMAIL' },
        password: { env: 'TALE_PASSWORD' },
        slug: 'fresh-team',
        name: 'Fresh team',
        ssoEnabled: false,
      },
      configs: [
        {
          repository: client.descriptor.sourceRepository,
          revision: client.options.sourceCommit,
          client: client.descriptor.clientId,
          descriptor: repoPath(client.root, client.descriptorPath),
          automation: client.name,
          project: { key: 'CONF', name: 'Configuration' },
          skillOwner: 'operator',
        },
      ],
    }),
  );
  return { root, binary, spec, output: join(root, 'prepared') };
}

async function failure(work: () => Promise<unknown>): Promise<CliError> {
  try {
    await managedResult('deploy prepare', work);
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error('the deployment command succeeded');
}

// A pack its CLI could not read once failed a deploy only after every runtime
// image had been pulled (38 minutes), and then behind a fixed line with no
// cause. Preparation now refuses it first, in the refusal's own words.
describePosix('managed deployment failures', () => {
  test('an unreadable configuration is refused before the runtime, with its cause', async () => {
    const { root, binary, spec, output } = await preparation();
    const refusal =
      'native manifest normalization changes release semantics at subjects.task.review.approve; this Tale CLI does not read those fields as written, so use a Tale CLI at least as new as the Tale the pack targets';
    let runtimePrepared = false;

    const error = await failure(() =>
      prepareDeployment(
        { spec, output },
        {
          build: () => ({ binary, revision: 'b'.repeat(40) }),
          sources: async (_requests, _options, work) => work(() => root),
          runtime: async () => {
            runtimePrepared = true;
            throw new Error('the runtime must not be prepared');
          },
          config: async () => {
            throw new ConfigError(refusal);
          },
        },
      ),
    );

    expect(error.info).toMatchObject({
      summary: refusal,
      code: ExitCode.Precondition,
    });
    expect(runtimePrepared).toBe(false);
  });

  test('an unexpected failure keeps the fixed line, never its message', async () => {
    const error = await failure(async () => {
      throw new Error('pull failed for https://robot:ghp_secret@ghcr.example');
    });

    expect(error.info.summary).toBe(
      'Deployment failed. Review the source pins, paths, permissions and retained recovery receipts.',
    );
    expect(JSON.stringify(error.info)).not.toContain('ghp_secret');
  });
});
