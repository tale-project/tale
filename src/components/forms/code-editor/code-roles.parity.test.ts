import { highlightTree } from '@lezer/highlight';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  codeRoleOfColor,
  type CodeLanguage,
  type CodeRole,
} from '../../../lib/code-roles';
import { highlightCode, shikiLanguageFor } from '../../../markdown/shiki';
import { codeRoleHighlighter } from './extensions/highlight';
import { codeLanguage, templatesOn } from './extensions/languages';
import { memberObjectRanges } from './extensions/member-objects';

/**
 * The editor and the read-only blocks must colour the same text the same
 * way: a value should not change colour when a reader switches from the
 * Source view to the field that edits it. This test highlights fixtures with
 * both — CodeMirror's Lezer grammars through the editor's role table, Shiki's
 * TextMate grammars through the css-variables theme — and compares the role
 * of every visible character.
 *
 * The grammars differ in granularity in a few known places; each is listed
 * in `ALLOWED` with the reason. The list may only shrink: a new difference
 * fails here, and is fixed in the role table or the editor's style tags
 * (`extensions/language-styles.ts`) unless it is one more instance of a
 * listed grammar gap.
 */

interface Fixture {
  name: string;
  language: CodeLanguage;
  templates?: boolean;
  text: string;
}

const FIXTURES: Fixture[] = [
  {
    name: 'a transform body',
    language: 'javascript',
    text: [
      '// Count the open issues per label.',
      'const counts = {};',
      'for (const issue of input.issues) {',
      '  const label = issue.labels[0] ?? "none";',
      '  counts[label] = (counts[label] ?? 0) + 1;',
      '}',
      'const top = input.items.filter((item) => item.score > 5).length;',
      'return { counts, total: nodes.score.output.total, ok: true };',
    ].join('\n'),
  },
  {
    name: 'a condition',
    language: 'expression',
    text: 'nodes.score.output.total > 1000 && input.mode === "fast"',
  },
  {
    name: 'a connector input with templates',
    language: 'json',
    templates: true,
    text: [
      '{',
      '  "to": "{{ input.email }}",',
      '  "subject": "Report for {{ nodes.triage.output.name }}",',
      '  "limit": 25,',
      '  "draft": false',
      '}',
    ].join('\n'),
  },
  {
    name: 'an automation in YAML',
    language: 'yaml',
    templates: true,
    text: [
      'name: Triage GitHub issues',
      'nodes:',
      '  - id: open_issues',
      '    type: transform',
      '    forEach: "{{ nodes.issues.output.issues }}"',
      '    prompt: Score {{ item.title }} for urgency',
      '    code: |',
      '      return input.items.length;',
    ].join('\n'),
  },
  {
    name: 'a prompt in Markdown with templates',
    language: 'markdown',
    templates: true,
    text: [
      '# Daily report',
      '',
      'Summarise **{{ nodes.report.output.count }}** issues for',
      '{{ input.owner }}. Keep it *short*.',
    ].join('\n'),
  },
  {
    name: 'a template holding the closer in a string',
    language: 'template',
    text: 'Reply {{ "}}" }} to them',
  },
  {
    name: 'a template holding an object literal',
    language: 'template',
    text: 'Pass {{ ({ a: { b: 1 } }) }} on',
  },
];

/**
 * Known differences: a fixture, the exact text of the token, and the two
 * roles. Every entry names its reason.
 */
const ALLOWED: ReadonlyArray<{
  token: string;
  editor: CodeRole;
  readOnly: CodeRole;
  reason: string;
}> = [
  {
    token: 'length',
    editor: 'foreground',
    readOnly: 'constant',
    reason:
      "TextMate knows JavaScript's built-in properties (`support.variable.property`); Lezer sees a property name like any other",
  },
  {
    token: '.',
    editor: 'foreground',
    readOnly: 'function',
    reason:
      'TextMate scopes the whole callee of a method call as `meta.function-call`, the dots of `input.items.filter(` included',
  },
];

type RoleRun = Array<CodeRole | null>;

/** The editor's role of every character (`null` for whitespace). */
function editorRoles(fixture: Fixture): RoleRun {
  const language = codeLanguage(
    fixture.language,
    templatesOn(fixture.language, fixture.templates ?? false),
  );
  // One entry per UTF-16 unit, the offsets the syntax tree uses.
  const roles: RoleRun = fixture.text
    .split('')
    .map((c) => (/\s/.test(c) ? null : 'foreground'));
  if (language === null) return roles;
  const tree = language.parser.parse(fixture.text);
  highlightTree(tree, codeRoleHighlighter, (from, to, classes) => {
    const role = classes.split(' ').at(-1)?.replace('role-', '') as CodeRole;
    for (let i = from; i < to; i++) {
      if (roles[i] !== null) roles[i] = role;
    }
  });
  // The editor marks the object of each dot access from the tree.
  for (const [from, to] of memberObjectRanges(tree)) {
    for (let i = from; i < to; i++) roles[i] = 'constant';
  }
  return roles;
}

/** Shiki's role of every character, read from its HTML. */
async function readOnlyRoles(fixture: Fixture): Promise<RoleRun> {
  const result = await highlightCode(
    fixture.text,
    shikiLanguageFor(fixture.language, fixture.templates ?? false),
  );
  if (result === null) throw new Error(`no highlight for ${fixture.name}`);
  const doc = new DOMParser().parseFromString(result.html, 'text/html');
  const roles: RoleRun = [];
  const lines = doc.querySelectorAll('.line');
  lines.forEach((line, index) => {
    if (index > 0) roles.push(null);
    for (const span of line.querySelectorAll<HTMLElement>(':scope > span')) {
      const role = codeRoleOfColor(span.style.color) ?? 'foreground';
      for (const c of span.textContent ?? '') {
        roles.push(/\s/.test(c) ? null : role);
      }
    }
  });
  return roles;
}

interface Difference {
  token: string;
  editor: CodeRole;
  readOnly: CodeRole;
}

/** Runs of differing characters, as the token text they cover. */
function differences(
  text: string,
  editor: RoleRun,
  readOnly: RoleRun,
): Difference[] {
  const out: Difference[] = [];
  let i = 0;
  while (i < text.length) {
    const a = editor[i];
    const b = readOnly[i];
    if (a === null || b === null || a === b) {
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && editor[j] === a && readOnly[j] === b) j++;
    out.push({ token: text.slice(i, j), editor: a, readOnly: b });
    i = j;
  }
  return out;
}

describe('editor and read-only colours agree', () => {
  // Shiki stops tokenizing a line after 500 ms and leaves its rest plain.
  // The first highlight in a language compiles its grammar's patterns, which
  // on a loaded machine can take that long, so each grammar is warmed on a
  // copy of its fixture (another cache key) before the fixtures are compared.
  beforeAll(async () => {
    for (const fixture of FIXTURES) {
      await highlightCode(
        `${fixture.text}\n`,
        shikiLanguageFor(fixture.language, fixture.templates ?? false),
      );
    }
  }, 120_000);

  it.each(FIXTURES)('$name', async (fixture) => {
    const editor = editorRoles(fixture);
    const readOnly = await readOnlyRoles(fixture);
    expect(readOnly).toHaveLength(fixture.text.length);
    const unexplained = differences(fixture.text, editor, readOnly).filter(
      (difference) =>
        !ALLOWED.some(
          (allowed) =>
            allowed.token === difference.token &&
            allowed.editor === difference.editor &&
            allowed.readOnly === difference.readOnly,
        ),
    );
    expect(unexplained).toEqual([]);
  });

  it('lists no difference that no fixture shows any more', async () => {
    const seen: Difference[] = [];
    for (const fixture of FIXTURES) {
      seen.push(
        ...differences(
          fixture.text,
          editorRoles(fixture),
          await readOnlyRoles(fixture),
        ),
      );
    }
    const stale = ALLOWED.filter(
      (allowed) =>
        !seen.some(
          (difference) =>
            difference.token === allowed.token &&
            difference.editor === allowed.editor &&
            difference.readOnly === allowed.readOnly,
        ),
    );
    expect(stale.map((allowed) => allowed.token)).toEqual([]);
  });
});
