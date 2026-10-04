import assert from 'node:assert/strict';

export interface FixtureTask {
  taskId: string;
  title: string;
  parent?: string;
  assigneeName: string | null;
}
export interface Fixture {
  projectId: string;
  projectName: string;
  count: number;
  tasks: FixtureTask[];
}
export interface BoardTask {
  id: string;
  title: string;
  status: string;
  parentTaskId: string | null;
  assigneeId: string | null;
}
const statuses = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
];

/** Validate real board responses; select stable near-top distinct root cards
 * in the same status/rank order the UI receives. No task-detail prewarm. */
export function acceptanceFixture(
  fixture: Fixture,
  all: { tasks: BoardTask[]; truncated: boolean },
  narrow: { tasks: BoardTask[]; truncated: boolean },
  names: Record<string, string>,
) {
  assert.equal(all.truncated, false, 'Full fixture read is truncated');
  assert.equal(narrow.truncated, false, 'Narrow fixture read is truncated');
  assert.equal(all.tasks.length, fixture.count);
  assert.equal(new Set(all.tasks.map((task) => task.id)).size, fixture.count);
  assert.equal(fixture.tasks.length, fixture.count);
  const expected = new Map(fixture.tasks.map((task) => [task.taskId, task]));
  assert.equal(expected.size, fixture.count);
  for (const task of all.tasks) {
    const seeded = expected.get(task.id);
    assert(seeded, 'Board returned a foreign task');
    assert.equal(task.title, seeded.title);
    assert.equal(task.parentTaskId ?? undefined, seeded.parent);
    assert.equal(
      task.assigneeId === null ? null : names[task.assigneeId],
      seeded.assigneeName,
      'Fixture actor identity differs',
    );
    assert(statuses.includes(task.status));
  }
  for (const task of narrow.tasks) {
    const full = all.tasks.find((row) => row.id === task.id);
    assert(full, 'Narrow read returned a foreign task');
    for (const key of [
      'title',
      'status',
      'parentTaskId',
      'assigneeId',
    ] as const)
      assert.equal(
        task[key],
        full[key],
        `Narrow read ${key} differs from full board`,
      );
  }
  const zebra = fixture.tasks.filter((task) => task.title.includes('zebra'));
  assert.equal(zebra.length, fixture.count === 50 ? 1 : 20);
  assert.deepEqual(
    narrow.tasks.map((task) => task.id).sort(),
    zebra.map((task) => task.taskId).sort(),
  );
  const counts = new Map<string, number>();
  for (const task of fixture.tasks)
    counts.set(task.title, (counts.get(task.title) ?? 0) + 1);
  const boardOrder = statuses.flatMap((status) =>
    all.tasks.filter((task) => task.status === status),
  );
  const chosen = new Set<string>();
  const targets = [4, 7, 10, 13].map((start) => {
    const task = boardOrder
      .slice(start)
      .find(
        (row) =>
          row.parentTaskId === null &&
          counts.get(row.title) === 1 &&
          !chosen.has(row.id),
      );
    assert(task, 'Missing distinct root dialog target');
    const index = boardOrder.indexOf(task);
    assert(index < 32, 'Dialog target escaped declared near-top bound');
    chosen.add(task.id);
    return Object.assign({}, expected.get(task.id)!, { boardIndex: index });
  });
  return {
    ...fixture,
    zebra,
    targets,
    verified: {
      count: all.tasks.length,
      narrowCount: narrow.tasks.length,
      truncated: false,
      targetSelection:
        'At/after board indices 4,7,10,13; unique root titles, distinct identities, all within first32 cards',
    },
  };
}
