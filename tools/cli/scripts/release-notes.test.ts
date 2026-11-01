import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

import { isMigrationFile as migratorReads } from '@tale/shared/db/migration-files';
import { parse } from 'yaml';
import { z } from 'zod';

import {
  composeReleaseNotes,
  isMigrationFile,
  readReleaseChanges,
  type ReleaseChanges,
  releaseNotesPath,
  validateReleaseNotes,
  validateUpgradeNotes,
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
    const compose = publish.find(
      (step) => step.name === 'Lead with authored release outcomes',
    )?.run;
    expect(compose).toContain('--out /tmp/release-notes.md');
    // After the tag a refusal costs the version, so both check the shape
    // alone; the maintainers compared the contents before tagging.
    expect(validate?.run).toContain('--shape-only');
    expect(compose).toContain('--shape-only');
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
        // The moved-tag decision (release-source.test.ts), run before it.
        'tools/cli/scripts/release-source.ts',
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

/**
 * v0.5.89 against v0.5.88, as Git records them (#4970). Of what v0.5.88
 * already ships, its last migrations and the pull requests its notes cite.
 */
const v0589: ReleaseChanges = {
  candidate: '0cf2c45fda99080249f420b800f79c67a79fac9f',
  previous: {
    tag: 'v0.5.88',
    commit: '18edad5c22b56f0133b1c0bbc6e65d8e483c05a4',
  },
  migrations: ['0204_usage_ledger_provider.sql'],
  earlierMigrations: [
    '0200_automation_test_reports.sql',
    '0201_provider_subscription_account_id.sql',
    '0202_agent_run_engine.sql',
    '0203_agent_connections.sql',
    '0203_auth_factor_authorities.sql',
  ],
  shipped: [4912, 4913, 4915, 4918, 4920],
  contract: { previous: '3.43.0', current: '3.44.0' },
};
/**
 * v0.5.83 against v0.5.82, as Git records them (#4785). Of what v0.5.82
 * already ships, its last migrations and pull requests the v0.5.81 and
 * v0.5.82 notes cite.
 */
const v0583: ReleaseChanges = {
  candidate: '4e3c8e40fe05706a5e8796bb30b024b58c1038f9',
  previous: {
    tag: 'v0.5.82',
    commit: '0381bc439d9de85079bcdd4e001ad7e989f76bb9',
  },
  migrations: [
    '0170_automation_schedule_rules.sql',
    '0171_automation_trigger_skip_detail.sql',
    '0172_automation_trigger_static_input.sql',
    '0173_seeded_github_schedules_off.sql',
    '0190_automation_node_runs.sql',
    '0191_automation_run_replays.sql',
    '0192_automation_run_replay_lineage.sql',
    '0193_boot_repairs.sql',
    '0194_audit_async_sealing.sql',
    '0195_auth_invalidations.sql',
    '0196_automation_messages.sql',
    '0197_automation_approval_allowances.sql',
  ],
  earlierMigrations: [
    '0167_project_agent_workers.sql',
    '0168_project_wakes.sql',
    '0169_attested_review_batches.sql',
    '0180_mcp_client_activity.sql',
    '0181_automation_version_attribution.sql',
  ],
  shipped: [4603, 4608, 4616, 4632, 4648],
  contract: { previous: '3.27.0', current: '3.35.0' },
};
/** A release that adds no migration and keeps its API contract. */
const quiet: ReleaseChanges = {
  ...v0589,
  migrations: [],
  contract: { previous: '3.43.0', current: '3.43.0' },
};
/**
 * v0.5.82 against v0.5.81 at the commit its tag names since it moved (#4741).
 * Of what v0.5.81 already ships, its last migrations, the pull requests its
 * notes cite and #4648, its own tag commit.
 */
const v0582: ReleaseChanges = {
  candidate: '0381bc439d9de85079bcdd4e001ad7e989f76bb9',
  previous: {
    tag: 'v0.5.81',
    commit: 'd1373d84cd56972501403f62145ec52e6f65d44a',
  },
  migrations: [],
  earlierMigrations: [
    '0167_project_agent_workers.sql',
    '0168_project_wakes.sql',
    '0169_attested_review_batches.sql',
    '0180_mcp_client_activity.sql',
    '0181_automation_version_attribution.sql',
  ],
  shipped: [4635, 4638, 4639, 4641, 4648],
  contract: { previous: '3.27.0', current: '3.27.0' },
};
const upgrading = (text: string) =>
  `## Highlights\n\nUsage is booked per provider.\n\n## Upgrade notes\n\n${text}\n`;
const migrationMissing =
  'Upgrade notes do not name migration 0204_usage_ledger_provider.sql, added since v0.5.88';
const contractMissing =
  'Upgrade notes do not name API contract 3.44.0, changed from 3.43.0 since v0.5.88';
/** Upgrade notes that name what v0.5.89 brings. */
const upgradeV0589 =
  'The backend applies 0204_usage_ledger_provider.sql at boot; the API contract moves to 3.44.0.';
const attribute =
  'name the earlier release beside it, in the same paragraph or list item, or leave it out';
const alreadyHas = (written: string, tag = 'v0.5.88') =>
  `Release notes name migration ${written}, which ${tag} already has: ${attribute}`;
const alreadyShips = (n: number, tag = 'v0.5.88') =>
  `Release notes cite #${n}, which ${tag} already ships and no commit since refers to: ${attribute}`;

/** The refusal's message, or '' when the Upgrade notes are accepted. */
function refusal(raw: string, changes: ReleaseChanges) {
  try {
    validateUpgradeNotes(raw, changes);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}

/** The authored checks' refusal, or '' when the notes are accepted. */
function shapeRefusal(raw: string) {
  try {
    validateReleaseNotes(raw);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}

const opsCommit =
  'https://github.com/tale-project/ops/commit/1d932920e600d8ddce32054b8bc678522cc10e7e';
const opsRefused = (address: string, repository = 'ops') =>
  `Release notes link ${address}, but tale-project/${repository} is not a public repository: readers outside the organization cannot open it`;

describe('links in release notes', () => {
  test('refuses an address into a repository that is not public, in any form', () => {
    const highlighting = (text: string) =>
      authored.replace('Project reviewers can inspect attached results.', text);
    for (const linked of [
      `Pinned in [ops commit 1d932920](${opsCommit}).`,
      `Pinned in <${opsCommit}>.`,
      `Pinned in ${opsCommit}.`,
      `Pinned in [the ops commit][pin].\n\n[pin]: ${opsCommit}`,
      `Pinned in [ops commit 1d932920](${opsCommit.replace('//', '//www.')}).`,
      `<!-- ${opsCommit} -->\nDeploy the platform and CLI together.`,
    ]) {
      const refused = opsRefused(opsCommit.replace('https://', ''));
      expect(shapeRefusal(upgrading(linked)), linked).toBe(refused);
      expect(shapeRefusal(highlighting(linked)), linked).toBe(refused);
    }
    expect(
      shapeRefusal(
        upgrading('Pinned in https://GitHub.com/Tale-Project/OPS.git.'),
      ),
    ).toBe(opsRefused('GitHub.com/Tale-Project/OPS.git', 'OPS'));
    expect(
      shapeRefusal(
        upgrading(
          `Pinned in ${opsCommit}, ${opsCommit} and https://github.com/tale-project/tale-cli/pull/7.`,
        ),
      ),
    ).toBe(
      [
        opsRefused(opsCommit.replace('https://', '')),
        opsRefused('github.com/tale-project/tale-cli/pull/7', 'tale-cli'),
      ].join('\n'),
    );
  });

  test('accepts the public repositories and addresses outside them', () => {
    for (const linked of [
      '[#4664](https://github.com/tale-project/tale/pull/4664)',
      'Clone https://github.com/tale-project/tale.',
      'Clone https://GitHub.com/Tale-Project/Tale.git',
      '[Profile](https://github.com/tale-project/.github/blob/main/profile/README.md)',
      '[The organization](https://github.com/tale-project)',
      '[GHSA-r4xp-prcw-77qf](https://github.com/advisories/GHSA-r4xp-prcw-77qf)',
      'Pull `ghcr.io/tale-project/ops/minio:RELEASE.2025-04-22T22-12-26Z`.',
      'https://github.com/porsager/postgres/issues/1189',
      '[Upgrading](https://docs.tale.dev/self-hosted/operate/release-notes/format)',
    ])
      expect(shapeRefusal(upgrading(linked)), linked).toBe('');
  });

  test('accepts the corrected v0.5.82 notes and refuses them as first published', async () => {
    const corrected = await readFile(
      join(root, '.github/release-notes/v0.5.82.md'),
      'utf8',
    );
    expect(shapeRefusal(corrected)).toBe('');
    // The Upgrade notes v0.5.82 was first published with (#4669, #4676).
    const published = upgrading(
      `- Deploy the Tale platform and CLI together before adopting these fixes. The\n  managed-deployments repository now pins its shared Tale CLI source to\n  \`13a41556bd017e4fade3165d988974e7a3bea184\` in\n  [ops commit 1d932920](${opsCommit}).`,
    );
    expect(shapeRefusal(published)).toBe(
      opsRefused(opsCommit.replace('https://', '')),
    );
  });

  test('every committed release notes file passes', async () => {
    const directory = join(root, '.github/release-notes');
    const files = (await readdir(directory)).filter(
      (name) => name.startsWith('v') && name.endsWith('.md'),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const name of files)
      expect(
        shapeRefusal(await readFile(join(directory, name), 'utf8')),
        name,
      ).toBe('');
  });
});

describe('Upgrade notes against the release contents', () => {
  test('a release without a migration or a contract change needs neither named', () => {
    expect(refusal(authored, quiet)).toBe('');
  });

  test('accepts an added migration named by its file name', () => {
    for (const named of [
      'The backend applies `0204_usage_ledger_provider.sql` at boot.',
      'It applies services/platform/backend/db/migrations/0204_usage_ledger_provider.sql.',
      'The migration (0204_usage_ledger_provider.sql) adds a table.',
    ])
      expect(
        refusal(upgrading(`${named} The API contract moves to 3.44.0.`), v0589),
        named,
      ).toBe('');
  });

  test('refuses Upgrade notes that leave out an added migration, and names it', () => {
    for (const unnamed of [
      'One database migration applies at boot.',
      'It applies 0204_usage_ledger_provider at boot.',
      'It applies x0204_usage_ledger_provider.sql at boot.',
      'Keep 0204_usage_ledger_provider.sql.bak until it applied.',
      '<!-- 0204_usage_ledger_provider.sql --> One migration applies at boot.',
    ])
      expect(
        refusal(
          upgrading(`${unnamed} The API contract moves to 3.44.0.`),
          v0589,
        ),
        unnamed,
      ).toBe(migrationMissing);
    // The Highlights do not count: operators upgrade by the Upgrade notes.
    expect(
      refusal(
        '## Highlights\n\nThe new 0204_usage_ledger_provider.sql books usage per provider.\n\n## Upgrade notes\n\nThe API contract moves to 3.44.0.\n',
        v0589,
      ),
    ).toBe(migrationMissing);
  });

  test("refuses an earlier release's migration as this release's, by its file name or its number", () => {
    for (const [named, refused] of [
      [
        'The backend also applies 0203_agent_connections.sql.',
        alreadyHas('0203_agent_connections.sql'),
      ],
      [
        'Tale CLI applies migrations 0202 and 0204 during the rollout.',
        alreadyHas('0202 (0202_agent_run_engine.sql)'),
      ],
      [
        'It applies migrations `0201`–`0204`.',
        alreadyHas('0201 (0201_provider_subscription_account_id.sql)'),
      ],
      [
        'Migration 0203 links agents to their connections.',
        alreadyHas(
          '0203 (0203_agent_connections.sql, 0203_auth_factor_authorities.sql)',
        ),
      ],
    ])
      expect(
        refusal(upgrading(`${upgradeV0589}\n\n${named}`), v0589),
        named,
      ).toBe(refused);
    // In the Highlights too: they present the release's own work.
    expect(
      refusal(
        `## Highlights\n\nThe new 0203_agent_connections.sql links agents.\n\n## Upgrade notes\n\n${upgradeV0589}\n`,
        v0589,
      ),
    ).toBe(alreadyHas('0203_agent_connections.sql'));
  });

  test('refuses a migration that neither release adds', () => {
    expect(
      refusal(
        upgrading(
          `${upgradeV0589} Then 0205_next.sql and migration 0299 apply.`,
        ),
        v0589,
      ),
    ).toBe(
      [
        'Release notes name migration 0205_next.sql, which neither v0.5.88 nor this release adds',
        'Release notes name migration 0299, which neither v0.5.88 nor this release adds',
      ].join('\n'),
    );
  });

  test('refuses a pull request or issue the previous release already ships, in any form', () => {
    for (const cited of [
      '[#4912](https://github.com/tale-project/tale/pull/4912)',
      'See #4912.',
      'See tale-project/tale#4912.',
      'See https://github.com/tale-project/tale/issues/4912.',
      'See <https://github.com/tale-project/tale/pull/4912#discussion_r1>.',
    ]) {
      const highlights = `## Highlights\n\nUsage is booked per provider. ${cited}\n\n## Upgrade notes\n\n${upgradeV0589}\n`;
      expect(refusal(highlights, v0589), cited).toBe(alreadyShips(4912));
      expect(refusal(upgrading(`${upgradeV0589} ${cited}`), v0589), cited).toBe(
        alreadyShips(4912),
      );
    }
    expect(
      refusal(upgrading(`${upgradeV0589} See #4920, #4913 and #4920.`), v0589),
    ).toBe([alreadyShips(4920), alreadyShips(4913)].join('\n'));
  });

  test('a number that refers to no earlier work is no citation or migration', () => {
    for (const text of [
      'See [#4970](https://github.com/tale-project/tale/issues/4970).',
      'See [Triggers](https://docs.tale.dev/platform/automations/triggers#4912).',
      'Port 4912 and image `ghcr.io/tale-project/tale/tale-db:4912` are unchanged.',
      'The entity &#4912; renders as before.',
      'See https://github.com/other/project/pull/4912 and tale-project/tale-cli#4912.',
      'Keep 0203 rows in the batch; 2026 migrations ran.',
      '<!-- #4912 and 0203_agent_connections.sql, migration 0202 -->',
    ])
      expect(refusal(upgrading(`${upgradeV0589} ${text}`), v0589), text).toBe(
        '',
      );
  });

  test('a paragraph or list item that names the earlier release may name its work', () => {
    // As the v0.5.88 notes name v0.5.87's migrations to correct its notes.
    for (const attributed of [
      'Upgrading from v0.5.87 or earlier also applies 0203_agent_connections.sql and 0203_auth_factor_authorities.sql, which the v0.5.87 notes leave out.',
      'The v0.5.88 notes said sign-in stays off ([#4912](https://github.com/tale-project/tale/pull/4912)); it is on.',
      '- Known issues carried over from v0.5.88:\n  - Usage of [#4912](https://github.com/tale-project/tale/pull/4912) is booked late.\n  - Migration 0203 keeps its index.',
    ])
      expect(
        refusal(upgrading(`${upgradeV0589}\n\n${attributed}`), v0589),
        attributed,
      ).toBe('');
    // Another paragraph or list item names nothing, nor does a later release.
    for (const unattributed of [
      'Since v0.5.88:\n\n- [#4912](https://github.com/tale-project/tale/pull/4912) books usage.',
      '- Since v0.5.88, usage is booked.\n- [#4912](https://github.com/tale-project/tale/pull/4912) books it.',
      'As of v0.5.89, #4912 books usage.',
    ])
      expect(
        refusal(upgrading(`${upgradeV0589}\n\n${unattributed}`), v0589),
        unattributed,
      ).toBe(alreadyShips(4912));
  });

  test('an unchanged API contract needs no version named', () => {
    expect(
      refusal(
        upgrading(
          'The backend applies 0204_usage_ledger_provider.sql at boot.',
        ),
        { ...v0589, contract: { previous: '3.44.0', current: '3.44.0' } },
      ),
    ).toBe('');
  });

  test('a changed API contract must be named by the version it moves to', () => {
    const migration =
      'The backend applies 0204_usage_ledger_provider.sql at boot.';
    for (const named of [
      'The API contract moves from 3.43.0 to 3.44.0.',
      'The API contract is now `v3.44.0`.',
      'API contract: 3.44.0',
    ])
      expect(refusal(upgrading(`${migration} ${named}`), v0589), named).toBe(
        '',
      );
    for (const unnamed of [
      'The API contract changes.',
      'The API contract stays at 3.43.0.',
      'The API contract moves to 13.44.0.',
      'The API contract moves to 3.44.01.',
      'The API contract moves to 3.44.0.1.',
      'The API contract moves to 3.44.0-rc.1.',
    ])
      expect(
        refusal(upgrading(`${migration} ${unnamed}`), v0589),
        unnamed,
      ).toBe(contractMissing);
  });

  test('accepts the corrected v0.5.89 notes and refuses them as first published', async () => {
    const corrected = await readFile(
      join(root, '.github/release-notes/v0.5.89.md'),
      'utf8',
    );
    expect(refusal(corrected, v0589)).toBe('');
    // The Upgrade notes v0.5.89 was first published with (#4970).
    const published = upgrading(
      '- From v0.5.88 to v0.5.89 no database migration or manual configuration change is needed. The release is a deployment hotfix for the native CLI; rerun the normal Tale CLI deployment/adoption flow after the images and CLI are published.',
    );
    expect(refusal(published, v0589)).toBe(
      `${migrationMissing}\n${contractMissing}`,
    );
  });

  test('accepts the corrected v0.5.83 notes and refuses them as first published', async () => {
    const corrected = await readFile(
      join(root, '.github/release-notes/v0.5.83.md'),
      'utf8',
    );
    expect(refusal(corrected, v0583)).toBe('');
    // What v0.5.83 was first published with (#4785): v0.5.82's highlight and
    // migration, and none of its own.
    const published = [
      '## Highlights',
      '- Standing roles now wake when a project worker finishes, so a released slot can be refilled by the fleet manager without waiting for the next scheduled occurrence. Wake claims are scoped to the project and preserve the native task and review guards. [#4608](https://github.com/tale-project/tale/pull/4608)',
      '## Upgrade notes',
      '- Deploy the Tale platform and the managed-deployment CLI together. Tale CLI applies migrations 0168 and 0194 during the normal forward-only rollout; keep the existing backup, retained-release and configuration readback procedure until the new image is serving.',
    ].join('\n\n');
    expect(refusal(published, v0583)).toBe(
      [
        ...v0583.migrations.map(
          (file) =>
            `Upgrade notes do not name migration ${file}, added since v0.5.82`,
        ),
        'Upgrade notes do not name API contract 3.35.0, changed from 3.27.0 since v0.5.82',
        alreadyShips(4608, 'v0.5.82'),
        alreadyHas('0168 (0168_project_wakes.sql)', 'v0.5.82'),
      ].join('\n'),
    );
  });

  test('accepts the corrected v0.5.82 notes for what its moved tag ships', async () => {
    const corrected = await readFile(
      join(root, '.github/release-notes/v0.5.82.md'),
      'utf8',
    );
    expect(refusal(corrected, v0582)).toBe('');
    // The merges 0381bc439 adds over 81ef78dcd, the commit the notes were
    // first written for, that change what a reader observes; the other three
    // (#4674, e6fb96249 and #4680) change only release.yml and a test.
    for (const pull of [
      4242, 4372, 4373, 4376, 4382, 4383, 4388, 4389, 4394, 4398, 4400, 4406,
      4407, 4410, 4224, 4248, 4251, 4260, 4327, 4609, 4621, 4643,
    ])
      expect(corrected, `#${pull}`).toContain(
        `(https://github.com/tale-project/tale/pull/${pull})`,
      );
    // Which commit the tag, the images and the CLI binaries come from.
    expect(corrected.slice(corrected.indexOf('## Upgrade notes'))).toContain(
      v0582.candidate,
    );
  });

  test('checks the shape first', () => {
    expect(
      refusal('## Highlights\n\nUsage is booked per provider.\n', quiet),
    ).toBe('Release notes need exactly one "## Upgrade notes" section');
  });

  test('counts migration files as the boot migrator does', async () => {
    const files = await readdir(
      join(root, 'services/platform/backend/db/migrations'),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const name of [
      ...files,
      'next.sql',
      'next.ts',
      'next.test.ts',
      'next.d.ts',
      'next.sql.bak',
      'next.tsx',
      'README.md',
      '.gitkeep',
    ])
      expect(isMigrationFile(name), name).toBe(migratorReads(name));
  });
});

const contractPath = 'services/platform/lib/shared/constants/api-contract.ts';
const migrations = 'services/platform/backend/db/migrations';

/** A disposable repository; nothing outside it is initialized or committed. */
async function history() {
  const directory = await mkdtemp(join(tmpdir(), 'tale-release-history-'));
  temporary.push(directory);
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'tag.gpgsign=false',
        '-c',
        'init.defaultBranch=main',
        '-c',
        'user.name=Release fixture',
        '-c',
        'user.email=release-fixture@example.invalid',
        ...args,
      ],
      { cwd: directory, encoding: 'utf8', timeout: 10_000 },
    ).trim();
  const write = async (path: string, text: string) => {
    await mkdir(join(directory, dirname(path)), { recursive: true });
    await writeFile(join(directory, path), text);
  };
  const commit = (message: string) => {
    git('add', '--all');
    git('commit', '--quiet', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '--quiet');
  return { directory, git, write, commit };
}

/**
 * Tag v1.0.0, then a commit with a sites tag, then the candidate. Since
 * v1.0.0 the candidate renames one migration and adds two, with a test, a
 * note and a nested file beside them, and moves the API contract from the
 * version in this repository's own api-contract.ts to 9.0.0. v1.0.0 merges
 * pull request #11, closes #12 and #13 and refers to #15; a commit since
 * refers to #13 again.
 */
async function release() {
  const repo = await history();
  const contract = await readFile(join(root, contractPath), 'utf8');
  await repo.write(contractPath, contract);
  await repo.write(`${migrations}/0001_init.sql`, 'SELECT 1;\n');
  const previous = repo.commit(
    'feat: first release (#11)\n\nCloses #12\nFixes tale-project/tale#13\nRefs #15',
  );
  repo.git('tag', 'v1.0.0');
  await repo.write(`${migrations}/0002_more.sql`, 'SELECT 2;\n');
  await repo.write(`${migrations}/0003_data.ts`, 'export default {};\n');
  await repo.write(`${migrations}/0003_data.test.ts`, '\n');
  await repo.write(`${migrations}/README.md`, 'Migrations.\n');
  await repo.write(`${migrations}/nested/0004_nested.sql`, 'SELECT 4;\n');
  repo.commit('fix: more migrations (#14)\n\nRefs #13');
  repo.git('tag', 'sites-discovery-1');
  repo.git(
    'mv',
    `${migrations}/0001_init.sql`,
    `${migrations}/0001_initial.sql`,
  );
  await repo.write(
    contractPath,
    "export const API_CONTRACT_VERSION = '9.0.0';\n",
  );
  const candidate = repo.commit('candidate');
  return { ...repo, contract, previous, candidate };
}

describe.skipIf(process.platform === 'win32')(
  'release contents read from Git',
  () => {
    test('compares the candidate with the release tag before it', async () => {
      const repo = await release();
      const changes = readReleaseChanges({ root: repo.directory });
      expect(changes).toEqual({
        candidate: repo.candidate,
        previous: { tag: 'v1.0.0', commit: repo.previous },
        // The migrator applies a renamed file again, and reads no test, note
        // or subdirectory.
        migrations: ['0001_initial.sql', '0002_more.sql', '0003_data.ts'],
        earlierMigrations: ['0001_init.sql'],
        // Merged and closed; #13 has new work since and #15 stays open.
        shipped: [11, 12],
        contract: { previous: changes.contract.previous, current: '9.0.0' },
      });
      // The version is read from the repository's own api-contract.ts.
      expect(changes.contract.previous).toMatch(/^\d+\.\d+\.\d+$/);
      expect(repo.contract).toContain(
        `export const API_CONTRACT_VERSION = '${changes.contract.previous}';`,
      );
      // Tagging the candidate, as releasing does, changes nothing.
      repo.git('tag', 'v1.1.0');
      expect(readReleaseChanges({ root: repo.directory })).toEqual(changes);
      expect(
        readReleaseChanges({
          root: repo.directory,
          candidate: 'v1.1.0',
          previousTag: 'v1.0.0',
        }),
      ).toEqual(changes);
    });

    test('refuses a previous tag that is no release before the candidate', async () => {
      const repo = await release();
      repo.git('tag', 'v1.1.0');
      await repo.write('later.md', 'Later.\n');
      repo.commit('later');
      repo.git('tag', 'v1.2.0');
      const compare = (previousTag: string) => () =>
        readReleaseChanges({
          root: repo.directory,
          candidate: repo.candidate,
          previousTag,
        });
      expect(compare('v1.1.0')).toThrow(
        `v1.1.0 is not a release before ${repo.candidate}`,
      );
      expect(compare('v1.2.0')).toThrow(
        `v1.2.0 is not a release before ${repo.candidate}`,
      );
      expect(compare('v9.9.9')).toThrow('v9.9.9 is not a tag in');
      expect(compare('sites-discovery-1')).toThrow(
        '--previous-tag takes a release tag such as v1.2.3',
      );
    });

    test('says what it lacks without tags or history', async () => {
      const repo = await history();
      await repo.write('README.md', 'First.\n');
      repo.commit('first');
      await repo.write('README.md', 'Second.\n');
      repo.commit('second');
      expect(() => readReleaseChanges({ root: repo.directory })).toThrow(
        'No release tag before',
      );
      const tree = await validatorCheckout();
      expect(() => readReleaseChanges({ root: tree.directory })).toThrow(
        "Cannot compare the release notes without the candidate's Git history",
      );
    });

    test('the --version run compares the notes, and --shape-only does not', async () => {
      const repo = await release();
      const script = 'tools/cli/scripts/release-notes.ts';
      await mkdir(join(repo.directory, dirname(script)), { recursive: true });
      await copyFile(join(root, script), join(repo.directory, script));
      const { previous: was } = readReleaseChanges({
        root: repo.directory,
      }).contract;
      const complete =
        '## Highlights\n\nSchedules run on time.\n\n## Upgrade notes\n\nThe backend applies 0001_initial.sql, 0002_more.sql and 0003_data.ts at boot; the API contract moves to 9.0.0.\n';
      const partial = complete.replace(' and 0003_data.ts', '');
      const run = async (
        notes: string,
        args: string[],
        tooling = repo.directory,
      ) => {
        await repo.write('.github/release-notes/v1.1.0.md', notes);
        const result = Bun.spawnSync(
          [
            process.execPath,
            join(tooling, script),
            '--version',
            'v1.1.0',
            ...args,
          ],
          { cwd: tooling },
        );
        return {
          exitCode: result.exitCode,
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
        };
      };
      const valid = await run(complete, []);
      expect(valid.exitCode, valid.stderr).toBe(0);
      expect(valid.stdout).toBe(
        `Validated .github/release-notes/v1.1.0.md\nUpgrade notes name what ${repo.candidate} brings since v1.0.0 (${repo.previous}): migrations 0001_initial.sql, 0002_more.sql, 0003_data.ts; API contract ${was} -> 9.0.0\n`,
      );
      const refused = await run(partial, []);
      expect(refused.exitCode).not.toBe(0);
      expect(refused.stdout).toBe('');
      expect(refused.stderr).toContain(
        'Upgrade notes do not name migration 0003_data.ts, added since v1.0.0',
      );
      expect(
        (await run(partial, ['--previous-tag', 'v1.0.0'])).exitCode,
      ).not.toBe(0);
      const named = await run(complete, ['--previous-tag', 'v1.0.0']);
      expect(named.exitCode, named.stderr).toBe(0);
      // What v1.0.0 already ships is not this release's, unless credited to it.
      const highlight = 'Schedules run on time.';
      const cited = await run(
        complete.replace(highlight, 'Schedules run on time (#11).'),
        [],
      );
      expect(cited.exitCode).not.toBe(0);
      expect(cited.stderr).toContain(
        'Release notes cite #11, which v1.0.0 already ships and no commit since refers to',
      );
      const credited = await run(
        complete.replace(
          highlight,
          'Schedules run on time, as in v1.0.0 (#11).',
        ),
        [],
      );
      expect(credited.exitCode, credited.stderr).toBe(0);
      // As Release and Publish packages run it, after the tag: the shape alone.
      const shaped = await run(partial, ['--shape-only']);
      expect(shaped.exitCode, shaped.stderr).toBe(0);
      expect(shaped.stdout).toBe('Validated .github/release-notes/v1.1.0.md\n');
      const both = await run(partial, [
        '--shape-only',
        '--previous-tag',
        'v1.0.0',
      ]);
      expect(both.exitCode).not.toBe(0);
      expect(both.stderr).toContain(
        '--previous-tag compares the release; --shape-only does not',
      );
      // With --source-root it compares the source's history, not the history of
      // the checkout that runs it (here none).
      const tooling = await validatorCheckout();
      const source = await run(
        complete,
        ['--source-root', repo.directory],
        tooling.directory,
      );
      expect(source.exitCode, source.stderr).toBe(0);
      expect(source.stdout).toBe(valid.stdout);
    });
  },
);
