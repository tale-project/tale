import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

import { parse } from 'yaml';
import { z } from 'zod';

import {
  composeReleaseNotes,
  releaseNotesPath,
  validateReleaseNotes,
} from './release-notes';

const authored =
  '## Highlights\n\nProject reviewers can inspect attached results.\n\n## Upgrade notes\n\nRestart the service after updating.\n';
const root = resolve(import.meta.dir, '../../..');
const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const scalar = z.union([z.string(), z.number(), z.boolean()]);

async function readWorkflow(path: string) {
  return z
    .object({
      jobs: z.record(
        z.string(),
        z.object({
          needs: z.union([z.string(), z.array(z.string())]).optional(),
          steps: z.array(
            z.object({
              name: z.string().optional(),
              uses: z.string().optional(),
              with: z.record(z.string(), scalar).optional(),
              env: z.record(z.string(), scalar).optional(),
              run: z.string().optional(),
              shell: z.string().optional(),
              'working-directory': z.string().optional(),
              if: z.string().optional(),
              'continue-on-error': z.unknown().optional(),
            }),
          ),
        }),
      ),
    })
    .parse(parse(await readFile(join(root, path), 'utf8')));
}

const releaseWorkflow = () => readWorkflow('.github/workflows/release.yml');

/** A checkout holding only the validator; notes are written per case. */
async function validatorCheckout() {
  const directory = await mkdtemp(join(tmpdir(), 'tale-release-notes-'));
  temporary.push(directory);
  const script = 'tools/cli/scripts/release-notes.ts';
  await mkdir(join(directory, dirname(script)), { recursive: true });
  await copyFile(join(root, script), join(directory, script));
  return {
    directory,
    async notes(version: string, text: string) {
      await mkdir(join(directory, '.github/release-notes'), {
        recursive: true,
      });
      await writeFile(
        join(directory, `.github/release-notes/${version}.md`),
        text,
      );
    },
  };
}

/** One workflow `run:` under bash, as the runner would; returns its outputs. */
async function runStep(
  command: string,
  cwd: string,
  env: Record<string, string>,
) {
  const outputs = join(
    await mkdtemp(join(tmpdir(), 'tale-step-output-')),
    'output',
  );
  temporary.push(dirname(outputs));
  await writeFile(outputs, '');
  const result = Bun.spawnSync(['bash', '-c', command], {
    cwd,
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
      GITHUB_OUTPUT: outputs,
      ...env,
    },
  });
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    outputs: Object.fromEntries(
      (await readFile(outputs, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => [line.split('=')[0], line.slice(line.indexOf('=') + 1)]),
    ),
  };
}

describe('authored release notes', () => {
  test('binds notes to one exact version and refuses path traversal', () => {
    expect(releaseNotesPath('v1.2.3')).toBe('.github/release-notes/v1.2.3.md');
    expect(releaseNotesPath('v1.2.3-rc.1')).toBe(
      '.github/release-notes/v1.2.3-rc.1.md',
    );
    for (const bad of ['', 'latest', '../../notes', 'v1.2.3/../notes']) {
      expect(() => releaseNotesPath(bad)).toThrow();
    }
  });

  test('preserves authored outcomes ahead of the generated appendix', () => {
    expect(
      composeReleaseNotes(
        authored,
        '## API contract changes\n\nNo contract change.',
      ),
    ).toBe(
      `${authored.trim()}\n\n## API contract changes\n\nNo contract change.\n`,
    );
    expect(validateReleaseNotes(authored.replaceAll('\n', '\r\n'))).toBe(
      authored,
    );
    expect(() => composeReleaseNotes(authored, '')).toThrow('empty');
  });

  test('rejects absent, duplicate, empty and unfinished sections', () => {
    for (const invalid of [
      '## API contract changes\n\nGenerated only.',
      authored.replace(
        'Project reviewers can inspect attached results.',
        '<!-- write highlights -->',
      ),
      authored.replace('Restart the service after updating.', 'TBD'),
      `${authored}\n## Highlights\n\nDuplicate.`,
      '## Upgrade notes\n\nRestart.\n\n## Highlights\n\nReview results.',
    ])
      expect(() => validateReleaseNotes(invalid)).toThrow();
  });

  test('validates before image builds, exempts sites-only and publishes composed notes', async () => {
    const workflow = await releaseWorkflow();
    const prepare = workflow.jobs.prepare;
    const validate = prepare.steps.find(
      (step) => step.name === 'Validate authored release notes before building',
    );
    expect(validate?.if).toBe("steps.version.outputs.sites_only != 'true'");
    expect(validate?.run).toContain('release-notes.ts --version "$TAG"');
    expect(workflow.jobs.build?.needs).toBe('prepare');
    const publish = workflow.jobs['create-release'].steps;
    expect(
      publish.find(
        (step) => step.name === 'Lead with authored release outcomes',
      )?.run,
    ).toContain('--out /tmp/release-notes.md');
    expect(
      publish.find((step) => step.name === 'Create release')?.run,
    ).toContain('--notes-file /tmp/release-notes.md');
  });

  test.skipIf(process.platform === 'win32')(
    'Prepare validates from a sparse checkout of the notes and their validator',
    async () => {
      const steps = (await releaseWorkflow()).jobs.prepare.steps;
      const checkout = steps.find(
        (step) => step.name === 'Checkout release notes',
      );
      expect(checkout?.uses).toStartWith('actions/checkout@');
      // Exact paths, not cones: nothing else of the tree is fetched.
      expect(checkout?.with?.['sparse-checkout-cone-mode']).toBe(false);
      expect(checkout?.with?.['persist-credentials']).toBe(false);
      expect(checkout?.with?.['fetch-depth']).toBeUndefined();
      expect(
        String(checkout?.with?.['sparse-checkout']).trim().split('\n'),
      ).toEqual([
        '.github/release-notes',
        'tools/cli/scripts/release-notes.ts',
      ]);
      // Node built-ins only, so those two paths are all the validator reads.
      const source = await readFile(
        join(root, 'tools/cli/scripts/release-notes.ts'),
        'utf8',
      );
      const imports = new Bun.Transpiler({ loader: 'ts' })
        .scanImports(source)
        .map((entry) => entry.path);
      expect(imports.length).toBeGreaterThan(0);
      for (const specifier of imports) expect(specifier).toStartWith('node:');

      const validateStep = steps.find(
        (step) =>
          step.name === 'Validate authored release notes before building',
      )!;
      expect(validateStep.shell).toBe('bash');
      expect(validateStep['working-directory']).toBe('.');
      const validate = validateStep.run!;
      const tree = await validatorCheckout();
      expect(
        (await runStep(validate, tree.directory, { TAG: 'v1.2.3' })).exitCode,
      ).not.toBe(0);
      await tree.notes('v1.2.3', authored);
      // Exercise Git's actual non-cone matcher, including root anchoring.
      // Only this disposable synthetic repository is initialized or committed.
      const excluded = [
        'README.md',
        'tools/cli/scripts/sibling.ts',
        'nested/.github/release-notes/v1.2.3.md',
        'nested/tools/cli/scripts/release-notes.ts',
      ];
      for (const path of excluded) {
        await mkdir(join(tree.directory, dirname(path)), { recursive: true });
        await writeFile(join(tree.directory, path), 'not needed by Prepare\n');
      }
      const git = (args: string[], input?: string) =>
        execFileSync(
          'git',
          [
            '-c',
            'core.hooksPath=/dev/null',
            '-c',
            'commit.gpgsign=false',
            ...args,
          ],
          { cwd: tree.directory, encoding: 'utf8', timeout: 10_000, input },
        );
      git(['init', '--quiet']);
      git(['add', '.']);
      git([
        '-c',
        'user.name=Release fixture',
        '-c',
        'user.email=release-fixture@example.invalid',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ]);
      git(
        ['sparse-checkout', 'set', '--no-cone', '--stdin'],
        String(checkout?.with?.['sparse-checkout']),
      );
      for (const path of excluded)
        expect(await Bun.file(join(tree.directory, path)).exists(), path).toBe(
          false,
        );
      expect(
        git(['ls-files', '-t'])
          .split('\n')
          .filter((line) => line.startsWith('H ')),
      ).toEqual([
        'H .github/release-notes/v1.2.3.md',
        'H tools/cli/scripts/release-notes.ts',
      ]);
      const valid = await runStep(validate, tree.directory, { TAG: 'v1.2.3' });
      expect(valid.exitCode, valid.stderr).toBe(0);
    },
  );

  test.skipIf(process.platform === 'win32')(
    'Publish packages pins no package tag for a version Release would refuse',
    async () => {
      const steps = (
        await readWorkflow('.github/workflows/publish-packages.yml')
      ).jobs.publish.steps;
      const at = (name: string) =>
        steps.findIndex((step) => step.name === name);
      const resolveTag = steps[at('Resolve snapshot tag')]!;
      const validate =
        steps[at('Validate authored release notes before pinning')];
      const publish = steps[at('Publish snapshot')]!;
      // The check stops the job before the only step that pushes.
      expect(
        at('Validate authored release notes before pinning'),
      ).toBeGreaterThan(at('Resolve snapshot tag'));
      expect(at('Validate authored release notes before pinning')).toBeLessThan(
        at('Publish snapshot'),
      );
      expect(validate?.['continue-on-error']).toBeUndefined();
      expect(publish.if).toBeUndefined();
      // The same validator and version spelling as Release's Prepare.
      const prepare = (await releaseWorkflow()).jobs.prepare.steps.find(
        (step) =>
          step.name === 'Validate authored release notes before building',
      );
      expect(validate?.run).toBe(prepare?.run);
      expect(validate?.shell).toBe('bash');
      expect(validate?.['working-directory']).toBe('.');
      expect(validate?.if).toBe("steps.tag.outputs.version != ''");
      expect(validate?.env?.TAG).toBe('${{ steps.tag.outputs.version }}');

      const tree = await validatorCheckout();
      const resolved = async (env: Record<string, string>) => {
        const result = await runStep(resolveTag.run!, tree.directory, {
          PACKAGE: 'ui',
          REF_NAME: 'main',
          INPUT_VERSION: '',
          ...env,
        });
        expect(result.exitCode, result.stderr).toBe(0);
        return result.outputs;
      };
      // A plain push to main pins nothing, so the check is skipped.
      expect(await resolved({ REF_TYPE: 'branch' })).toEqual({
        value: '',
        version: '',
      });
      expect(
        await resolved({ REF_TYPE: 'branch', INPUT_VERSION: '1.2.3' }),
      ).toEqual({ value: 'ui-v1.2.3', version: 'v1.2.3' });
      const tag = await resolved({ REF_TYPE: 'tag', REF_NAME: 'v1.2.3' });
      expect(tag).toEqual({ value: 'ui-v1.2.3', version: 'v1.2.3' });

      const pin = () =>
        runStep(validate!.run!, tree.directory, { TAG: tag.version! });
      expect((await pin()).exitCode).not.toBe(0);
      await tree.notes(
        'v1.2.3',
        authored.replace('Restart the service after updating.', 'TODO'),
      );
      expect((await pin()).exitCode).not.toBe(0);
      await tree.notes('v1.2.3', authored);
      const valid = await pin();
      expect(valid.exitCode, valid.stderr).toBe(0);
    },
  );

  test.skipIf(process.platform === 'win32')(
    'publication retries preserve published releases and surface drafts or API failures',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'tale-release-notes-'));
      temporary.push(directory);
      const gh = join(directory, 'gh');
      await writeFile(
        gh,
        `#!/bin/sh
if [ "$1 $2" = 'release view' ]; then
  case "$RELEASE_TEST_MODE" in
    published) echo true; exit 0;;
    draft) echo false; exit 0;;
    *) exit 1;;
  esac
fi
if [ "$1 $2" = 'release create' ]; then
  echo called > "$RELEASE_TEST_MARKER"
  if [ "$RELEASE_TEST_MODE" = failure ]; then exit 1; fi
  exit 0
fi
exit 99
`,
      );
      await chmod(gh, 0o755);
      const workflow = await releaseWorkflow();
      const command = workflow.jobs['create-release'].steps.find(
        (step) => step.name === 'Create release',
      )!.run!;
      for (const mode of ['published', 'draft', 'failure', 'missing']) {
        const marker = join(directory, mode);
        const result = Bun.spawnSync(['bash', '-c', command], {
          env: {
            ...process.env,
            PATH: `${directory}${delimiter}${process.env.PATH}`,
            TAG: 'v1.2.3',
            RELEASE_TEST_MODE: mode,
            RELEASE_TEST_MARKER: marker,
          },
        });
        expect(result.exitCode, mode).toBe(
          mode === 'draft' || mode === 'failure' ? 1 : 0,
        );
        expect(await Bun.file(marker).exists(), mode).toBe(
          mode === 'failure' || mode === 'missing',
        );
      }
    },
  );
});
