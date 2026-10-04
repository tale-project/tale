import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { z } from 'zod';

import { deploymentSpecSchema } from '../deployment/model';
import { REPOSITORY_RUNTIME_SOURCE } from '../deployment/runtime-test-helper';
import { parsePlatformConfiguration } from './platform-model';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const CLI_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LOCALES = ['en', 'de', 'fr'];
/** Outside files read by the CI, cache, candidate and performance suites. */
const CHECKED_CI_FILES = [
  'services/platform/tests/integration/container-image-test.ts',
  'turbo.json',
  'package.json',
  'services/web/turbo.json',
  'services/docs/turbo.json',
  'services/ui-docs/turbo.json',
  'services/web/playwright.config.ts',
  'services/docs/playwright.config.ts',
  'services/platform/vitest.ui.config.ts',
  '.github/actions/setup-turbo/action.yml',
  'services/platform/vitest.config.ts',
  'packages/ui/vitest.config.ts',
  'services/platform/playwright.config.ts',
  'packages/e2e/src/config.ts',
  ...readdirSync(resolve(REPO_ROOT, 'services'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `services/${entry.name}/Dockerfile`)
    .filter((file) => existsSync(resolve(REPO_ROOT, file))),
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
    z.object({
      taskId: z.string(),
      directory: z.string(),
      dependencies: z.array(z.string()),
      inputs: z.record(z.string(), z.string()),
      resolvedTaskDefinition: z.object({
        cache: z.boolean(),
        outputs: z.array(z.string()),
      }),
    }),
  ),
});
type DryRun = z.infer<typeof dryRunSchema>;
let dryRun: DryRun | undefined;

function cliDryRun(): DryRun {
  if (dryRun) return dryRun;
  // `bun x`, not a `bunx` shim: the CLI workflow runs this suite on Windows.
  const run = Bun.spawnSync(
    [
      process.execPath,
      'x',
      'turbo',
      'run',
      'lint',
      'typecheck',
      'test',
      'build',
      'generate',
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
  dryRun = dryRunSchema.parse(JSON.parse(stdout.slice(start)));
  return dryRun;
}

/** Modules reached by the compiler from every CLI source, including tests.
 * Use the same parser/resolver as the integration-scope guard; the ignored
 * generated module is checked through the generator's source trees below. */
function cliModuleGraph(): { files: Set<string>; unresolved: string[] } {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    resolve(CLI_ROOT, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        );
      },
    },
  );
  if (!parsed) throw new Error('tools/cli/tsconfig.json did not parse');
  const files = new Set<string>();
  const unresolved: string[] = [];
  const queue = [...parsed.fileNames];
  while (queue.length > 0) {
    const file = queue.pop();
    if (
      file === undefined ||
      files.has(file) ||
      file.startsWith(resolve(CLI_ROOT, 'src/generated') + sep)
    )
      continue;
    files.add(file);
    if (file.endsWith('.json')) continue;
    for (const { fileName } of ts.preProcessFile(
      readFileSync(file, 'utf8'),
      true,
      true,
    ).importedFiles) {
      const resolved = ts.resolveModuleName(
        fileName,
        file,
        parsed.options,
        ts.sys,
      ).resolvedModule?.resolvedFileName;
      if (resolved === undefined) {
        if (
          fileName.startsWith('.') ||
          fileName.startsWith('@/') ||
          fileName.startsWith('@tale/')
        )
          unresolved.push(`${relative(REPO_ROOT, file)}: ${fileName}`);
        continue;
      }
      if (
        resolved.split(sep).includes('node_modules') ||
        /\.d\.[cm]?ts$/.test(resolved) ||
        !resolved.startsWith(resolve(REPO_ROOT) + sep)
      )
        continue;
      queue.push(resolved);
    }
  }
  return { files, unresolved };
}

/** Source trees read as strings by generate-embedded.ts, rather than imports.
 * Read their actual string literals so a newly embedded tree joins this proof. */
function generatedSourceFiles(): string[] {
  const generator = resolve(CLI_ROOT, 'scripts/generate-embedded.ts');
  const source = ts.createSourceFile(
    generator,
    readFileSync(generator, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const roots: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) && /^(?:services|configs)\//.test(node.text))
      roots.push(node.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(roots).toHaveLength(4);
  const result = Bun.spawnSync(['git', 'ls-files', '-z', '--', ...roots], {
    cwd: REPO_ROOT,
  });
  if (result.exitCode !== 0)
    throw new Error(`git ls-files exited ${result.exitCode}`);
  return result.stdout
    .toString()
    .split('\0')
    .filter(Boolean)
    .map((file) => resolve(REPO_ROOT, file));
}

/** A consumer hashes both its own files and every dependency's inputs. */
function effectiveInputs(taskId: string): Set<string> {
  const tasks = new Map(cliDryRun().tasks.map((task) => [task.taskId, task]));
  const files = new Set<string>();
  const visited = new Set<string>();
  const queue = [taskId];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    const task = tasks.get(id);
    if (!task) throw new Error(`Turbo did not describe ${id}`);
    for (const input of Object.keys(task.inputs))
      files.add(resolve(REPO_ROOT, task.directory, input));
    queue.push(...task.dependencies);
  }
  return files;
}

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
  const { tasks } = cliDryRun();
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

test('cached CLI checks hash every imported module and generated source tree', () => {
  const graph = cliModuleGraph();
  expect(graph.unresolved).toEqual([]);
  expect(graph.files.size).toBeGreaterThan(400);
  for (const file of [
    'services/platform/backend/auth/oidc.ts',
    'services/platform/backend/domains/two_factor/service.ts',
    'services/platform/backend/core/automations/pack_zip.ts',
    'services/platform/lib/shared/schemas/password.ts',
    'packages/shared/src/schemas/skills.ts',
  ])
    expect(graph.files).toContain(resolve(REPO_ROOT, file));
  const generated = generatedSourceFiles();
  expect(generated.length).toBeGreaterThan(200);
  for (const name of ['lint', 'typecheck', 'test']) {
    const inputs = effectiveInputs(`@tale/cli#${name}`);
    expect(
      [...graph.files, ...generated]
        .filter((file) => !inputs.has(file))
        .map((file) => relative(REPO_ROOT, file).split(sep).join('/'))
        .sort(),
      `@tale/cli#${name}: add uncovered source files to CLI transit inputs`,
    ).toEqual([]);
  }
});

test('Git-stamped CLI generation and builds always record the current checkout', () => {
  for (const [name, output] of [
    ['generate', 'src/generated/**'],
    ['build', 'dist/**'],
  ]) {
    const task = cliDryRun().tasks.find(
      (entry) => entry.taskId === `@tale/cli#${name}`,
    );
    expect(task?.resolvedTaskDefinition.cache, name).toBe(false);
    expect(task?.resolvedTaskDefinition.outputs, name).toContain(output);
  }
});

/** A workspace `inputs` list replaces the root task's instead of adding to it;
 * `$TURBO_EXTENDS$` keeps the root's, `$TURBO_DEFAULT$` the workspace's own. */
test('outside input lists keep the root inputs and the workspace sources', () => {
  const { tasks } = z
    .object({
      tasks: z.record(
        z.string(),
        z.object({ inputs: z.array(z.string()).optional() }),
      ),
    })
    .parse(JSON.parse(readFileSync(resolve(CLI_ROOT, 'turbo.json'), 'utf8')));
  for (const name of ['test', 'transit'])
    expect(tasks[name]?.inputs?.slice(0, 2), name).toEqual([
      '$TURBO_EXTENDS$',
      '$TURBO_DEFAULT$',
    ]);
});
