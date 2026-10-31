/**
 * The release tag workflow (.github/workflows/release-tag.yml) pushes a release
 * tag with a deploy key that only its environment holds, so it must tag nothing
 * but an eligible candidate of main and leave the key nowhere. These tests run
 * it as GitHub does: its steps in order, `if: always()` honoured, each `run:`
 * under `bash --noprofile --norc -eo pipefail` with the step's `env:`. Stubs
 * stand in for what only a runner has: `bun` (the install, and the gate's
 * answer), `gh` (the host keys of api.github.com/meta) and `ssh`, which serves
 * the push from a bare repository standing in for GitHub.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { fixtureGit } from '../src/lib/config/releases/tests/fixture-git';

type Step = {
  id?: string;
  name: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  'working-directory'?: string;
};
type Job = {
  'runs-on'?: string;
  environment?: string | { name?: string };
  permissions?: unknown;
  concurrency?: string | { group?: string };
  steps?: Step[];
};
type Workflow = {
  on: unknown;
  permissions?: unknown;
  concurrency?: string | { group?: string; 'cancel-in-progress'?: boolean };
  defaults?: unknown;
  jobs: Record<string, Job>;
};

const workflows = fileURLToPath(
  new URL('../../../.github/workflows', import.meta.url),
);
const source = await readFile(join(workflows, 'release-tag.yml'), 'utf8');
const workflow = parse(source) as Workflow;
const job = workflow.jobs.tag!;
const steps = job.steps ?? [];
const step = (name: string) => {
  const found = steps.find((item) => item.name === name);
  if (!found) throw new Error(`Missing step: ${name}`);
  return found;
};

const VERSION = 'v0.5.95';
const TOKEN = 'fixture-github-token';
/** The deploy key the environment hands the job: several lines, as a private key. */
const KEY = 'fixture-deploy-key-line-1\nfixture-deploy-key-line-2';
/** Where the push step keeps the key and the pinned host keys, in $RUNNER_TEMP. */
const KEY_FILE = 'release-tag-deploy-key';
const KNOWN_HOSTS = 'release-tag-known-hosts';
/** What `gh api meta --jq '.ssh_keys[]'` prints: one host key a line. */
const HOST_KEYS = [
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEZpeHR1cmUgaG9zdCBrZXk',
  'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY=',
];

test('runs on a release-tag dispatch only, in the release environment, reading only', () => {
  expect(workflow.on).toEqual({
    repository_dispatch: { types: ['release-tag'] },
  });
  expect(workflow.permissions).toEqual({ contents: 'read', actions: 'read' });
  expect(workflow.concurrency).toEqual({
    group: 'release-tag',
    'cancel-in-progress': false,
  });
  expect(workflow.defaults).toEqual({ run: { shell: 'bash' } });
  expect(Object.keys(workflow.jobs)).toEqual(['tag']);
  expect(job.environment).toBe('release');
  expect(job['runs-on']).toBe('ubuntu-latest');
  expect(job.permissions).toBeUndefined();
});

test('no other workflow names the release environment, its key or its queue', async () => {
  const others = (await readdir(workflows)).filter(
    (file) => /\.ya?ml$/.test(file) && file !== 'release-tag.yml',
  );
  expect(others.length).toBeGreaterThan(10);
  for (const file of others) {
    const text = await readFile(join(workflows, file), 'utf8');
    const other = parse(text) as Workflow;
    expect([file, text.includes('RELEASE_TAG_DEPLOY_KEY')]).toEqual([
      file,
      false,
    ]);
    const groups = [
      other.concurrency,
      ...Object.values(other.jobs).map((item) => item.concurrency),
    ].map((value) => (typeof value === 'string' ? value : value?.group));
    expect([file, groups.includes('release-tag')]).toEqual([file, false]);
    for (const [id, item] of Object.entries(other.jobs)) {
      const name =
        typeof item.environment === 'string'
          ? item.environment
          : item.environment?.name;
      // GitHub ignores the case of an environment's name, and an expression
      // could name this one when the job runs.
      if (name !== undefined)
        expect([
          file,
          id,
          /^[\w-]+$/.test(name) && name.toLowerCase() !== 'release',
        ]).toEqual([file, id, true]);
    }
  }
});

test("checks the payload against Prepare's patterns first, and lets it reach the shell only through env", async () => {
  const release = parse(
    await readFile(join(workflows, 'release.yml'), 'utf8'),
  ) as Workflow;
  const prepare =
    Object.values(release.jobs)
      .flatMap((item) => item.steps ?? [])
      .find((item) => item.id === 'version')?.run ?? '';
  const pattern = (script: string, variable: string) =>
    new RegExp(`\\[\\[ ! "\\$${variable}" =~ (\\S+) \\]\\]`).exec(script)?.[1];
  const sha = pattern(prepare, 'SOURCE_SHA');
  const number = pattern(prepare, 'VERSION_NUMBER');
  expect(sha).toBeDefined();
  expect(number).toBeDefined();
  const [request] = steps;
  expect(request?.id).toBe('request');
  expect(request?.env).toEqual({
    CANDIDATE_SHA: '${{ github.event.client_payload.candidate_sha }}',
    VERSION: '${{ github.event.client_payload.version }}',
  });
  expect(pattern(request?.run ?? '', 'CANDIDATE_SHA')).toBe(sha!);
  // Prepare reads the number after an optional v; a request names the tag, v
  // and all, as the gate's --version does.
  expect(pattern(request?.run ?? '', 'VERSION')).toBe(`^v${number!.slice(1)}`);
  for (const item of steps) {
    expect([item.name, item.run?.includes('${{') ?? false]).toEqual([
      item.name,
      false,
    ]);
    if (item !== request)
      expect([
        item.name,
        JSON.stringify(item).includes('github.event'),
      ]).toEqual([item.name, false]);
  }
});

test('only the push step holds the key, writes it nowhere but its file, and an always() step removes that', () => {
  const push = step('Push the tag');
  const remove = step('Remove the key');
  expect(source.match(/secrets\./g)).toEqual(['secrets.']);
  expect(push.env?.DEPLOY_KEY).toBe('${{ secrets.RELEASE_TAG_DEPLOY_KEY }}');
  for (const item of steps)
    if (item !== push)
      expect([item.name, JSON.stringify(item).includes('DEPLOY_KEY')]).toEqual([
        item.name,
        false,
      ]);
  // The key is tested, written to its file and unset before git or ssh starts.
  expect(
    push.run
      ?.split('\n')
      .filter((line) => /\bDEPLOY_KEY\b/.test(line))
      .map((line) => line.trim()),
  ).toEqual([
    'if [ -z "$DEPLOY_KEY" ]; then',
    `(umask 077 && printf '%s\\n' "$DEPLOY_KEY" > "$key")`,
    'unset DEPLOY_KEY',
  ]);
  expect(push.run).toContain(`key="$RUNNER_TEMP/${KEY_FILE}"`);
  for (const item of steps)
    expect([
      item.name,
      /\bset -[a-z]*x|xtrace|ssh-keyscan|GIT_TRACE|ssh -v/.test(item.run ?? ''),
    ]).toEqual([item.name, false]);
  expect(remove.if).toBe('always()');
  expect(steps.indexOf(remove)).toBe(steps.indexOf(push) + 1);
  expect(remove.run).toContain(`"$RUNNER_TEMP/${KEY_FILE}"`);
  expect(remove.run).toContain(`"$RUNNER_TEMP/${KNOWN_HOSTS}"`);
});

test('checks out and sets up Bun with the pins release.yml uses', async () => {
  const release = parse(
    await readFile(join(workflows, 'release.yml'), 'utf8'),
  ) as Workflow;
  const used = Object.values(release.jobs).flatMap((item) => item.steps ?? []);
  const pins = (action: string) => [
    ...new Set(
      used.flatMap((item) =>
        item.uses?.startsWith(`${action}@`)
          ? [
              `${item.uses} ${JSON.stringify(item.with?.['bun-version'] ?? null)}`,
            ]
          : [],
      ),
    ),
  ];
  const checkout = step('Checkout the candidate');
  const bun = step('Setup Bun');
  expect(pins('actions/checkout')).toEqual([`${checkout.uses} null`]);
  expect(pins('oven-sh/setup-bun')).toEqual([
    `${bun.uses} ${JSON.stringify(bun.with?.['bun-version'])}`,
  ]);
  expect(checkout.with).toEqual({
    ref: '${{ steps.request.outputs.sha }}',
    'fetch-depth': 0,
    'fetch-tags': true,
    'persist-credentials': false,
  });
});

type Outcome = 'success' | 'failure' | 'skipped';
type Scenario = {
  payload?: Record<string, unknown>;
  /** The environment's RELEASE_TAG_DEPLOY_KEY; GitHub hands an unset secret as ''. */
  key?: string;
  /** What the gate prints and how it exits. */
  gate?: { report: string; exit: number; errors?: string };
  /** What api.github.com/meta lists, and how gh exits. */
  meta?: { keys: string; exit?: number };
  /** A commit the release tag already names on GitHub. */
  tagged?: string;
};

const BASH = process.platform === 'darwin' ? '/bin/bash' : 'bash';
const IDENTITY = [
  '-c',
  'user.name=Release fixture',
  '-c',
  'user.email=release-fixture@example.invalid',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.hooksPath=/dev/null',
];
/** What actions/checkout does with a commit as ref, fetch-depth 0 and fetch-tags. */
const CHECKOUT = String.raw`git -c init.defaultBranch=main init -q .
git remote add origin "$STUB_ORIGIN"
git fetch -q --tags origin '+refs/heads/*:refs/remotes/origin/*'
git checkout -q --detach "$CHECKOUT_REF"
`;
/** Each stub notes how it was called in $STUB_DIR, where the test reads it. */
const STUBS = {
  // Installs nothing; the gate answers what the test put in $STUB_DIR.
  bun: String.raw`#!/usr/bin/env bash
set -e
printf '%s|%s\n' "$PWD" "$*" >> "$STUB_DIR/bun.calls"
if [ "$1" = install ]; then exit 0; fi
if [ "$1" = tools/cli/scripts/release-candidate-gate.ts ]; then
  printf '%s|%s\n' "$(git rev-parse HEAD)" "$GH_TOKEN" > "$STUB_DIR/gate.call"
  cat "$STUB_DIR/gate.out"
  cat "$STUB_DIR/gate.err" >&2
  exit "$(cat "$STUB_DIR/gate.exit")"
fi
echo "unexpected: bun $*" >&2
exit 1
`,
  // Answers only the host keys of api.github.com/meta.
  gh: String.raw`#!/usr/bin/env bash
set -e
printf '%s|%s\n' "$GH_TOKEN" "$*" >> "$STUB_DIR/gh.calls"
if [ "$*" != 'api meta --jq .ssh_keys[]' ]; then
  echo "unexpected: gh $*" >&2
  exit 1
fi
cat "$STUB_DIR/meta.out"
exit "$(cat "$STUB_DIR/meta.exit")"
`,
  // Notes its arguments, the key file's mode and blob, the host keys it would
  // trust and whether the key is still in its environment, then serves the
  // push from the bare repository that stands in for GitHub.
  ssh: String.raw`#!/usr/bin/env bash
set -e
printf '%s\n' "$@" > "$STUB_DIR/ssh.args"
identity=
known=
previous=
host=
command=
for argument in "$@"; do
  if [ "$previous" = -i ]; then identity=$argument; fi
  case "$argument" in
    UserKnownHostsFile=*) known=$(printf '%s' "$argument" | cut -d= -f2-) ;;
  esac
  previous=$argument
  host=$command
  command=$argument
done
stat -c %a "$identity" > "$STUB_DIR/ssh.key-mode" 2> /dev/null ||
  stat -f %Lp "$identity" > "$STUB_DIR/ssh.key-mode"
git hash-object --no-filters "$identity" > "$STUB_DIR/ssh.key-blob"
cat "$known" > "$STUB_DIR/ssh.known-hosts"
if [ -n "$DEPLOY_KEY" ]; then echo present; else echo absent; fi > "$STUB_DIR/ssh.key-variable"
if [ "$host" != git@github.com ] || [ "$command" != "git-receive-pack 'tale-project/tale.git'" ]; then
  echo "unexpected: ssh $host $command" >&2
  exit 1
fi
exec git receive-pack "$STUB_REMOTE"
`,
};

/** `${{ a.b.c }}` lookups, the only expressions the job's env and inputs use. */
function interpolate(value: string, context: object): string {
  return value.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, expression: string) => {
    if (!/^[\w-]+(\.[\w-]+)*$/.test(expression))
      throw new Error(`The harness evaluates lookups only, not ${expression}`);
    let found: unknown = context;
    for (const key of expression.split('.'))
      found =
        typeof found === 'object' && found !== null
          ? (found as Record<string, unknown>)[key]
          : undefined;
    if (found === undefined || found === null) return '';
    return typeof found === 'object' ? JSON.stringify(found) : String(found);
  });
}

/** A step's GITHUB_OUTPUT file: name=value lines, the only form this job writes. */
function outputs(text: string) {
  const values: Record<string, string> = {};
  for (const line of text.split('\n').filter(Boolean)) {
    const match = /^([\w-]+)=(.*)$/.exec(line);
    if (!match) throw new Error(`Not a name=value output: ${line}`);
    values[match[1]!] = match[2]!;
  }
  return values;
}

/** The blob id `git hash-object` gives a file of these bytes. */
const blob = (content: string) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(content)}\0${content}`)
    .digest('hex');

const refs = (repository: string) =>
  fixtureGit(repository)('for-each-ref', '--format=%(refname) %(objectname)');

describe.skipIf(process.platform === 'win32')(
  'the job, run as GitHub runs it',
  () => {
    const roots: string[] = [];
    let seed = {
      root: '',
      repository: '',
      bin: '',
      first: '',
      candidate: '',
      side: '',
    };

    beforeAll(async () => {
      const root = await realpath(
        await mkdtemp(join(tmpdir(), 'tale-release-tag-seed-')),
      );
      const repository = join(root, 'repository');
      const bin = join(root, 'bin');
      await mkdir(join(repository, 'tools/cli'), { recursive: true });
      await mkdir(bin);
      for (const [name, script] of Object.entries(STUBS)) {
        await writeFile(join(bin, name), script);
        await chmod(join(bin, name), 0o755);
      }
      await writeFile(
        join(repository, 'tools/cli/package.json'),
        '{ "name": "@tale/cli" }\n',
      );
      const git = fixtureGit(repository);
      git('-c', 'init.defaultBranch=main', 'init', '-q');
      git('add', '.');
      const commit = (message: string) => {
        git(...IDENTITY, 'commit', '-q', '--allow-empty', '-m', message);
        return git('rev-parse', 'HEAD');
      };
      const first = commit('fix: an earlier commit of main');
      const candidate = commit('fix: the release candidate');
      // A commit GitHub holds on a branch only, never merged into main.
      const side = git(
        ...IDENTITY,
        'commit-tree',
        `${first}^{tree}`,
        '-p',
        first,
        '-m',
        'fix: a commit only a branch holds',
      );
      git('update-ref', 'refs/heads/side', side);
      seed = { root, repository, bin, first, candidate, side };
    });
    afterAll(async () => {
      if (seed.root) await rm(seed.root, { recursive: true, force: true });
    });
    afterEach(async () => {
      for (const directory of roots.splice(0))
        await rm(directory, { recursive: true, force: true });
    });

    /** A gate report as release-candidate-gate.ts prints it, cut to what the job reads. */
    const report = (state: string) =>
      `${JSON.stringify(
        {
          state,
          candidate: seed.candidate,
          version: VERSION,
          reasons:
            state === 'eligible' ? [] : [`fixture reason for ${state.trim()}`],
        },
        null,
        2,
      )}\n`;

    async function run(scenario: Scenario = {}) {
      const base = await realpath(
        await mkdtemp(join(tmpdir(), 'tale-release-tag-')),
      );
      roots.push(base);
      const paths = {
        base,
        origin: join(base, 'origin.git'),
        workspace: join(base, 'workspace'),
        temp: join(base, 'runner-temp'),
        home: join(base, 'home'),
        stub: join(base, 'stub'),
        commands: join(base, 'commands'),
      };
      for (const directory of [
        paths.workspace,
        paths.temp,
        paths.home,
        paths.stub,
        paths.commands,
      ])
        await mkdir(directory);
      fixtureGit(base)('clone', '-q', '--bare', seed.repository, paths.origin);
      if (scenario.tagged)
        fixtureGit(paths.origin)(
          'update-ref',
          `refs/tags/${VERSION}`,
          scenario.tagged,
        );
      const gate = scenario.gate ?? { report: report('eligible'), exit: 0 };
      const meta = scenario.meta ?? { keys: `${HOST_KEYS.join('\n')}\n` };
      const answers = {
        'gate.out': gate.report,
        'gate.err': gate.errors ?? '',
        'gate.exit': String(gate.exit),
        'meta.out': meta.keys,
        'meta.exit': String(meta.exit ?? 0),
      };
      for (const [name, content] of Object.entries(answers))
        await writeFile(join(paths.stub, name), content);
      const summary = join(paths.commands, 'step-summary.md');
      await writeFile(summary, '');
      const before = refs(paths.origin);
      const context = {
        github: {
          event: {
            client_payload: scenario.payload ?? {
              candidate_sha: seed.candidate,
              version: VERSION,
            },
          },
          token: TOKEN,
        },
        secrets: { RELEASE_TAG_DEPLOY_KEY: scenario.key ?? KEY },
        steps: {} as Record<
          string,
          { outputs: Record<string, string>; outcome: Outcome }
        >,
      };
      const outcomes: Record<string, Outcome> = {};
      let failed = false;
      let log = '';
      for (const [index, item] of steps.entries()) {
        const condition = item.if ?? 'success()';
        if (condition !== 'success()' && condition !== 'always()')
          throw new Error(
            `The harness runs success() and always() steps, not ${condition}`,
          );
        let outcome: Outcome = 'skipped';
        let written: Record<string, string> = {};
        if (condition === 'always()' || !failed) {
          const output = join(paths.commands, `output-${index}`);
          await writeFile(output, '');
          const env: Record<string, string> = {
            PATH: `${seed.bin}:${process.env.PATH}`,
            HOME: paths.home,
            GIT_CONFIG_NOSYSTEM: '1',
            RUNNER_TEMP: paths.temp,
            GITHUB_WORKSPACE: paths.workspace,
            GITHUB_OUTPUT: output,
            GITHUB_STEP_SUMMARY: summary,
            STUB_DIR: paths.stub,
            STUB_REMOTE: paths.origin,
          };
          for (const [name, value] of Object.entries(item.env ?? {}))
            env[name] = interpolate(String(value), context);
          let script: string;
          let cwd = paths.workspace;
          if (item.uses?.startsWith('actions/checkout@')) {
            script = CHECKOUT;
            env.STUB_ORIGIN = paths.origin;
            env.CHECKOUT_REF = interpolate(String(item.with?.ref), context);
          } else if (item.uses?.startsWith('oven-sh/setup-bun@')) {
            // The bun stub is on the PATH already.
            script = ':';
          } else if (item.run !== undefined && item.uses === undefined) {
            script = item.run;
            cwd = join(paths.workspace, item['working-directory'] ?? '');
          } else throw new Error(`The harness cannot run ${item.name}`);
          const file = join(paths.commands, `step-${index}.sh`);
          await writeFile(file, script);
          const child = Bun.spawn(
            [BASH, '--noprofile', '--norc', '-eo', 'pipefail', file],
            { cwd, env, stdout: 'pipe', stderr: 'pipe' },
          );
          const [status, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
          ]);
          log += `\n# ${item.name}\n${stdout}${stderr}`;
          outcome = status === 0 ? 'success' : 'failure';
          written = outputs(await readFile(output, 'utf8'));
          failed ||= outcome === 'failure';
        }
        outcomes[item.name] = outcome;
        if (item.id) context.steps[item.id] = { outputs: written, outcome };
      }
      return {
        paths,
        before,
        outcomes,
        steps: context.steps,
        log,
        summary: await readFile(summary, 'utf8'),
        failed,
      };
    }
    type Run = Awaited<ReturnType<typeof run>>;

    /** Files outside the repositories that hold a line of the key, by path. */
    async function holdingKey(base: string) {
      const found: string[] = [];
      for (const name of await readdir(base, { recursive: true })) {
        if (/(^|[\\/])(origin\.git|\.git)([\\/]|$)/.test(name)) continue;
        const path = join(base, name);
        if (!(await stat(path)).isFile()) continue;
        const content = await readFile(path, 'utf8');
        if (KEY.split('\n').some((line) => content.includes(line)))
          found.push(name);
      }
      return found;
    }

    /** The key and the pinned host keys are gone, and no line of the key is anywhere. */
    async function expectNoKeyLeft(result: Run) {
      expect(existsSync(join(result.paths.temp, KEY_FILE))).toBe(false);
      expect(existsSync(join(result.paths.temp, KNOWN_HOSTS))).toBe(false);
      expect(await holdingKey(result.paths.base)).toEqual([]);
      for (const line of KEY.split('\n'))
        expect(result.log).not.toContain(line);
    }

    /**
     * The run failed at `name`: every step before it passed, every later one
     * but the always() steps was skipped, no ref of GitHub moved, and the key
     * is nowhere. A run that stopped before the push never started ssh.
     */
    async function expectRefused(result: Run, name: string) {
      const at = steps.indexOf(step(name));
      expect(
        steps.map((item) => [item.name, result.outcomes[item.name]]),
      ).toEqual(
        steps.map((item, index) => [
          item.name,
          index < at || item.if === 'always()'
            ? 'success'
            : index === at
              ? 'failure'
              : 'skipped',
        ]),
      );
      expect(result.failed).toBe(true);
      expect(refs(result.paths.origin)).toBe(result.before);
      expect(result.summary).toContain(', not pushed');
      if (at < steps.indexOf(step('Push the tag')))
        expect(existsSync(join(result.paths.stub, 'ssh.args'))).toBe(false);
      await expectNoKeyLeft(result);
    }

    test('tags an eligible candidate of main with the deploy key, and leaves no key behind', async () => {
      const result = await run();
      const { paths } = result;
      expect(result.failed, result.log).toBe(false);
      expect(Object.values(result.outcomes)).toEqual(
        steps.map(() => 'success'),
      );
      expect(refs(paths.origin)).toBe(
        `${result.before}\nrefs/tags/${VERSION} ${seed.candidate}`,
      );

      // The gate ran in the checkout of the candidate, with the job's token,
      // after a frozen install that ran no package's scripts.
      expect(await readFile(join(paths.stub, 'bun.calls'), 'utf8')).toBe(
        [
          `${paths.workspace}/tools/cli|install --frozen-lockfile --filter @tale/cli --ignore-scripts`,
          `${paths.workspace}|tools/cli/scripts/release-candidate-gate.ts --sha ${seed.candidate} --version ${VERSION}`,
          '',
        ].join('\n'),
      );
      expect(await readFile(join(paths.stub, 'gate.call'), 'utf8')).toBe(
        `${seed.candidate}|${TOKEN}\n`,
      );
      expect(await readFile(join(paths.stub, 'gh.calls'), 'utf8')).toBe(
        `${TOKEN}|api meta --jq .ssh_keys[]\n`,
      );

      // ssh trusted only the host keys of api.github.com/meta, and pushed with
      // the environment's key from a file only its owner could read.
      const args = (await readFile(join(paths.stub, 'ssh.args'), 'utf8'))
        .trimEnd()
        .split('\n');
      const known = join(paths.temp, KNOWN_HOSTS);
      expect(args.slice(-2)).toEqual([
        'git@github.com',
        "git-receive-pack 'tale-project/tale.git'",
      ]);
      expect(args[args.indexOf('-F') + 1]).toBe('/dev/null');
      expect(args[args.indexOf('-i') + 1]).toBe(join(paths.temp, KEY_FILE));
      for (const option of [
        'IdentitiesOnly=yes',
        'BatchMode=yes',
        'StrictHostKeyChecking=yes',
        `UserKnownHostsFile=${known}`,
        'GlobalKnownHostsFile=/dev/null',
      ])
        expect(args[args.indexOf(option) - 1]).toBe('-o');
      expect(await readFile(join(paths.stub, 'ssh.known-hosts'), 'utf8')).toBe(
        HOST_KEYS.map((key) => `github.com ${key}\n`).join(''),
      );
      expect(await readFile(join(paths.stub, 'ssh.key-mode'), 'utf8')).toBe(
        '600\n',
      );
      expect(await readFile(join(paths.stub, 'ssh.key-blob'), 'utf8')).toBe(
        `${blob(`${KEY}\n`)}\n`,
      );
      expect(await readFile(join(paths.stub, 'ssh.key-variable'), 'utf8')).toBe(
        'absent\n',
      );
      await expectNoKeyLeft(result);

      expect(result.summary).toContain(
        `State \`eligible\`, exit 0.\n\n\`\`\`json\n${report('eligible')}\`\`\``,
      );
      expect(result.summary).toContain(
        [
          '## Release tag',
          '',
          `- **Tag**: \`${VERSION}\`, pushed`,
          `- **Commit**: \`${seed.candidate}\``,
          '- **Gate**: `eligible`',
        ].join('\n'),
      );
    });

    test.each([
      ['a short SHA', { candidate_sha: 'abc1234' }],
      ['an uppercase SHA', { candidate_sha: 'A'.repeat(40) }],
      ['a SHA and a newline', { candidate_sha: `${'a'.repeat(40)}\n` }],
      ['a command for a SHA', { candidate_sha: '$(touch injected)' }],
      ['no SHA', { candidate_sha: undefined }],
      ['a version without its v', { version: '0.5.95' }],
      ['a version of two numbers', { version: 'v0.5' }],
      ['a version and a newline', { version: `${VERSION}\n` }],
      ['a command in a version', { version: `${VERSION}$(touch injected)` }],
      ['no version', { version: undefined }],
    ])(
      'refuses %s before it checks anything out, and repeats none of it',
      async (_, change) => {
        const result = await run({
          payload: {
            candidate_sha: seed.candidate,
            version: VERSION,
            ...change,
          },
        });
        await expectRefused(result, 'Validate the request');
        expect(existsSync(join(result.paths.workspace, '.git'))).toBe(false);
        expect(existsSync(join(result.paths.workspace, 'injected'))).toBe(
          false,
        );
        expect(result.steps.request?.outputs).toEqual({});
        for (const value of Object.values(change))
          if (value) expect(result.log + result.summary).not.toContain(value);
      },
    );

    test('refuses a commit that is not on main, before the gate runs', async () => {
      const result = await run({
        payload: { candidate_sha: seed.side, version: VERSION },
      });
      await expectRefused(result, 'Refuse a candidate that is not on main');
      expect(result.log).toContain(`::error::${seed.side} is not on main`);
      expect(existsSync(join(result.paths.stub, 'bun.calls'))).toBe(false);
    });

    test('refuses a commit GitHub does not hold', async () => {
      const result = await run({
        payload: { candidate_sha: 'e'.repeat(40), version: VERSION },
      });
      await expectRefused(result, 'Checkout the candidate');
    });

    test.each([
      ['pending', 1],
      ['blocked', 1],
      ['allocated', 1],
      ['conflict', 1],
      ['pending', 0],
      ['eligible', 1],
    ])(
      'refuses a candidate the gate calls %s with exit %d, and shows its report in the summary',
      async (state, exit) => {
        const result = await run({ gate: { report: report(state), exit } });
        await expectRefused(result, 'Run the release gate');
        expect(result.steps.gate?.outputs).toEqual({ state });
        expect(result.summary).toContain(
          `State \`${state}\`, exit ${exit}.\n\n\`\`\`json\n${report(state)}\`\`\``,
        );
        expect(result.summary).toContain(`- **Gate**: \`${state}\``);
        expect(result.log).toContain(
          `::error::The release gate answered ${state} (exit ${exit}); its report is in the summary`,
        );
        // The report stays out of the log, where a line could be read as a command.
        expect(result.log).not.toContain('fixture reason');
        expect(existsSync(join(result.paths.stub, 'gh.calls'))).toBe(false);
      },
    );

    test.each([
      [
        'that stopped on a usage error',
        { report: '', exit: 2, errors: 'usage: fixture refusal\n' },
      ],
      ['that printed no JSON', { report: 'eligible\n', exit: 0, errors: '' }],
      [
        'whose state is not a string',
        { report: '{"state":1}\n', exit: 0, errors: '' },
      ],
    ])('refuses a gate %s as unreadable', async (_, gate) => {
      const result = await run({ gate });
      await expectRefused(result, 'Run the release gate');
      expect(result.steps.gate?.outputs).toEqual({ state: 'unreadable' });
      expect(result.summary).toContain(
        `State \`unreadable\`, exit ${gate.exit}.`,
      );
      if (gate.errors)
        expect(result.summary).toContain(`\`\`\`text\n${gate.errors}\`\`\``);
      else expect(result.summary).not.toContain('```text');
    });

    test('a state that carries a line of its own sets no output', async () => {
      const result = await run({
        gate: { report: report('eligible\nforged=yes'), exit: 0 },
      });
      await expectRefused(result, 'Run the release gate');
      expect(result.steps.gate?.outputs).toEqual({ state: 'unreadable' });
    });

    const notAKey =
      'api.github.com/meta lists an SSH host key that is not a key';
    test.each([
      [
        'lists no host keys',
        { keys: '' },
        'api.github.com/meta lists no SSH host keys',
      ],
      ['cannot be read', { keys: '', exit: 1 }, undefined],
      [
        'lists a line that is not a key',
        { keys: `${HOST_KEYS[0]}\n@cert-authority * ${HOST_KEYS[1]}\n` },
        notAKey,
      ],
      [
        'lists a key for another host',
        { keys: `example.com ${HOST_KEYS[0]}\n` },
        notAKey,
      ],
    ])('pushes nothing when api.github.com/meta %s', async (_, meta, error) => {
      const result = await run({ meta });
      await expectRefused(result, "Pin github.com's host keys");
      if (error) expect(result.log).toContain(`::error::${error}`);
    });

    test('pushes nothing when the environment holds no key', async () => {
      const result = await run({ key: '' });
      await expectRefused(result, 'Push the tag');
      expect(result.log).toContain(
        '::error::The release environment holds no RELEASE_TAG_DEPLOY_KEY',
      );
      expect(existsSync(join(result.paths.stub, 'ssh.args'))).toBe(false);
    });

    test('never moves a tag GitHub holds, and still removes the key', async () => {
      const result = await run({ tagged: seed.first });
      await expectRefused(result, 'Push the tag');
      expect(existsSync(join(result.paths.stub, 'ssh.args'))).toBe(true);
      expect(result.before).toContain(`refs/tags/${VERSION} ${seed.first}`);
    });
  },
);
