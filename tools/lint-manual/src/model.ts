/**
 * The model of a repository's manual-test layer.
 *
 * Every rule is a pure function over this shape, so a rule can be tested
 * against a literal instead of a directory tree, and `collect.ts` stays the one
 * module that touches disk.
 */

/** One tickable box: the unit a round runs, cites and diffs. */
export interface Box {
  /** The stable ID, e.g. `SMOKE-4` — unique across the whole manual root. */
  id: string;
  /** 1-based line in its suite, for a finding a reader can jump to. */
  line: number;
  /** True when the committed file carries a tick — always a defect. */
  ticked: boolean;
  /** Everything after `· `, continuation lines folded in — the grammar's
   * bold action and the judgment after the `→`. */
  body: string;
}

/** One suite file: the tests, evergreen and re-runnable. */
export interface Suite {
  /** File name inside `suites/`, e.g. `smoke.md`. */
  name: string;
  /** Path relative to the repo root, for findings. */
  path: string;
  /** The ID prefixes the header blockquote declares. */
  prefixes: string[];
  /** The line the prefix declaration sits on, or 0 when there is none. */
  prefixLine: number;
  boxes: Box[];
  /** Every ATX heading, so a rule can reject a findings table in a suite. */
  headings: string[];
  /** Lines that look like a box but do not parse, with their line numbers. */
  malformed: { line: number; text: string }[];
}

/** A markdown file the gate reads but does not parse into boxes. */
export interface Doc {
  /** Name inside its directory, e.g. `pins.md`. */
  name: string;
  /** Path relative to the repo root. */
  path: string;
  text: string;
}

/** One `tests/manual/` tree — one per deployable unit. */
export interface ManualRoot {
  /** Path relative to the repo root, e.g. `services/app/tests/manual`. */
  path: string;
  /** Names directly under the root (files and directories). */
  entries: string[];
  /** The guide; absent when the root has no `readme.md`. */
  readme?: Doc;
  suites: Suite[];
  /** Names present under `reference/`. */
  referenceEntries: string[];
  reference: Doc[];
  /** Names present under `runs/`. */
  runEntries: string[];
  /** The journal; absent when `runs/readme.md` is missing. */
  journal?: Doc;
}

export interface Repo {
  roots: ManualRoot[];
}

/** One thing a rule found wrong. */
export interface Finding {
  /** Repo-relative path of the file the finding is in. */
  file: string;
  /** 1-based line, when the rule can point at one. */
  line?: number;
  message: string;
}

export type Rule = (repo: Repo) => Finding[];
