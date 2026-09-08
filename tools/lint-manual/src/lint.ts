import { collect } from './collect';
import type { Finding, Repo } from './model';
/**
 * The gate: collect the checkout's manual layer, run every rule over it, print
 * what a reader can act on, and answer with an exit code.
 *
 * A repo with no manual layer at all is not a failure — a repo acquires one
 * when it acquires a service. A manual layer that is half a layer is.
 */
import { RULES } from './rules';

export interface LintOptions {
  /** Absolute path of the checkout to lint. */
  root: string;
  log: (line: string) => void;
  error: (line: string) => void;
  /** Injectable for tests; defaults to walking `root`. */
  read?: (root: string) => Repo;
}

function format(finding: Finding): string {
  const at = finding.line === undefined ? '' : `:${finding.line}`;
  return `  ${finding.file}${at} — ${finding.message}`;
}

export function lint(options: LintOptions): number {
  const repo = (options.read ?? collect)(options.root);

  if (repo.roots.length === 0) {
    options.log('lint:manual — no tests/manual tree in this checkout');
    return 0;
  }

  let failed = 0;
  for (const { name, rule } of RULES) {
    const findings = rule(repo);
    if (findings.length === 0) {
      options.log(`ok    ${name}`);
      continue;
    }
    failed += findings.length;
    options.error(`FAIL  ${name} (${findings.length})`);
    for (const finding of findings) options.error(format(finding));
  }

  const trees = repo.roots.map((root) => root.path).join(', ');
  const boxes = repo.roots.reduce(
    (total, root) =>
      total + root.suites.reduce((n, suite) => n + suite.boxes.length, 0),
    0,
  );
  options.log(`      ${repo.roots.length} tree(s), ${boxes} boxes: ${trees}`);
  return failed === 0 ? 0 : 1;
}
