import { afterEach, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const sourcePath = 'services/platform/lib/engine/core/protocol.ts';
const owned: string[] = [];
afterEach(() => {
  for (const directory of owned.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
type Step = { name?: string; run?: string; with?: Record<string, string> };

test.skipIf(process.platform === 'win32')(
  'official image producers extract the canonical capability and reject unsupported or duplicate declarations',
  () => {
    for (const name of ['build.yml', 'release.yml']) {
      const workflow = parse(
        readFileSync(join(root, '.github/workflows', name), 'utf8'),
      ) as { jobs: { build: { steps: Step[] } } };
      const metadata = workflow.jobs.build.steps.find(
        (step) => step.name === 'Resolve build metadata',
      );
      const build = workflow.jobs.build.steps.find(
        (step) => step.name === 'Build and push',
      );
      if (!metadata?.run || !build?.with)
        throw new Error('Missing maintained image producer');
      expect(build.with['build-args']).toContain(
        'AUTOMATION_WRITER_PROTOCOL={0}',
      );
      expect(build.with.labels).toContain(
        'io.tale.automation-writer-protocol={0}',
      );
      expect(build.with.labels).toContain(
        'steps.meta.outputs.automation-protocol',
      );
      const directory = mkdtempSync(join(tmpdir(), 'tale-protocol-producer-'));
      owned.push(directory);
      mkdirSync(join(directory, sourcePath, '..'), { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: directory, timeout: 5000 });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          'commit',
          '--allow-empty',
          '-qm',
          'fixture',
        ],
        { cwd: directory, timeout: 5000 },
      );
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: directory,
        timeout: 5000,
        encoding: 'utf8',
      }).trim();
      for (const [declaration, allowed] of [
        ['export const ENGINE_PROTOCOL = 2;\n', true],
        ['export const ENGINE_PROTOCOL = 1;\n', true],
        ['export const ENGINE_PROTOCOL = 3;\n', false],
        [
          'export const ENGINE_PROTOCOL = 2;\nexport const ENGINE_PROTOCOL = 2;\n',
          false,
        ],
        ['export const ENGINE_PROTOCOL = Number(process.env.VALUE);\n', false],
      ] as const) {
        const output = join(directory, 'output');
        writeFileSync(output, '');
        writeFileSync(join(directory, sourcePath), declaration);
        const result = spawnSync('bash', ['-c', metadata.run], {
          cwd: directory,
          timeout: 5000,
          maxBuffer: 65536,
          env: {
            PATH: process.env.PATH,
            GITHUB_OUTPUT: output,
            SOURCE_SHA: sha,
            GITHUB_SHA: sha,
          },
        });
        expect(result.status === 0).toBe(allowed);
        const lines = readFileSync(output, 'utf8')
          .split('\n')
          .filter((line) => line.startsWith('automation-protocol='));
        expect(lines).toEqual(
          allowed
            ? [`automation-protocol=${declaration.includes('= 2') ? '2' : '1'}`]
            : [],
        );
      }
    }
  },
);

test('local production and squash images retain a source-checked capability', () => {
  const protocol = /^export const ENGINE_PROTOCOL = ([12]);$/m.exec(
    readFileSync(join(root, sourcePath), 'utf8'),
  )?.[1];
  if (!protocol) throw new Error('Unknown engine protocol');
  const dockerfile = readFileSync(
    join(root, 'services/platform/Dockerfile'),
    'utf8',
  );
  expect(dockerfile).toContain(`ARG AUTOMATION_WRITER_PROTOCOL=${protocol}`);
  expect(dockerfile).toContain(
    'RUN test "$(bun -e \'import { ENGINE_PROTOCOL } from "./lib/engine/core/protocol.ts"; console.log(ENGINE_PROTOCOL)\')" = "$AUTOMATION_WRITER_PROTOCOL"',
  );
  expect(
    dockerfile
      .split('FROM builder AS dev')[1]
      ?.split('FROM bun-base AS pruner')[0],
  ).toContain(
    'import { ENGINE_PROTOCOL } from "./services/platform/lib/engine/core/protocol.ts"',
  );
  for (const stage of ['runner', 'scratch', 'dev']) {
    const section =
      stage === 'scratch'
        ? dockerfile.split('FROM scratch')[1]
        : stage === 'dev'
          ? dockerfile
              .split('FROM builder AS dev')[1]
              ?.split('FROM bun-base AS pruner')[0]
          : dockerfile.split(' AS runner')[1]?.split('FROM scratch')[0];
    expect(section).toContain(
      'io.tale.automation-writer-protocol="${AUTOMATION_WRITER_PROTOCOL}"',
    );
  }
});
