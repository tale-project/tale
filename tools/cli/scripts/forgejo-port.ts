#!/usr/bin/env bun
/**
 * Port Tale's GitHub Actions to Forgejo.
 *
 *   bun tools/cli/scripts/forgejo-port.ts report            what the port does to each file
 *   bun tools/cli/scripts/forgejo-port.ts check             port in memory and fail on a problem, a rule that found nothing to change, a local action left as GitHub's, or a README that lacks a mirror
 *   bun tools/cli/scripts/forgejo-port.ts generate [--write [--force]] the files of `.forgejo/` (the cut-over)
 *   bun tools/cli/scripts/forgejo-port.ts checks [--write]  the checks a pull request waits for
 *   bun tools/cli/scripts/forgejo-port.ts github [--write]  the edits GitHub's copies of the workflows that stay need
 *
 * `--root <dir>` names the repository (default: the checkout this file is in), `--out <dir>`
 * where `generate --write` puts the files (default: the root) and `--runner <binary>` makes
 * `check` hold every generated file to that forgejo-runner. `generate --write` overwrites a file
 * that differs and deletes a file of the generated directories it does not produce, so it refuses
 * both unless `--force` is given. The port is a function of the files under `.github/`;
 * `forgejo-port/README.md` says what it does and why.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { parse, stringify } from 'yaml';

import {
  WORKFLOW_DIR,
  generate,
  type Generated,
  type Sources,
} from './forgejo-port/generate';
import { planGithubEdits } from './forgejo-port/github-edits';
import { MANIFEST, type Manifest } from './forgejo-port/manifest';
import type { Problem } from './forgejo-port/validate';

/** The checks a pull request waits for, as the port generates them. */
export const DECLARED_CHECKS =
  'tools/cli/scripts/forgejo-port/declared-checks.yml';

/** The README that lists what the node must hold, among it the actions it mirrors. */
export const README = 'tools/cli/scripts/forgejo-port/README.md';

/** The directories the generator owns under the repository root. */
const GENERATED_DIRS = [
  '.forgejo/workflows',
  '.forgejo/actions',
  '.forgejo/scripts',
];

const YAML_FILE = /\.ya?ml$/;

function textOf(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

/** Everything the port reads, from a checkout. */
export function readSources(
  root: string,
  manifest: Manifest = MANIFEST,
): Sources {
  const workflows = new Map<string, string>();
  const workflowDir = join(root, '.github/workflows');
  for (const name of existsSync(workflowDir) ? readdirSync(workflowDir) : []) {
    if (YAML_FILE.test(name))
      workflows.set(name, readFileSync(join(workflowDir, name), 'utf8'));
  }
  const actions = new Map<string, string>();
  const actionDir = join(root, '.github/actions');
  for (const entry of existsSync(actionDir)
    ? readdirSync(actionDir, { withFileTypes: true })
    : []) {
    if (!entry.isDirectory()) continue;
    const text =
      textOf(join(actionDir, entry.name, 'action.yml')) ??
      textOf(join(actionDir, entry.name, 'action.yaml'));
    if (text !== undefined) actions.set(entry.name, text);
  }
  const files = new Map<string, string>();
  for (const script of manifest.scripts) {
    const text = textOf(join(root, script.from));
    if (text !== undefined) files.set(script.from, text);
  }
  return { workflows, actions, files };
}

function countBy<T>(items: readonly T[], key: (item: T) => string): string {
  const counts = new Map<string, number>();
  for (const item of items)
    counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => `${name} ${count}`)
    .join(', ');
}

function problemLine(problem: Problem): string {
  return `${problem.file}${problem.at ? ` ${problem.at}` : ''}: ${problem.message}`;
}

/** What the port did, for a person: one line per workflow, then the checks, then the problems. */
export function describe(generated: Generated): string[] {
  const lines: string[] = ['Workflows'];
  for (const outcome of generated.outcomes) {
    const { plan } = outcome;
    if (plan.kind === 'port') {
      const gone = [...outcome.removed.keys()];
      lines.push(
        `  ${outcome.file}: ported; on ${outcome.events.join(', ') || 'nothing'}; ${outcome.jobs.length} jobs` +
          (gone.length > 0
            ? `, ${gone.length} removed (${gone.join(', ')})`
            : ''),
      );
      const changes = generated.report.changes.filter(
        (change) => change.file === outcome.file,
      );
      if (changes.length > 0)
        lines.push(`    ${countBy(changes, (change) => change.rule)}`);
    } else {
      lines.push(`  ${outcome.file}: ${plan.kind}; ${plan.why}`);
    }
  }
  lines.push('', 'Checks a pull request waits for');
  for (const check of generated.checks) lines.push(`  ${check}`);
  lines.push('', 'Actions the node mirrors');
  for (const [name, refs] of generated.actions)
    lines.push(`  ${name}: ${refs.map((ref) => ref.slice(0, 12)).join(', ')}`);
  if (generated.report.warnings.length > 0) {
    lines.push('', 'Warnings');
    for (const warning of generated.report.warnings)
      lines.push(`  ${warning.file} ${warning.at}: ${warning.detail}`);
  }
  lines.push('', `Problems: ${generated.problems.length}`);
  for (const problem of generated.problems)
    lines.push(`  ${problemLine(problem)}`);
  return lines;
}

export type FileState = 'new' | 'changed' | 'same';

/** Each generated file against the one on disk, and the generated-looking files that no longer come out. */
export function compare(
  root: string,
  generated: Generated,
): { files: Map<string, FileState>; stale: string[] } {
  const files = new Map<string, FileState>();
  for (const [path, text] of generated.files) {
    const current = textOf(join(root, path));
    files.set(
      path,
      current === undefined ? 'new' : current === text ? 'same' : 'changed',
    );
  }
  const stale: string[] = [];
  const walk = (directory: string): void => {
    const absolute = join(root, directory);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (!generated.files.has(path)) stale.push(path);
    }
  };
  for (const directory of GENERATED_DIRS) walk(directory);
  return { files, stale: stale.toSorted() };
}

/**
 * Write the generated files, and remove `stale`: every file of the generator's directories that
 * this run does not produce, whoever made it.
 */
export function writeGenerated(
  out: string,
  generated: Generated,
  stale: readonly string[] = [],
): void {
  for (const [path, text] of generated.files) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), text);
  }
  for (const path of stale) rmSync(join(out, path), { force: true });
}

const CHECKS_HEADER = `# The checks a pull request into main waits for on tale/tale, one per workflow:
# the readiness job of each ported workflow, as Forgejo names its status. The ops
# repository declares them as the checks Forgejo's protection of main requires.
# Generated: bun tools/cli/scripts/forgejo-port.ts checks --write
`;

export function declaredChecksText(checks: readonly string[]): string {
  return CHECKS_HEADER + stringify(checks, { lineWidth: 0 });
}

export function readDeclaredChecks(root: string): string[] | undefined {
  const text = textOf(join(root, DECLARED_CHECKS));
  if (text === undefined) return undefined;
  const value: unknown = parse(text);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Hold the generated files to Forgejo's own runner: `validate` reads every workflow and
 * action against the runner's schema, and `exec --list` plans every workflow (resolves
 * `needs`, expands matrices), so a file that parses and cannot be planned fails here.
 */
export function runnerCheck(runner: string, generated: Generated): Problem[] {
  const problems: Problem[] = [];
  const directory = mkdtempSync(join(tmpdir(), 'forgejo-port-'));
  try {
    writeGenerated(directory, generated);
    const fail = (at: string, message: string): void => {
      problems.push({ file: '.forgejo', at, message });
    };
    for (const [path] of generated.files) {
      const kind = path.startsWith(`${WORKFLOW_DIR}/`)
        ? '--workflow'
        : path.endsWith('/action.yml')
          ? '--action'
          : undefined;
      if (kind === undefined) continue;
      const checked = spawnSync(
        runner,
        ['validate', kind, '--path', join(directory, path)],
        { encoding: 'utf8' },
      );
      if (checked.error) {
        fail(path, checked.error.message);
        return problems;
      }
      if (checked.status !== 0)
        fail(path, `validate: ${checked.stdout}${checked.stderr}`.trim());
    }
    for (const [path] of generated.files) {
      if (!path.startsWith(`${WORKFLOW_DIR}/`)) continue;
      const planned = spawnSync(
        runner,
        ['exec', '--list', '--directory', directory, '--workflows', path],
        { encoding: 'utf8' },
      );
      if (planned.status !== 0)
        fail(path, `exec --list: ${planned.stdout}${planned.stderr}`.trim());
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return problems;
}

/** The warnings of the port that leave a generated file wrong, which `check` fails on. */
const CHECKED_WARNINGS: ReadonlySet<string> = new Set([
  'anchor',
  'local-action-unported',
]);

/**
 * A rule of the port finds the text it changes by what the workflow says. When that text is
 * gone the rule leaves the file as it is and says so as an `anchor` warning, which the unit
 * tests only print: the generated file then keeps what the rule exists to change (a retired
 * page that goes unseen, a publisher that pushes to GitHub). A local action the port does not
 * generate is left as a call to the GitHub copy, which the port itself calls GitHub-only
 * (`local-action-unported`). `check`, the first step of the cut-over, fails on each.
 */
function ruleProblems(generated: Generated): Problem[] {
  return generated.report.warnings
    .filter((warning) => CHECKED_WARNINGS.has(warning.rule))
    .map((warning) => ({
      file: warning.file,
      at: warning.at,
      message: warning.detail,
    }));
}

/**
 * Each external action the generated files use against the README's `Mirrors` row: the node
 * resolves `uses:` at its own mirrors, so an action the README does not list is one nobody was
 * told to mirror.
 */
export function mirrorProblems(root: string, generated: Generated): Problem[] {
  const text = textOf(join(root, README));
  if (text === undefined)
    return [
      { file: README, at: '', message: 'is missing: it lists the mirrors' },
    ];
  const row = /\| Mirrors[^\n]*\n/.exec(text)?.[0] ?? '';
  const named = new Set(
    [...row.matchAll(/`([a-z0-9-]+\/[a-z0-9._-]+)`/g)].map((match) => match[1]),
  );
  return [...generated.actions.keys()]
    .filter((name) => !named.has(name))
    .map((name) => ({
      file: README,
      at: 'Mirrors',
      message: `does not list \`${name}\`, an action the generated workflows use: the node must mirror it`,
    }));
}

export interface Io {
  readonly cwd: string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const OPTIONS = {
  root: { type: 'string' },
  out: { type: 'string' },
  runner: { type: 'string' },
  write: { type: 'boolean' },
  force: { type: 'boolean' },
} as const;

function parseCommandLine(argv: readonly string[]) {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: OPTIONS,
    allowPositionals: true,
  });
  return { values, command: positionals[0] ?? 'report', extra: positionals[1] };
}

/** The command line. Returns the exit code. */
export function main(
  argv: readonly string[],
  io: Io,
  manifest: Manifest = MANIFEST,
): number {
  let parsed: ReturnType<typeof parseCommandLine>;
  try {
    parsed = parseCommandLine(argv);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const { command } = parsed;
  if (parsed.extra !== undefined) {
    io.err(`unexpected argument ${parsed.extra}`);
    return 2;
  }
  const root = resolve(io.cwd, parsed.values.root ?? defaultRoot());
  const generated = generate(readSources(root, manifest), manifest);

  if (command === 'report') {
    for (const line of describe(generated)) io.out(line);
    return 0;
  }

  if (command === 'checks') {
    const text = declaredChecksText(generated.checks);
    if (parsed.values.write) {
      mkdirSync(dirname(join(root, DECLARED_CHECKS)), { recursive: true });
      writeFileSync(join(root, DECLARED_CHECKS), text);
      io.out(`wrote ${DECLARED_CHECKS}`);
    } else io.out(text.trimEnd());
    return 0;
  }

  if (command === 'check') {
    const problems = [
      ...generated.problems,
      ...planGithubEdits(readSources(root, manifest).workflows, manifest)
        .problems,
    ];
    problems.push(...ruleProblems(generated));
    problems.push(...mirrorProblems(root, generated));
    if (parsed.values.runner)
      problems.push(...runnerCheck(parsed.values.runner, generated));
    if (
      textOf(join(root, DECLARED_CHECKS)) !==
      declaredChecksText(generated.checks)
    )
      problems.push({
        file: DECLARED_CHECKS,
        at: '',
        message: `is not what the port generates (the checks are ${generated.checks.join('; ')}); run \`bun tools/cli/scripts/forgejo-port.ts checks --write\``,
      });
    for (const problem of problems) io.err(problemLine(problem));
    io.out(
      problems.length === 0
        ? `ok: ${generated.files.size} files, ${generated.checks.length} checks`
        : `${problems.length} problems`,
    );
    return problems.length === 0 ? 0 : 1;
  }

  if (command === 'generate') {
    if (generated.problems.length > 0) {
      for (const problem of generated.problems) io.err(problemLine(problem));
      io.err('not generating: the port reports problems');
      return 1;
    }
    const out = resolve(io.cwd, parsed.values.out ?? root);
    const { files, stale } = compare(out, generated);
    for (const [path, state] of files) io.out(`${state.padEnd(7)} ${path}`);
    for (const path of stale) io.out(`stale   ${path}`);
    if (parsed.values.write) {
      const changed = [...files].filter(([, state]) => state === 'changed');
      if ((changed.length > 0 || stale.length > 0) && !parsed.values.force) {
        io.err(
          `not writing: ${changed.length} files would be overwritten and ${stale.length} deleted, and the generator did not make them all; read the list above and pass --force to do it`,
        );
        return 1;
      }
      writeGenerated(out, generated, stale);
      io.out(`wrote ${generated.files.size} files to ${out}`);
    } else io.out('dry run: add --write to write them');
    return 0;
  }

  if (command === 'github') {
    const { outcomes, problems } = planGithubEdits(
      readSources(root, manifest).workflows,
      manifest,
    );
    for (const problem of problems) io.err(problemLine(problem));
    if (problems.length > 0) return 1;
    for (const { path, edit, state } of outcomes)
      io.out(`${state.padEnd(7)} ${path}: ${edit.why}`);
    const last = new Map(outcomes.map((outcome) => [outcome.path, outcome]));
    if (parsed.values.write) {
      for (const [path, outcome] of last)
        if (outcome.state === 'pending')
          writeFileSync(join(root, path), outcome.text);
      io.out(
        `wrote ${[...last.values()].filter((o) => o.state === 'pending').length} files`,
      );
    } else io.out('dry run: add --write to write them');
    return 0;
  }

  io.err(`unknown command ${command}`);
  return 2;
}

function defaultRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2), {
    cwd: process.cwd(),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
}
