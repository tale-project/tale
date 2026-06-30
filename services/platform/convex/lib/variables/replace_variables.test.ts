import { describe, expect, it } from 'vitest';

import { replaceVariables } from './replace_variables';

describe('replaceVariables', () => {
  it('renders a mixed-content template with all values present', () => {
    const result = replaceVariables('Hello {{name}}, you are {{age}}', {
      name: 'World',
      age: 30,
    });
    expect(result).toBe('Hello World, you are 30');
  });

  it('preserves type for a single-expression template', () => {
    expect(replaceVariables('{{user.age}}', { user: { age: 25 } })).toBe(25);
  });

  // Regression: a task created with only a title (no description, no labels)
  // used to crash the triage workflow's LLM step with "Unresolved template
  // after rendering". Absent optional fields must render as empty, not throw.
  it('renders absent optional references as empty instead of throwing', () => {
    const input = {
      task: { title: 'How should we get started?' },
    };
    const template =
      'Task title: {{input.task.title}}\n\nDescription:\n{{input.task.description}}\n\nLabels: {{input.task.labels}}';

    const result = replaceVariables(template, { input });

    expect(result).toBe(
      'Task title: How should we get started?\n\nDescription:\n\n\nLabels: ',
    );
    expect(result).not.toContain('{{');
  });

  it('does not re-emit a marker for a nil reference in mixed content', () => {
    const result = replaceVariables('a {{missing}} b', {});
    expect(result).toBe('a  b');
  });

  it('JSON-stringifies a resolved array/object reference in mixed content', () => {
    const result = replaceVariables('Candidates: {{items}}', {
      items: [{ slug: 'coder' }],
    });
    expect(result).toBe('Candidates: [{"slug":"coder"}]');
  });

  // Regression: the issue-desk merge-gate (`judge`) step embeds the reviewer's
  // free-text summary via `{{steps.review.output.data.summary}}`. That summary
  // can legitimately contain a `{{...}}` code snippet — e.g. a JSX/TanStack
  // Router `activeOptions={{exact:true}}` quoted in the review. The old
  // post-render guard misread that *substituted data* as an unresolved template
  // and crashed the step with "Unresolved template after rendering". A resolved
  // value's literal braces must render verbatim, not be treated as a template.
  it('renders a resolved value containing literal {{braces}} verbatim', () => {
    const summary =
      'breadcrumb refactor (`activeOptions={{exact:true}}` suppresses aria-current)';
    const result = replaceVariables(
      'Reviewer summary for issue #{{n}}:\n\n{{review.summary}}\n\nReady?',
      { n: 1994, review: { summary } },
    );
    expect(result).toBe(
      `Reviewer summary for issue #1994:\n\n${summary}\n\nReady?`,
    );
  });

  it('still rejects a malformed template (unclosed tag)', () => {
    // A genuinely broken template is not silently swallowed — Mustache.parse
    // throws on an unclosed tag before any value resolution.
    expect(() => replaceVariables('value {{ok', { ok: 'x' })).toThrow();
  });
});
