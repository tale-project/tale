import { afterEach, describe, expect, test } from 'bun:test';
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

      const validate = steps.find(
        (step) =>
          step.name === 'Validate authored release notes before building',
      )!.run!;
      const tree = await validatorCheckout();
      expect(
        (await runStep(validate, tree.directory, { TAG: 'v1.2.3' })).exitCode,
      ).not.toBe(0);
      await tree.notes('v1.2.3', authored);
      const valid = await runStep(validate, tree.directory, { TAG: 'v1.2.3' });
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
