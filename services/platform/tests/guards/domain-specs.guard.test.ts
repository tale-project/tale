// @vitest-environment node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * A domain spec (`backend/domains/<domain>/spec.md`) states the rules a
 * domain holds for a reader who has not opened the code, in the one shape
 * `backend/domains/spec-template.md` describes: a prefix shared with the
 * feature's manual suite, topic headings, one card per rule, and Not yet. A
 * spec nobody checks drifts the way any prose does, so this holds every spec
 * to three things:
 *
 * - **The shape.** A rule is a `### <ID> · <the rule>` heading short enough
 *   to be read as one sentence, then an example. Two specs read side by
 *   side, and an ID is one greppable token. A heading states a rule; a
 *   question about the intent belongs under Not yet.
 * - **The tests.** A spec lists no tests. The test that holds a rule says so
 *   in its title (`it('… [TASK-R4]', …)`), and this reads the titles of the
 *   workspace's tests: a rule no running test names fails, and so does a
 *   title that names a rule no spec states. A skipped test holds nothing.
 * - **The links.** The Suite a spec names declares the same prefix. A Docs
 *   page outside this workspace is an input of the `test` task in
 *   `turbo.json`, or an edit to the page alone would replay this verdict.
 *
 * Whether a rule is TRUE is not judged here: that is the job of the test
 * that names it, and of the reviewer of the change that adds or moves it.
 * Whether it reads well is the author's, with the template's conventions.
 */

const PLATFORM_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const REPO_ROOT = path.resolve(PLATFORM_ROOT, '../..');
const PLATFORM_FROM_REPO = 'services/platform';
const DOMAINS = 'backend/domains';

const NOT_YET = 'Not yet';
/** A heading longer than this is a paragraph, not a rule one can read at a glance. */
const TITLE_MAX = 80;

/** The files whose titles are read: vitest suites and Playwright specs. */
const TEST_FILE = /(\.test\.tsx?|\.spec\.ts)$/;
/** Where no test of this workspace lives. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'dist-pwa',
  'storybook-static',
  'playwright-report',
  'test-results',
  'coverage',
  '.turbo',
]);

/** The labelled entry of a card; any other line is its body. */
const EXAMPLE = /^- \*\*Example\*\*:(?: (.*))?$/;

/** What a spec is judged against. */
interface World {
  /** A file's text by its path from `services/platform`, or null when absent. */
  platformText: (file: string) => string | null;
  /** A path from the repository root, outside this workspace: whether it
   * exists, and whether the `test` task hashes it. */
  outsideInput: (file: string) => 'hashed' | 'unhashed' | 'missing';
  /** Whether a running test names the rule in its title. */
  holds: (rule: string) => boolean;
}

interface Example {
  /** 1-based line the example starts on. */
  line: number;
  /** The example's text, its continuation lines joined by one space. */
  text: string;
}

/** The examples of one card: each `- **Example**:` line plus its
 * continuation lines, indented two spaces. */
function cardExamples(lines: string[], start: number, end: number): Example[] {
  const examples: Example[] = [];
  let current: Example | null = null;
  for (let index = start; index < end; index += 1) {
    const line = lines[index] ?? '';
    const match = EXAMPLE.exec(line);
    if (match !== null) {
      current = { line: index + 1, text: match[1] ?? '' };
      examples.push(current);
    } else if (current !== null && /^\s{2,}\S/.test(line)) {
      current.text = `${current.text} ${line.trim()}`.trim();
    } else {
      current = null;
    }
  }
  return examples;
}

/** The target of `**<label>** [text](target)` on the header line. */
function headerLink(header: string, label: string): string | null {
  return (
    new RegExp(`\\*\\*${label}\\*\\* \\[[^\\]]*\\]\\(([^)]+)\\)`).exec(
      header,
    )?.[1] ?? null
  );
}

/** A link in a spec, as a path from the repository root. */
function fromRepoRoot(specFile: string, link: string): string {
  return path.posix.normalize(
    path.posix.join(PLATFORM_FROM_REPO, path.posix.dirname(specFile), link),
  );
}

/** The prefix a spec declares, or null. */
function prefixOf(source: string): string | null {
  return /^> \*\*Prefix\*\* `([A-Z][A-Z0-9]*-)`/m.exec(source)?.[1] ?? null;
}

/** A rule ID of any of these prefixes, wherever it stands in a text. */
function rulePattern(prefixes: string[]): RegExp {
  return new RegExp(`\\b(?:${prefixes.join('|')})R[1-9]\\d*\\b`, 'g');
}

/** The rule IDs a spec states, in order. */
function rulesOf(source: string): string[] {
  const prefix = prefixOf(source);
  if (prefix === null) return [];
  const ruleId = new RegExp(`^${prefix}R[1-9]\\d*$`);
  return [...source.matchAll(/^### (\S+) · /gm)]
    .map((match) => match[1] ?? '')
    .filter((id) => ruleId.test(id));
}

/** Everything wrong with one spec, as `file:line: message`. */
function lintSpec(file: string, source: string, world: World): string[] {
  const problems: string[] = [];
  const report = (line: number, message: string) => {
    problems.push(`${file}:${line}: ${message}`);
  };
  const lines = source.split('\n');

  if (!/^# \S/.test(lines[0] ?? '')) {
    report(
      1,
      'a spec opens with its title: `# <Domain> — <what these rules decide>`',
    );
  }

  const prefix = prefixOf(source);
  if (prefix === null) {
    report(
      1,
      'a spec declares its prefix in a header blockquote: `> **Prefix** `TASK-``',
    );
    return problems;
  }
  const headerIndex = lines.findIndex((line) =>
    line.startsWith('> **Prefix**'),
  );
  const header = lines[headerIndex] ?? '';

  const suite = headerLink(header, 'Suite');
  if (suite !== null) {
    const target = fromRepoRoot(file, suite);
    const inSuites = `${PLATFORM_FROM_REPO}/tests/manual/suites/`;
    const text = target.startsWith(inSuites)
      ? world.platformText(target.slice(PLATFORM_FROM_REPO.length + 1))
      : null;
    if (text === null) {
      report(
        headerIndex + 1,
        `the Suite link names no file under tests/manual/suites/: ${suite}`,
      );
    } else if (
      !(/^>\s*\*\*Prefix\*\*((?:\s*`[^`]+`)+)/m.exec(text)?.[1] ?? '').includes(
        `\`${prefix}\``,
      )
    ) {
      report(
        headerIndex + 1,
        `the Suite it links does not declare the prefix ${prefix}: a spec takes the prefix of the suite that covers the same feature`,
      );
    }
  }

  const docs = headerLink(header, 'Docs');
  if (docs !== null) {
    const target = fromRepoRoot(file, docs);
    if (target.startsWith('../')) {
      report(headerIndex + 1, `the Docs link leaves the repository: ${docs}`);
    } else if (target.startsWith(`${PLATFORM_FROM_REPO}/`)) {
      if (
        world.platformText(target.slice(PLATFORM_FROM_REPO.length + 1)) === null
      ) {
        report(headerIndex + 1, `the Docs link names no file: ${docs}`);
      }
    } else {
      const state = world.outsideInput(target);
      if (state === 'missing') {
        report(headerIndex + 1, `the Docs link names no file: ${target}`);
      } else if (state === 'unhashed') {
        report(
          headerIndex + 1,
          `${target} is outside this workspace and no input of the \`test\` task: add \`$TURBO_ROOT$/${target}\` to its inputs in services/platform/turbo.json (and to OUTSIDE_READS in turbo-inputs.guard.test.ts), or an edit to the page replays this verdict`,
        );
      }
    }
  }

  const sections = lines.flatMap((line, index) =>
    line.startsWith('## ') ? [{ title: line.slice(3).trim(), index }] : [],
  );
  const notYet = sections.at(-1);
  if (notYet === undefined || notYet.title !== NOT_YET) {
    report(
      (notYet?.index ?? 0) + 1,
      `a spec ends with \`## ${NOT_YET}\`: what it leaves out, and the known debt against a rule`,
    );
    return problems;
  }
  if (lines.slice(notYet.index + 1).every((line) => line.trim() === '')) {
    report(
      notYet.index + 1,
      `${NOT_YET} says what the spec leaves out; a spec that covers its whole domain says so there`,
    );
  }
  if (sections.length < 2) {
    report(
      notYet.index + 1,
      `a spec groups its rules under topic headings a reader would look up (\`## Who can do what\`), before ${NOT_YET}`,
    );
  }
  const firstTopic = sections[0]?.index ?? 0;

  const headings = lines.flatMap((line, index) =>
    line.startsWith('### ') ? [index] : [],
  );
  if (headings.length === 0) {
    report(1, 'a spec states at least one rule: `### <ID> · <the rule>`');
  }
  const boundaries = [
    ...headings,
    ...sections.map(({ index }) => index),
    lines.length,
  ];

  const ruleId = new RegExp(`^${prefix}R[1-9]\\d*$`);
  const stated = new Set<string>();
  for (const index of headings) {
    const line = index + 1;
    if (sections.length < 2 || index < firstTopic || index > notYet.index) {
      report(line, `a rule sits under a topic heading, before ${NOT_YET}`);
      continue;
    }
    const match = /^### (\S+) · (.+)$/.exec(lines[index] ?? '');
    if (match === null) {
      report(
        line,
        'a rule heading reads: ### <ID> · <the rule as one plain sentence>',
      );
      continue;
    }
    const [, id = '', title = ''] = match;
    if (!ruleId.test(id)) {
      report(line, `a rule ID reads ${prefix}R<n>: ${id}`);
      continue;
    }
    if (stated.has(id)) {
      report(
        line,
        `${id} is stated twice: IDs are unique and appended, never reused`,
      );
      continue;
    }
    stated.add(id);
    if (title.length > TITLE_MAX) {
      report(
        line,
        `${id}: the heading is the rule as one plain sentence of at most ${TITLE_MAX} characters, and this one has ${title.length}: keep who can do what, move the rest to the body`,
      );
    }
    if (title.endsWith('?')) {
      report(
        line,
        `${id}: a heading states a rule; a question about the intent goes under ${NOT_YET}, with each reading and where it comes from`,
      );
    }

    const end = Math.min(...boundaries.filter((boundary) => boundary > index));
    const examples = cardExamples(lines, index + 1, end);
    if (examples.length === 0) {
      report(
        line,
        `${id} has no example: add - **Example**: <a named person, a situation, one action> → <what happens>`,
      );
    }
    for (const example of examples) {
      if (!example.text.includes('→')) {
        report(
          example.line,
          `${id}: an example reads <a named person, a situation, one action> → <what happens>`,
        );
      }
    }
    if (!world.holds(id)) {
      report(
        line,
        `${id} is held by no test: name it in the title of the test that holds it, as in it('… [${id}]', …), or move it to ${NOT_YET} until a test holds it`,
      );
    }
  }

  return problems;
}

const RUNNERS = new Set(['it', 'test', 'describe']);
/** What may follow a runner and still run the test: `it.each(…)`,
 * Playwright's `test.describe(…)`. A `skip`, a `todo` or a condition does
 * not, and neither does anything inside one. */
const RUNNING = new Set([
  'each',
  'for',
  'concurrent',
  'sequential',
  'only',
  'describe',
  'serial',
  'parallel',
]);

/** The names a callee spells: `it`, `it.each`, `describe.skip`. */
function calleeNames(expression: ts.Expression): string[] | null {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    const head = calleeNames(expression.expression);
    return head === null ? null : [...head, expression.name.text];
  }
  if (ts.isCallExpression(expression))
    return calleeNames(expression.expression);
  if (ts.isTaggedTemplateExpression(expression)) {
    return calleeNames(expression.tag);
  }
  return null;
}

interface Reference {
  rule: string;
  file: string;
  line: number;
}

/**
 * The rules a file's tests name in their titles: the first argument of an
 * `it`, a `test` or a `describe` that runs. A rule named in a comment, in a
 * test's body or in a skipped test is no reference.
 */
function titleReferences(
  file: string,
  source: string,
  rule: RegExp,
): Reference[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Reference[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const names = calleeNames(node.expression);
      if (names !== null && RUNNERS.has(names[0] ?? '')) {
        if (!names.slice(1).every((name) => RUNNING.has(name))) return;
        const title = node.arguments[0];
        if (
          title !== undefined &&
          (ts.isStringLiteralLike(title) || ts.isTemplateExpression(title))
        ) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            title.getStart(sourceFile),
          );
          for (const match of title.getText(sourceFile).matchAll(rule)) {
            found.push({ rule: match[0], file, line: line + 1 });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function isFile(absolute: string): boolean {
  return statSync(absolute, { throwIfNoEntry: false })?.isFile() ?? false;
}

function read(file: string): string {
  return readFileSync(path.join(PLATFORM_ROOT, file), 'utf8');
}

/** Every spec in the tree, as a path from `services/platform`. */
function specFiles(): string[] {
  return readdirSync(path.join(PLATFORM_ROOT, DOMAINS), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${DOMAINS}/${entry.name}/spec.md`)
    .filter((file) => isFile(path.join(PLATFORM_ROOT, file)));
}

/** Every test file of this workspace, as a path from `services/platform`. */
function testFiles(directory = PLATFORM_ROOT): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : testFiles(full);
    }
    return TEST_FILE.test(entry.name)
      ? [path.relative(PLATFORM_ROOT, full)]
      : [];
  });
}

/** The slice of `services/platform/turbo.json` this guard reads. */
const turboJsonSchema = z.object({
  tasks: z.object({ test: z.object({ inputs: z.array(z.string()) }) }),
});

/** The `$TURBO_ROOT$` inputs of the `test` task, as path patterns. */
function testInputPatterns(): RegExp[] {
  const { tasks } = turboJsonSchema.parse(JSON.parse(read('turbo.json')));
  return tasks.test.inputs
    .filter((input) => input.startsWith('$TURBO_ROOT$/'))
    .map((input) => {
      const pattern = input
        .slice('$TURBO_ROOT$/'.length)
        .split('**')
        .map((part) =>
          part
            .split('*')
            .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
            .join('[^/]*'),
        )
        .join('.*');
      return new RegExp(`^${pattern}$`);
    });
}

const TEST_INPUTS = testInputPatterns();

const SPECS = specFiles().map((file) => ({ file, source: read(file) }));
const PREFIXES = SPECS.flatMap(({ source }) => prefixOf(source) ?? []);

/** Every rule a running test of this workspace names in its title. */
const REFERENCES =
  PREFIXES.length === 0
    ? []
    : testFiles().flatMap((file) => {
        const source = read(file);
        return rulePattern(PREFIXES).test(source)
          ? titleReferences(file, source, rulePattern(PREFIXES))
          : [];
      });
const HELD = new Set(REFERENCES.map(({ rule }) => rule));

const tree: World = {
  platformText: (file) =>
    isFile(path.join(PLATFORM_ROOT, file)) ? read(file) : null,
  outsideInput: (file) => {
    if (!isFile(path.join(REPO_ROOT, file))) return 'missing';
    return TEST_INPUTS.some((pattern) => pattern.test(file))
      ? 'hashed'
      : 'unhashed';
  },
  holds: (rule) => HELD.has(rule),
};

describe('the domain specs in the tree', () => {
  it('include the tasks spec, so the scan reads something', () => {
    expect(SPECS.map(({ file }) => file)).toContain(
      'backend/domains/tasks/spec.md',
    );
  });

  it('keep the shape, link what exists, and state only rules a test holds', () => {
    expect(
      SPECS.flatMap(({ file, source }) => lintSpec(file, source, tree)),
    ).toEqual([]);
  });

  it('are the only source of the rules a test title names', () => {
    const stated = new Set(SPECS.flatMap(({ source }) => rulesOf(source)));
    expect(
      REFERENCES.filter(({ rule }) => !stated.has(rule)).map(
        ({ rule, file, line }) =>
          `${file}:${line}: the title names ${rule}, which no spec states: the rule was removed or renumbered, so name the rule this test holds now, or drop the tag`,
      ),
    ).toEqual([]);
  });

  it('each take a prefix no other spec uses', () => {
    const owners = new Map<string, string[]>();
    for (const { file, source } of SPECS) {
      const prefix = prefixOf(source);
      if (prefix !== null) {
        owners.set(prefix, [...(owners.get(prefix) ?? []), file]);
      }
    }
    expect([...owners].filter(([, files]) => files.length > 1)).toEqual([]);
  });
});

describe('the spec grammar', () => {
  const FILE = 'backend/domains/probe/spec.md';
  const SUITE = 'tests/manual/suites/probe.md';
  const world: World = {
    platformText: (file) =>
      file === SUITE
        ? '# Probe\n\n> **Prefix** `PROBE-` · **Reset** none\n'
        : null,
    outsideInput: (file) => {
      if (file === 'docs/en/platform/probe.md') return 'hashed';
      return file === 'docs/en/platform/unlisted.md' ? 'unhashed' : 'missing';
    },
    holds: (rule) => rule === 'PROBE-R1' || rule === 'PROBE-R2',
  };

  const R2 = '### PROBE-R2 · A member is never refused';
  const VALID = [
    '# Probe — who may probe',
    '',
    '> **Prefix** `PROBE-` · **Suite** [`probe`](../../../tests/manual/suites/probe.md) · **Docs** [`probe`](../../../../../docs/en/platform/probe.md)',
    '',
    'What the rules cover.',
    '',
    '## Who can probe',
    '',
    '| | Probe |',
    '| --- | --- |',
    '| A member | yes |',
    '',
    '### PROBE-R1 · Only members can probe',
    '',
    'Anyone else is refused (`NOPE`) and nothing is saved.',
    '',
    '- **Example**: Mia is not a member. She probes → refused,',
    '  and nothing is saved.',
    '',
    R2,
    '',
    '- **Example**: Noah is a member. He probes → accepted.',
    '',
    '## Not yet',
    '',
    '- **Undecided: may a guest probe?** The docs say yes, the code says no.',
    '',
  ].join('\n');
  const R2_LINE = VALID.split('\n').indexOf(R2) + 1;

  /** The problems of the valid spec after one replacement, file and line cut. */
  const problemsAfter = (from: string, to: string): string[] => {
    expect(VALID).toContain(from);
    return lintSpec(FILE, VALID.replace(from, to), world).map((problem) =>
      problem.replace(/^[^ ]+ /, ''),
    );
  };

  it('accepts the shape the template describes', () => {
    expect(lintSpec(FILE, VALID, world)).toEqual([]);
  });

  it('reports a problem at its file and line', () => {
    expect(
      lintSpec(FILE, VALID.replace('He probes → accepted.', 'He probes.'), {
        ...world,
        holds: (rule) => rule === 'PROBE-R1',
      }),
    ).toEqual([
      `${FILE}:${R2_LINE + 2}: PROBE-R2: an example reads <a named person, a situation, one action> → <what happens>`,
      `${FILE}:${R2_LINE}: PROBE-R2 is held by no test: name it in the title of the test that holds it, as in it('… [PROBE-R2]', …), or move it to Not yet until a test holds it`,
    ]);
  });

  it('refuses a spec without a prefix, a topic, or Not yet', () => {
    expect(problemsAfter('> **Prefix** `PROBE-` · ', '> ')).toEqual([
      'a spec declares its prefix in a header blockquote: `> **Prefix** `TASK-``',
    ]);
    expect(problemsAfter('## Not yet', '## Later')).toEqual([
      'a spec ends with `## Not yet`: what it leaves out, and the known debt against a rule',
    ]);
    expect(
      problemsAfter(
        '- **Undecided: may a guest probe?** The docs say yes, the code says no.\n',
        '',
      ),
    ).toEqual([
      'Not yet says what the spec leaves out; a spec that covers its whole domain says so there',
    ]);
    expect(problemsAfter('## Who can probe', 'Who can probe')).toContain(
      'a spec groups its rules under topic headings a reader would look up (`## Who can do what`), before Not yet',
    );
  });

  it('holds a rule heading to its ID and to one short sentence', () => {
    expect(problemsAfter('### PROBE-R2 ·', '### PROBE-F2 ·')).toEqual([
      'a rule ID reads PROBE-R<n>: PROBE-F2',
    ]);
    expect(problemsAfter('### PROBE-R2 ·', '### PROBE-R1 ·')).toEqual([
      'PROBE-R1 is stated twice: IDs are unique and appended, never reused',
    ]);
    expect(problemsAfter('### PROBE-R2 · A member', '### A member')).toEqual([
      'a rule heading reads: ### <ID> · <the rule as one plain sentence>',
    ]);
    expect(
      problemsAfter(
        'A member is never refused',
        'A member is never refused, whatever they probe, however often, and from wherever they do it',
      ),
    ).toEqual([
      'PROBE-R2: the heading is the rule as one plain sentence of at most 80 characters, and this one has 91: keep who can do what, move the rest to the body',
    ]);
  });

  it('sends a question about the intent to Not yet', () => {
    expect(
      problemsAfter('A member is never refused', 'Is a member ever refused?'),
    ).toEqual([
      'PROBE-R2: a heading states a rule; a question about the intent goes under Not yet, with each reading and where it comes from',
    ]);
  });

  it('wants an example of every rule', () => {
    expect(
      problemsAfter(
        '- **Example**: Noah is a member. He probes → accepted.\n',
        '',
      ),
    ).toEqual([
      'PROBE-R2 has no example: add - **Example**: <a named person, a situation, one action> → <what happens>',
    ]);
  });

  it('wants a test to hold every rule', () => {
    expect(
      lintSpec(FILE, VALID, { ...world, holds: () => false }).map((problem) =>
        problem.replace(/^[^ ]+ /, '').replace(/:.*/, ''),
      ),
    ).toEqual(['PROBE-R1 is held by no test', 'PROBE-R2 is held by no test']);
  });

  it('holds the Suite to the same prefix and the Docs page to a hashed file', () => {
    expect(problemsAfter('**Prefix** `PROBE-`', '**Prefix** `PRB-`')[0]).toBe(
      'the Suite it links does not declare the prefix PRB-: a spec takes the prefix of the suite that covers the same feature',
    );
    expect(problemsAfter('suites/probe.md', 'suites/gone.md')).toEqual([
      'the Suite link names no file under tests/manual/suites/: ../../../tests/manual/suites/gone.md',
    ]);
    expect(problemsAfter('platform/probe.md', 'platform/gone.md')).toEqual([
      'the Docs link names no file: docs/en/platform/gone.md',
    ]);
    expect(problemsAfter('platform/probe.md', 'platform/unlisted.md')).toEqual([
      'docs/en/platform/unlisted.md is outside this workspace and no input of the `test` task: add `$TURBO_ROOT$/docs/en/platform/unlisted.md` to its inputs in services/platform/turbo.json (and to OUTSIDE_READS in turbo-inputs.guard.test.ts), or an edit to the page replays this verdict',
    ]);
  });

  it('reads the turbo inputs as path patterns', () => {
    // One page listed by name, in every locale.
    expect(tree.outsideInput('docs/de/platform/projects/tasks.md')).toBe(
      'hashed',
    );
    // Every English page, at any depth: the pages a spec links as its Docs.
    expect(tree.outsideInput('docs/en/platform/models.md')).toBe('hashed');
    expect(tree.outsideInput('docs/en/platform/projects/overview.md')).toBe(
      'hashed',
    );
    expect(tree.outsideInput('docs/de/platform/projects/overview.md')).toBe(
      'unhashed',
    );
  });
});

describe('the rules a test names', () => {
  const named = (source: string): string[] =>
    titleReferences('probe.test.ts', source, rulePattern(['PROBE-'])).map(
      ({ rule, line }) => `${rule}@${line}`,
    );

  it('are read from the title of a test or a describe that runs', () => {
    expect(named("it('refuses a stranger [PROBE-R1]', () => {});")).toEqual([
      'PROBE-R1@1',
    ]);
    expect(
      named("describe('strangers [PROBE-R1] [PROBE-R2]', () => {});"),
    ).toEqual(['PROBE-R1@1', 'PROBE-R2@1']);
    expect(named("it.each([1, 2])('probe %s [PROBE-R1]', () => {});")).toEqual([
      'PROBE-R1@1',
    ]);
    expect(named("test.describe('probing [PROBE-R1]', () => {});")).toEqual([
      'PROBE-R1@1',
    ]);
    expect(named('it(\n  `probe ${n} [PROBE-R1]`,\n  () => {},\n);')).toEqual([
      'PROBE-R1@2',
    ]);
  });

  it('are not read from a skipped test, a comment or a test body', () => {
    expect(
      named("it.skip('refuses a stranger [PROBE-R1]', () => {});"),
    ).toEqual([]);
    expect(named("it.todo('refuses a stranger [PROBE-R1]');")).toEqual([]);
    expect(
      named("describe.skip('x', () => { it('y [PROBE-R1]', () => {}); });"),
    ).toEqual([]);
    expect(
      named("it.skipIf(true)('refuses a stranger [PROBE-R1]', () => {});"),
    ).toEqual([]);
    expect(
      named("// PROBE-R1\nit('refuses', () => { const note = 'PROBE-R1'; });"),
    ).toEqual([]);
    expect(named("it('refuses a stranger [OTHER-R1]', () => {});")).toEqual([]);
  });
});
