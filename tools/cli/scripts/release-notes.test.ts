import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
async function validatorCheckout(parent?: string) {
  const directory = parent
    ? join(parent, 'release-source')
    : await mkdtemp(join(tmpdir(), 'tale-release-notes-'));
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
  test('an explicit source root cannot silently fall back to the tooling checkout', async () => {
    const tree = await validatorCheckout();
    await tree.notes('v1.2.3', authored);
    const result = Bun.spawnSync(
      [
        process.execPath,
        join(tree.directory, 'tools/cli/scripts/release-notes.ts'),
        '--version',
        'v1.2.3',
        '--source-root',
        '',
      ],
      { cwd: tree.directory },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      '--source-root takes a checkout directory',
    );
  });

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
    expect(
      publish.find((step) => step.name === 'Create release')?.run,
    ).toContain('--target "$SOURCE_SHA"');
    expect(
      publish.find((step) => step.name === 'Create release')?.run,
    ).toContain(
      'TAG_SHA="$(gh api "repos/${REPOSITORY}/commits/refs%2Ftags/${TAG}" --jq .sha)"',
    );
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
      const checkout = steps[at('Checkout release source')]!;
      const validate =
        steps[at('Validate authored release notes before pinning')];
      const publish = steps[at('Publish snapshot')]!;
      // The check reads the released commit and stops the job before the
      // only step that pushes.
      expect(at('Checkout release source')).toBeGreaterThan(
        at('Resolve snapshot tag'),
      );
      expect(
        at('Validate authored release notes before pinning'),
      ).toBeGreaterThan(at('Checkout release source'));
      expect(at('Validate authored release notes before pinning')).toBeLessThan(
        at('Publish snapshot'),
      );
      expect(validate?.['continue-on-error']).toBeUndefined();
      expect(publish.if).toBeUndefined();
      expect(checkout.uses).toStartWith('actions/checkout@');
      expect(checkout.if).toBe("steps.tag.outputs.version != ''");
      expect(checkout.with?.ref).toBe('${{ steps.tag.outputs.source }}');
      expect(checkout.with?.['persist-credentials']).toBe(false);
      // Main's maintained validator reads the released notes as data. Neither
      // the validator nor Bun's configuration comes from the source checkout.
      const prepare = (await releaseWorkflow()).jobs.prepare.steps.find(
        (step) =>
          step.name === 'Validate authored release notes before building',
      );
      expect(validate?.run).toContain(prepare!.run!);
      expect(validate?.run).toContain('--source-root "$SOURCE_ROOT"');
      expect(validate?.shell).toBe('bash');
      expect(checkout.with?.path).toBe('release-source');
      expect(validate?.['working-directory']).toBe('.');
      expect(validate?.if).toBe("steps.tag.outputs.version != ''");
      expect(validate?.env?.TAG).toBe('${{ steps.tag.outputs.version }}');
      expect(validate?.env?.SOURCE_ROOT).toBe(
        '${{ github.workspace }}/release-source',
      );

      const tree = await validatorCheckout();
      const released = await validatorCheckout(tree.directory);
      const source = '0123456789abcdef0123456789abcdef01234567';
      const resolveWith = (env: Record<string, string>) =>
        runStep(resolveTag.run!, tree.directory, {
          PACKAGE: 'ui',
          REF: 'refs/heads/main',
          RELEASE_TAG: '',
          SOURCE_SHA: '',
          ...env,
        });
      // A plain push to main pins nothing, so the check is skipped.
      const push = await resolveWith({});
      expect(push.exitCode, push.stderr).toBe(0);
      expect(push.outputs).toEqual({ value: '', version: '', source: '' });
      const tag = await resolveWith({
        RELEASE_TAG: 'v1.2.3',
        SOURCE_SHA: source,
      });
      expect(tag.exitCode, tag.stderr).toBe(0);
      expect(tag.outputs).toEqual({
        value: 'ui-v1.2.3',
        version: 'v1.2.3',
        source,
      });
      // A version needs its exact tag and the commit it names, on main.
      const refusals: Record<string, string>[] = [
        { RELEASE_TAG: 'v1.2.3' },
        { SOURCE_SHA: source },
        { RELEASE_TAG: '1.2.3', SOURCE_SHA: source },
        { RELEASE_TAG: 'v1.2.3', SOURCE_SHA: source.slice(0, 12) },
        { REF: 'refs/tags/v1.2.3', RELEASE_TAG: 'v1.2.3', SOURCE_SHA: source },
        { REF: 'refs/heads/feature' },
      ];
      for (const env of refusals) {
        const refused = await resolveWith(env);
        expect(refused.exitCode, JSON.stringify(env)).not.toBe(0);
        expect(refused.outputs).toEqual({});
      }

      const pin = () =>
        runStep(validate!.run!, tree.directory, {
          TAG: tag.outputs.version!,
          SOURCE_ROOT: released.directory,
        });
      expect((await pin()).exitCode).not.toBe(0);
      await released.notes(
        'v1.2.3',
        authored.replace('Restart the service after updating.', 'TODO'),
      );
      expect((await pin()).exitCode).not.toBe(0);
      await released.notes('v1.2.3', authored);
      const valid = await pin();
      expect(valid.exitCode, valid.stderr).toBe(0);
    },
  );

  test.skipIf(process.platform === 'win32')(
    'Publish packages validates released notes without executing historical tooling',
    async () => {
      const steps = (
        await readWorkflow('.github/workflows/publish-packages.yml')
      ).jobs.publish.steps;
      const validate = steps.find(
        (step) =>
          step.name === 'Validate authored release notes before pinning',
      )!;
      const trusted = await validatorCheckout();
      const released = await validatorCheckout(trusted.directory);
      await trusted.notes(
        'v1.2.3',
        authored.replace('Restart', 'TODO Restart'),
      );
      await released.notes('v1.2.3', authored);
      const marker = join(trusted.directory, 'historical-tooling-ran');
      const poison =
        'import { writeFileSync } from "node:fs"; writeFileSync(process.env.SOURCE_EXECUTION_MARKER!, "ran");\n';
      await writeFile(
        join(released.directory, 'tools/cli/scripts/release-notes.ts'),
        poison,
      );
      await writeFile(join(released.directory, 'preload.ts'), poison);
      await writeFile(
        join(released.directory, 'bunfig.toml'),
        'preload = ["./preload.ts"]\n',
      );
      const pin = () =>
        runStep(
          validate.run!,
          join(trusted.directory, validate['working-directory'] ?? '.'),
          {
            TAG: 'v1.2.3',
            SOURCE_ROOT: released.directory,
            SOURCE_EXECUTION_MARKER: marker,
          },
        );
      const valid = await pin();
      expect(valid.exitCode, valid.stderr).toBe(0);
      expect(existsSync(marker)).toBe(false);
      // Main's invalid notes cannot substitute for the valid release notes,
      // and invalid release notes still fail despite the source's fake script.
      await released.notes(
        'v1.2.3',
        authored.replace('Restart', 'TODO Restart'),
      );
      expect((await pin()).exitCode).not.toBe(0);
      expect(existsSync(marker)).toBe(false);
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
if [ "$1" = 'api' ]; then
  echo "$SOURCE_SHA"
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
            REPOSITORY: 'tale-project/tale',
            SOURCE_SHA: '0123456789012345678901234567890123456789',
            MOVE_LATEST: 'false',
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
