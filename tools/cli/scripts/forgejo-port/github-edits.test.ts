import { describe, expect, test } from 'bun:test';

import { planGithubEdits } from './github-edits';
import type { GithubEdit } from './manifest';

const edit = (find: string, replace: string): GithubEdit => ({
  file: 'a.yml',
  find,
  replace,
  why: 'a reason',
});

describe('planGithubEdits', () => {
  test('plans an edit once, and says when it is made', () => {
    const workflows = new Map([['a.yml', 'one\ntwo\n']]);
    const manifest = { githubEdits: [edit('two\n', 'two\nthree\n')] };
    const first = planGithubEdits(workflows, manifest);
    expect(first.problems).toEqual([]);
    expect(first.outcomes[0]?.state).toBe('pending');
    expect(first.outcomes[0]?.text).toBe('one\ntwo\nthree\n');
    const second = planGithubEdits(
      new Map([['a.yml', first.outcomes[0]?.text ?? '']]),
      manifest,
    );
    expect(second.outcomes[0]?.state).toBe('applied');
    expect(second.outcomes[0]?.text).toBe('one\ntwo\nthree\n');
  });

  test('applies the edits of one file one after the other', () => {
    const workflows = new Map([['a.yml', 'a\nb\n']]);
    const { outcomes } = planGithubEdits(workflows, {
      githubEdits: [edit('a\n', 'A\n'), edit('b\n', 'B\n')],
    });
    expect(outcomes.map((outcome) => outcome.text)).toEqual([
      'A\nb\n',
      'A\nB\n',
    ]);
  });

  test('refuses an anchor that is gone, one that is ambiguous and a file that is not there', () => {
    const manifest = { githubEdits: [edit('x\n', 'y\n')] };
    const gone = planGithubEdits(new Map([['a.yml', 'a\n']]), manifest);
    expect(gone.problems[0]?.message).toContain('nowhere');
    const twice = planGithubEdits(new Map([['a.yml', 'x\nx\n']]), manifest);
    expect(twice.problems[0]?.message).toContain('2 times');
    const missing = planGithubEdits(new Map(), manifest);
    expect(missing.problems[0]?.message).toBe('does not exist');
    expect(gone.outcomes).toEqual([]);
  });

  test('writes the replacement as it is, whatever characters it holds', () => {
    const { outcomes } = planGithubEdits(new Map([['a.yml', 'x\n']]), {
      githubEdits: [edit('x\n', '$& $1 ${{ vars.A }}\n')],
    });
    expect(outcomes[0]?.text).toBe('$& $1 ${{ vars.A }}\n');
  });
});
