import { expect, test } from 'bun:test';

import {
  acceptanceFixture,
  type BoardTask,
  type Fixture,
} from './browser/acceptance-fixture.ts';

function seeded(count: 50 | 2000 = 50) {
  const fixture: Fixture = {
    projectId: 'project-fixture',
    projectName: 'Fixture project',
    count,
    tasks: Array.from({ length: count }, (_, index) => ({
      taskId: `task-${index}`,
      title: `Task ${index}${index % 100 === 0 ? ' zebra' : ''}`,
      assigneeName: index % 2 === 0 ? 'Alice Example' : null,
      ...(index === 10 ? { parent: 'task-0' } : {}),
    })),
  };
  const tasks: BoardTask[] = fixture.tasks.map((task) => ({
    id: task.taskId,
    title: task.title,
    status: 'backlog',
    parentTaskId: task.parent ?? null,
    assigneeId: task.assigneeName === null ? null : 'human-1',
  }));
  const all = { tasks, truncated: false };
  const narrow = {
    tasks: structuredClone(
      tasks.filter((task) => task.title.includes('zebra')),
    ),
    truncated: false,
  };
  const names = { 'human-1': 'Alice Example' };
  return { fixture, all, narrow, names };
}
function verify(f: ReturnType<typeof seeded>) {
  return acceptanceFixture(f.fixture, f.all, f.narrow, f.names);
}

test.each([50, 2000] as const)(
  'verifies the %s fixture, exact zebra ratio and declared root targets',
  (count) => {
    const f = seeded(count);
    const before = structuredClone(f);
    const result = verify(f);
    expect(result.verified).toMatchObject({
      count,
      narrowCount: count === 50 ? 1 : 20,
      truncated: false,
    });
    expect(result.targets.map((task) => task.taskId)).toEqual([
      'task-4',
      'task-7',
      'task-11',
      'task-13',
    ]);
    expect(result.targets.map((task) => task.boardIndex)).toEqual([
      4, 7, 11, 13,
    ]);
    expect(f).toEqual(before);
  },
);

test.each(['all', 'narrow'] as const)(
  'refuses a truncated %s response',
  (read) => {
    const f = seeded();
    f[read].truncated = true;
    expect(() => verify(f)).toThrow('truncated');
  },
);

test('rejects missing, duplicate and foreign full-board identities', () => {
  const missing = seeded();
  missing.all.tasks.pop();
  expect(() => verify(missing)).toThrow();
  const duplicate = seeded();
  duplicate.all.tasks[1]!.id = duplicate.all.tasks[0]!.id;
  expect(() => verify(duplicate)).toThrow();
  const foreign = seeded();
  foreign.all.tasks[1]!.id = 'foreign';
  expect(() => verify(foreign)).toThrow('foreign task');
});

test('rejects an extra duplicate fixture row hidden by Map deduplication', () => {
  const f = seeded();
  f.fixture.tasks.push(structuredClone(f.fixture.tasks[2]!));
  expect(() => verify(f)).toThrow();
});

test.each(['title', 'parent', 'actor', 'status'] as const)(
  'refuses a stale or foreign full-board %s',
  (field) => {
    const f = seeded();
    const task = f.all.tasks[0]!;
    if (field === 'title') task.title = 'Stale title';
    else if (field === 'parent') task.parentTaskId = 'foreign-parent';
    else if (field === 'actor') task.assigneeId = 'unknown-human';
    else task.status = 'unknown';
    expect(() => verify(f)).toThrow();
  },
);

test('checks actor display-name identity and explicit unassigned slots', () => {
  const wrongName = seeded();
  wrongName.names['human-1'] = 'Other person';
  expect(() => verify(wrongName)).toThrow('actor identity');
  const unexpected = seeded();
  unexpected.all.tasks[1]!.assigneeId = 'human-1';
  expect(() => verify(unexpected)).toThrow('actor identity');
  const absent = seeded();
  absent.all.tasks[0]!.assigneeId = null;
  expect(() => verify(absent)).toThrow('actor identity');
});

test.each(['title', 'parent', 'actor', 'status'] as const)(
  'rejects stale narrow %s even when the zebra ID subset is correct',
  (field) => {
    const f = seeded();
    const task = f.narrow.tasks[0]!;
    if (field === 'title') task.title = 'Old zebra title';
    else if (field === 'parent') task.parentTaskId = 'foreign-parent';
    else if (field === 'actor') task.assigneeId = 'unknown-human';
    else task.status = 'done';
    expect(() => verify(f)).toThrow();
  },
);

test('narrow read must contain exactly the declared zebra IDs without substitutions or duplicates', () => {
  const wrong = seeded();
  wrong.narrow.tasks[0] = structuredClone(wrong.all.tasks[1]!);
  expect(() => verify(wrong)).toThrow();
  const missing = seeded();
  missing.narrow.tasks = [];
  expect(() => verify(missing)).toThrow();
  const duplicate = seeded(2000);
  duplicate.narrow.tasks[1] = structuredClone(duplicate.narrow.tasks[0]!);
  expect(() => verify(duplicate)).toThrow();
});

test.each([50, 2000] as const)(
  'refuses a %s seed with the wrong zebra ratio',
  (count) => {
    const f = seeded(count);
    for (const task of [
      f.fixture.tasks[0]!,
      f.all.tasks[0]!,
      f.narrow.tasks[0]!,
    ])
      task.title = 'Task without the filter token';
    f.narrow.tasks.shift();
    expect(() => verify(f)).toThrow();
  },
);

test('targets skip titles shared anywhere in the fixture and preserve distinct identities', () => {
  const f = seeded();
  f.fixture.tasks[8]!.title = f.fixture.tasks[7]!.title;
  f.all.tasks[8]!.title = f.all.tasks[7]!.title;
  expect(verify(f).targets.map((task) => task.taskId)).toEqual([
    'task-4',
    'task-9',
    'task-11',
    'task-13',
  ]);
  for (let index = 0; index < 14; index += 1) {
    f.fixture.tasks[index]!.parent = 'task-20';
    f.all.tasks[index]!.parentTaskId = 'task-20';
  }
  f.narrow.tasks[0]!.parentTaskId = 'task-20';
  expect(verify(f).targets.map((task) => task.taskId)).toEqual([
    'task-14',
    'task-15',
    'task-16',
    'task-17',
  ]);
});

test('actual status grouping precedes target selection while API rank order is retained', () => {
  const f = seeded();
  for (const row of f.all.tasks) row.status = 'done';
  for (const index of [40, 41, 42, 43, 44, 45, 46, 47, 48, 49])
    f.all.tasks[index]!.status = 'backlog';
  f.narrow.tasks[0]!.status = 'done';
  expect(verify(f).targets.map((task) => task.taskId)).toEqual([
    'task-44',
    'task-47',
    'task-0',
    'task-3',
  ]);
});

test('targets beyond the first 32 cards and entirely absent root targets fail explicitly', () => {
  const late = seeded();
  for (let index = 0; index < 32; index += 1) {
    late.fixture.tasks[index]!.parent = 'task-40';
    late.all.tasks[index]!.parentTaskId = 'task-40';
  }
  late.narrow.tasks[0]!.parentTaskId = 'task-40';
  expect(() => verify(late)).toThrow('near-top bound');
  const absent = seeded();
  for (let index = 0; index < 50; index += 1) {
    absent.fixture.tasks[index]!.parent = 'unrendered-parent';
    absent.all.tasks[index]!.parentTaskId = 'unrendered-parent';
  }
  absent.narrow.tasks[0]!.parentTaskId = 'unrendered-parent';
  expect(() => verify(absent)).toThrow('Missing distinct root');
});
