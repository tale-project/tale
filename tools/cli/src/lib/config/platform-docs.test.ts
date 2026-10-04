import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { deploymentSpecSchema } from '../deployment/model';
import { REPOSITORY_RUNTIME_SOURCE } from '../deployment/runtime-test-helper';
import { parsePlatformConfiguration } from './platform-model';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const CLI_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LOCALES = ['en', 'de', 'fr'];
/** Outside files read by the CI workflow, cache and candidate regression suites. */
const CHECKED_CI_FILES = [
  'services/platform/tests/integration/container-image-test.ts',
  'turbo.json',
  'package.json',
  '.github/actions/setup-turbo/action.yml',
  'services/platform/vitest.config.ts',
  'packages/ui/vitest.config.ts',
  'services/platform/playwright.config.ts',
  'services/web/playwright.config.ts',
  'services/docs/playwright.config.ts',
  'packages/e2e/src/config.ts',
  '.github/workflows/build.yml',
  '.github/workflows/checks.yml',
  '.github/workflows/cleanup-pr-images.yml',
  '.github/workflows/commitlint.yml',
  '.github/workflows/e2e.yml',
  '.github/workflows/release-candidate-receipt.yml',
  '.github/workflows/release-candidate-source.yml',
  '.github/workflows/sast.yml',
  '.github/workflows/security.yml',
  '.github/actions/setup-cli/action.yml',
  '.github/workflows/scorecard.yml',
  '.github/scripts/pull-ci-images.sh',
  'services/platform/turbo.json',
];
/**
 * The files `compose/services/compose-parity.test.ts` holds the CLI's
 * generators against, from the repo root: the runtime source, the images'
 * entrypoints and Dockerfiles, and the workflows that build and release them.
 */
const PARITY_FILES = [
  '.github/workflows/build.yml',
  '.github/workflows/cli.yml',
  '.github/workflows/release.yml',
  'compose.yml',
  'compose.web.yml',
  'compose.docs.yml',
  'compose.ui-docs.yml',
  'compose.ai-gateway.yml',
  'services/proxy/Caddyfile',
  'services/proxy/docker-entrypoint.sh',
  'services/platform/Dockerfile',
  'services/platform/docker-entrypoint.sh',
  'services/platform/env.sh',
  'services/db/Dockerfile',
  'services/sandbox-egress/Dockerfile',
];

/** Inputs to the real local package publication in publish-package.test.ts. */
const PACKAGE_PUBLICATION_FILES = [
  'scripts/publish-package.ts',
  'LICENSE',
  'packages/ui/package.json',
  'packages/ui/README.md',
  'packages/marketing-ui/package.json',
  'packages/marketing-ui/README.md',
  '.github/workflows/publish-packages.yml',
];

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
 * The CI files `scripts/deployment-ci.test.ts` and the candidate graph suite
 * check sit outside it too: an edit to a workflow or the setup action alone
 * must re-run those suites as well.
 * So do the files the compose parity suite reads and the release's own runtime
 * source the runtime suites prepare: an edit to `compose.yml` alone must not
 * replay a verdict that says this CLI accepts it. */
test('turbo re-runs the suites when an install page or another outside file they read changes', () => {
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
  // Turbo keys inputs by `/`-separated paths relative to the workspace.
  // `$TURBO_DEFAULT$` stays in the list, or the suite's own sources drop out.
  // Probe this file: turbo hashes `package.json` and `turbo.json` either way.
  const self = relative(CLI_ROOT, fileURLToPath(import.meta.url))
    .split(sep)
    .join('/');
  expect(inputs.has(self), `@tale/cli#test does not hash ${self}`).toBe(true);
  const unhashed = [
    ...LOCALES.map((locale) => installPage(locale)),
    ...[
      ...new Set([
        ...CHECKED_CI_FILES,
        'scripts/install-cli.sh',
        'scripts/install-cli.ps1',
        ...PARITY_FILES,
        ...PACKAGE_PUBLICATION_FILES,
        ...REPOSITORY_RUNTIME_SOURCE,
      ]),
    ].map((path) => resolve(REPO_ROOT, path)),
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
