import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TASK_ACTIVITY_FIELD, TASK_ACTIVITY_LABEL_KEY } from './display';

/**
 * Guardrail: every action a task writer records has a label, and every one it
 * records with a value says how the history reads that value. Without it, a
 * new action would render its raw name, and its values as text — a status or
 * a person's id shown as a code.
 *
 * A pure source walk of `backend/domains/tasks`: each `recordActivity` call
 * (with a literal `action`, or the per-field `EDIT_ACTIVITY_ACTION` map
 * `updateTask` loops over) and each `INSERT INTO app.task_activity` statement.
 */
const TASKS_DOMAIN = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../backend/domains/tasks',
);

function writerSources(): string[] {
  return readdirSync(TASKS_DOMAIN)
    .filter(
      (file) => file.endsWith('.ts') && !/\.(test|integration)\.ts$/.test(file),
    )
    .map((file) => readFileSync(join(TASKS_DOMAIN, file), 'utf8'));
}

/** Every recorded action, and whether a writer stores a value with it. */
function recordedActions(): Map<string, { withValue: boolean }> {
  const actions = new Map<string, { withValue: boolean }>();
  const note = (action: string, withValue: boolean) => {
    const seen = actions.get(action);
    actions.set(action, { withValue: withValue || seen?.withValue === true });
  };
  for (const source of writerSources()) {
    for (const call of source.matchAll(
      /recordActivity\(\s*tx,\s*\{([\s\S]*?)\}\);/g,
    )) {
      const body = call[1] ?? '';
      const action = /action:\s*'([^']+)'/.exec(body)?.[1];
      if (action) note(action, /\b(fromValue|toValue)\b/.test(body));
    }
    const perField = /const EDIT_ACTIVITY_ACTION[^=]*=\s*\{([\s\S]*?)\};/.exec(
      source,
    );
    for (const entry of (perField?.[1] ?? '').matchAll(/:\s*'([^']+)'/g)) {
      if (entry[1]) note(entry[1], true);
    }
    for (const insert of source.matchAll(
      /INSERT INTO app\.task_activity \(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*`/g,
    )) {
      const columns = insert[1] ?? '';
      for (const literal of (insert[2] ?? '').matchAll(
        /'([a-z_]+(?:\.[a-z_]+)?)'/gi,
      )) {
        if (literal[1])
          note(literal[1], /\b(from_value|to_value)\b/.test(columns));
      }
    }
  }
  return actions;
}

describe('task activity actions', () => {
  const actions = recordedActions();

  it('finds the writers it guards', () => {
    // A walk that found nothing would pass anything.
    for (const known of [
      'created',
      'status.changed',
      'assignee.changed',
      'title.changed',
      'comment.added',
    ]) {
      expect(actions.has(known), known).toBe(true);
    }
  });

  it('labels every action a writer records', () => {
    const unlabelled = [...actions.keys()].filter(
      (action) => !TASK_ACTIVITY_LABEL_KEY[action],
    );
    expect(unlabelled).toEqual([]);
  });

  it('says how the history reads every value a writer stores', () => {
    const undeclared = [...actions]
      .filter(
        ([action, { withValue }]) => withValue && !TASK_ACTIVITY_FIELD[action],
      )
      .map(([action]) => action);
    expect(undeclared).toEqual([]);
  });
});
