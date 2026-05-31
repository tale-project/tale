import { describe, expect, it } from 'vitest';

import { taskRowValidator } from './queries';
import { tasksTable } from './schema';

// Regression guard for a shipped bug: the board/list/table queries return whole
// task docs validated against `taskRowValidator`, and Convex return-validation
// is STRICT — a field stored on a task but missing from the validator makes the
// query throw at runtime, which surfaces as a permanently empty board (no client
// error). `createTask` stamps every task with `number`, so once any task existed
// the query threw on every run — breaking both first paint and live updates.
//
// Asserting validator ⊇ schema catches that drift the moment a new schema field
// lands without being added to the return validator.
describe('taskRowValidator', () => {
  it('covers every tasksTable field', () => {
    const schemaFields = Object.keys(tasksTable.validator.fields);
    const validatorFields = new Set(Object.keys(taskRowValidator.fields));
    const missing = schemaFields.filter((field) => !validatorFields.has(field));
    expect(missing).toEqual([]);
  });
});
