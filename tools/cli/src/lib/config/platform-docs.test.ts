import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { deploymentSpecSchema } from '../deployment/model';
import { parsePlatformConfiguration } from './platform-model';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const CLI_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LOCALES = ['en', 'de', 'fr'];
/** The `.github/workflows/` files `scripts/deployment-ci.test.ts` reads. */
const CHECKED_WORKFLOWS = ['build.yml', 'cleanup-pr-images.yml'];

/** The slice of `turbo run --dry=json` this suite reads. */
const dryRunSchema = z.object({
  tasks: z.array(
    z.object({ taskId: z.string(), inputs: z.record(z.string(), z.string()) }),
  ),
});

/** The install page this suite parses, in the repo-root docs tree. */
function installPage(locale: string): string {
  return resolve(
    REPO_ROOT,
    'docs',
    locale,
    'self-hosted/install/cli-install.md',
  );
}

/** Published operator examples are executable declarations, including files
 * checked out with Windows line endings. No target credentials are needed. */
describe('documented general platform configuration', () => {
  for (const locale of LOCALES) {
    for (const newline of ['\n', '\r\n']) {
      test(`${locale} JSON examples with ${JSON.stringify(newline)}`, () => {
        const source = readFileSync(installPage(locale), 'utf8').replace(
          /\r?\n/g,
          newline,
        );
        const examples = [
          ...source.matchAll(/```json[^\r\n]*\r?\n([\s\S]*?)\r?\n```/g),
        ].map((match) => JSON.parse(match[1]));
        const ordinary = examples.find((example) => example.resources);
        const managed = examples.find((example) => example.configuration);
        expect(parsePlatformConfiguration(ordinary).resources).toHaveLength(2);
        const spec = deploymentSpecSchema.parse({
          schemaVersion: 1,
          name: 'example',
          stateDirectory: resolve(tmpdir(), 'tale-example'),
          composeProject: 'tale',
          runtime: { revision: 'a'.repeat(40) },
          origin: 'https://native.example.invalid',
          tlsMode: 'external',
          identity: {
            email: 'operator@example.invalid',
            slug: 'example',
            name: 'Example',
            ssoEnabled: false,
          },
          ...managed,
        });
        expect(
          spec.configuration?.resources.map((resource) => resource.kind),
        ).toEqual(['provider', 'provider-credential']);
      });
    }
  }
});

/** The pages sit outside this workspace, which is all turbo hashes by default:
 * without them as `test` inputs (`tools/cli/turbo.json`) a docs-only edit
 * replays this suite's cached verdict instead of parsing the new examples.
 * The workflows `scripts/deployment-ci.test.ts` checks sit outside it too: a
 * matrix edit in one of them alone must re-run that suite as well. */
test('turbo re-runs the suites when an install page or a checked workflow changes', () => {
  // `bun x`, not a `bunx` shim: the CLI workflow runs this suite on Windows.
  const run = Bun.spawnSync(
    [
      process.execPath,
      'x',
      'turbo',
      'run',
      'test',
      '--filter=@tale/cli',
      '--dry=json',
      '--cache=local:,remote:',
    ],
    { cwd: REPO_ROOT },
  );
  if (run.exitCode !== 0) {
    throw new Error(
      `turbo --dry=json exited ${run.exitCode}: ${run.stderr.toString()}`,
    );
  }
  const stdout = run.stdout.toString();
  const start = stdout.indexOf('{');
  if (start === -1) {
    throw new Error(`turbo --dry=json printed no JSON: ${stdout}`);
  }
  const { tasks } = dryRunSchema.parse(JSON.parse(stdout.slice(start)));
  const inputs = new Set(
    Object.keys(
      tasks.find((task) => task.taskId === '@tale/cli#test')?.inputs ?? {},
    ),
  );
  // `$TURBO_DEFAULT$` stays in the list, or the suite's own sources drop out.
  expect(inputs.has('package.json')).toBe(true);
  // Turbo keys inputs by `/`-separated paths relative to the workspace.
  const unhashed = [
    ...LOCALES.map((locale) => installPage(locale)),
    ...CHECKED_WORKFLOWS.map((name) =>
      resolve(REPO_ROOT, '.github/workflows', name),
    ),
  ]
    .map((file) => relative(CLI_ROOT, file).split(sep).join('/'))
    .filter((file) => !inputs.has(file));
  expect(unhashed).toEqual([]);
});

/** A workspace `inputs` list replaces the root task's instead of adding to it;
 * `$TURBO_EXTENDS$` keeps the root's, `$TURBO_DEFAULT$` the workspace's own. */
test('the test input list keeps the root inputs and the workspace sources', () => {
  const { tasks } = z
    .object({
      tasks: z.record(
        z.string(),
        z.object({ inputs: z.array(z.string()).optional() }),
      ),
    })
    .parse(JSON.parse(readFileSync(resolve(CLI_ROOT, 'turbo.json'), 'utf8')));
  expect(tasks.test?.inputs?.slice(0, 2)).toEqual([
    '$TURBO_EXTENDS$',
    '$TURBO_DEFAULT$',
  ]);
});
