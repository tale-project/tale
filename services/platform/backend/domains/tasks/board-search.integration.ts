/**
 * Real Postgres proof of the board's search filter (#3745): the query
 * narrows the board read itself, with the board's other filters, before the
 * board's cap — so no match can fall outside a capped search the page used
 * to intersect afterwards. Fixture rows go in by SQL; every read goes
 * through the app's own HTTP doors.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

const BOARD_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
] as const;
const PRIORITIES = ['p1', 'p2', 'p3', null] as const;

const boardSchema = z.object({
  tasks: z.array(
    z
      .object({
        id: z.string(),
        status: z.string(),
        priority: z.string().nullable(),
        assigneeId: z.string().nullable(),
      })
      .loose(),
  ),
  truncated: z.boolean(),
});
const hitsSchema = z.object({
  results: z.array(z.object({ taskId: z.string() }).loose()),
});

type BoardRow = z.infer<typeof boardSchema>['tasks'][number];

export async function checkTaskBoardSearch(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { cookie, orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const term = `needle${suffix}`;
  const projectId = randomUUID();
  const otherMemberId = randomUUID();
  const now = Date.now();

  const get = async (path: string): Promise<unknown> =>
    (await fetch(`${base}${path}`, { headers: { cookie } })).json();

  // A second member to assign work to — the shared session user stays the
  // other assignee, and a third of the matches stay unassigned.
  await sql`
    INSERT INTO "user" ("id", "email", "name", "emailVerified", "createdAt", "updatedAt")
    VALUES (${otherMemberId}, ${`itest-board-search-${suffix}@example.test`},
      'Board Search Member', true, now(), now())
  `;
  await sql`
    INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
    VALUES (${randomUUID()}, ${orgId}, ${otherMemberId}, 'editor', now())
  `;
  await sql`
    INSERT INTO app.projects (id, org_id, name, key, created_by, created_at_ms, updated_at_ms)
    VALUES (${projectId}, ${orgId}, 'Board search proof', 'BSR', ${userId}, ${now}, ${now})
  `;

  interface Seed {
    id: string;
    title: string;
    status: (typeof BOARD_STATUSES)[number];
    priority: string | null;
    assigneeId: string | null;
    archived: boolean;
    number: number;
    description?: string;
  }
  const seeds: Seed[] = [];
  const assignees = [userId, otherMemberId, null];
  const add = (seed: Omit<Seed, 'id' | 'number'>): Seed => {
    const row = { ...seed, id: randomUUID(), number: seeds.length + 1 };
    seeds.push(row);
    return row;
  };
  // The OLDEST match is the only Urgent one: 30 newer matches outrank it in
  // the palette's recency order, so its 25-hit page leaves it out.
  const urgent = add({
    title: `${term} urgent oldest`,
    status: 'todo',
    priority: 'p0',
    assigneeId: null,
    archived: false,
  });
  for (let i = 0; i < 30; i += 1) {
    add({
      title: `${term} work ${i + 1}`,
      status: BOARD_STATUSES[i % BOARD_STATUSES.length] ?? 'todo',
      priority: PRIORITIES[i % PRIORITIES.length] ?? null,
      assigneeId: assignees[i % assignees.length] ?? null,
      archived: false,
    });
  }
  const escaped = add({
    title: `${term} half 50% done`,
    status: 'todo',
    priority: null,
    assigneeId: null,
    archived: false,
  });
  const decoy = add({
    title: `${term} 500 units`,
    status: 'todo',
    priority: null,
    assigneeId: null,
    archived: false,
  });
  const described = add({
    title: 'Only the description mentions it',
    description: `Background for ${term} planning.`,
    status: 'backlog',
    priority: 'p1',
    assigneeId: otherMemberId,
    archived: false,
  });
  const commented = add({
    title: 'Only a comment mentions it',
    status: 'in_progress',
    priority: 'p2',
    assigneeId: userId,
    archived: false,
  });
  const archived = add({
    title: `${term} archived`,
    status: 'done',
    priority: 'p0',
    assigneeId: null,
    archived: true,
  });
  const unrelated = add({
    title: 'Unrelated control task',
    status: 'todo',
    priority: 'p0',
    assigneeId: null,
    archived: false,
  });

  for (const [index, seed] of seeds.entries()) {
    const at = now - (seeds.length - index) * 1000;
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, description, status,
        priority, assignee_type, assignee_id, rank, number, created_by,
        created_by_type, created_at_ms, updated_at_ms, archived_at_ms)
      VALUES (${seed.id}, ${orgId}, ${projectId}, ${seed.title},
        ${seed.description ?? null}, ${seed.status}, ${seed.priority},
        ${seed.assigneeId === null ? null : 'user'}, ${seed.assigneeId},
        ${`a${String(index).padStart(3, '0')}`}, ${seed.number}, ${userId},
        'user', ${at}, ${at}, ${seed.archived ? at : null})
    `;
  }
  // The comment-only match: its comment goes through the app's own door.
  const commentRes = await fetch(
    `${base}/api/app/tasks/${commented.id}/comments?orgId=${orgId}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      body: JSON.stringify({ body: `Agreed: ${term} goes out on Friday.` }),
    },
  );

  const statuses = BOARD_STATUSES.join(',');
  const board = async (
    params: Record<string, string>,
    path = `/api/app/tasks/by-project/${projectId}`,
  ): Promise<{ rows: BoardRow[]; truncated: boolean } | null> => {
    const query = new URLSearchParams({ orgId, ...params });
    const parsed = boardSchema.safeParse(await get(`${path}?${query}`));
    return parsed.success
      ? { rows: parsed.data.tasks, truncated: parsed.data.truncated }
      : null;
  };
  const idsOf = (rows: readonly { id: string }[]) =>
    new Set(rows.map((row) => row.id));
  const sameSet = (a: Set<string>, b: Set<string>) =>
    a.size === b.size && [...a].every((id) => b.has(id));

  // What each read must answer, straight from the fixture.
  const matches = seeds.filter(
    (seed) => seed.id !== unrelated.id && !seed.archived,
  );
  const expected = idsOf(matches);

  const palette = hitsSchema.safeParse(
    await get(
      `/api/app/tasks/search?${new URLSearchParams({ q: term, projectId, orgId })}`,
    ),
  );
  const paletteIds = palette.success
    ? palette.data.results.map((hit) => hit.taskId)
    : [];
  const searched = await board({ includeArchived: 'false', statuses, q: term });
  const searchedIds = searched ? idsOf(searched.rows) : new Set<string>();
  const detail = z
    .object({ task: z.object({ description: z.string().nullable() }) })
    .safeParse(await get(`/api/app/tasks/${described.id}?orgId=${orgId}`));
  record(
    'board rows omit large bodies while the selected task retains its description',
    searched !== null &&
      searched.rows.every(
        (row) =>
          !Object.hasOwn(row, 'description') &&
          !Object.hasOwn(row, 'attachments') &&
          !Object.hasOwn(row, 'outputs') &&
          !Object.hasOwn(row, 'externalIssue'),
      ) &&
      detail.success &&
      detail.data.task.description === described.description,
    `board=${searched?.rows.length ?? 'ERR'} summary-only=${searched?.rows.every((row) => !Object.hasOwn(row, 'description')) ?? false} detail=${detail.success && detail.data.task.description === described.description}`,
  );
  const urgentOnly =
    searched?.rows.filter((row) => row.priority === 'p0') ?? [];
  const perStatus = BOARD_STATUSES.map(
    (status) => searched?.rows.filter((row) => row.status === status).length,
  );
  const expectedPerStatus = BOARD_STATUSES.map(
    (status) => matches.filter((seed) => seed.status === status).length,
  );
  record(
    'the board search keeps every match past the palette cap (#3745)',
    commentRes.ok &&
      palette.success &&
      paletteIds.length === 25 &&
      !paletteIds.includes(urgent.id) &&
      searched !== null &&
      !searched.truncated &&
      sameSet(searchedIds, expected) &&
      searchedIds.has(described.id) &&
      searchedIds.has(commented.id) &&
      urgentOnly.length === 1 &&
      urgentOnly[0]?.id === urgent.id &&
      perStatus.every((count, i) => count === expectedPerStatus[i]),
    `comment=${commentRes.status}, palette=${paletteIds.length} hits (want 25) urgentInPalette=${paletteIds.includes(urgent.id)} (want false), board=${searchedIds.size} (want ${expected.size}) truncated=${searched?.truncated ?? 'ERR'}, same=${sameSet(searchedIds, expected)}, description=${searchedIds.has(described.id)}, comment=${searchedIds.has(commented.id)}, urgent=${urgentOnly.length} (want 1), perStatus=${JSON.stringify(perStatus)} (want ${JSON.stringify(expectedPerStatus)})`,
  );

  // The server-side facets narrow the same statement as the query.
  const mine = await board({
    includeArchived: 'false',
    statuses,
    assigneeId: otherMemberId,
    q: term,
  });
  const mineExpected = idsOf(
    matches.filter((seed) => seed.assigneeId === otherMemberId),
  );
  const withArchived = await board({
    includeArchived: 'true',
    statuses,
    q: term,
  });
  const doneOnly = await board({
    includeArchived: 'false',
    statuses: 'done',
    q: term,
  });
  record(
    'the board search composes with assignee, archived and status filters',
    mine !== null &&
      sameSet(idsOf(mine.rows), mineExpected) &&
      mineExpected.size > 10 &&
      withArchived !== null &&
      sameSet(idsOf(withArchived.rows), new Set([...expected, archived.id])) &&
      doneOnly !== null &&
      doneOnly.rows.length ===
        matches.filter((seed) => seed.status === 'done').length &&
      doneOnly.rows.every((row) => row.status === 'done'),
    `assignee=${mine?.rows.length ?? 'ERR'} (want ${mineExpected.size}), withArchived=${withArchived?.rows.length ?? 'ERR'} (want ${expected.size + 1}), done=${doneOnly?.rows.length ?? 'ERR'}`,
  );

  // Token-AND, LIKE escaping, KEY-number, the no-match control, and the
  // all-projects board.
  const tokenAnd = await board({ statuses, q: `${term} URGENT` });
  const percent = await board({ statuses, q: `${term} 50%` });
  const byKey = await board({ statuses, q: `bsr-${escaped.number}` });
  const none = await board({ statuses, q: `${term} zzzz-no-such-token` });
  const across = await board(
    { includeArchived: 'false', statuses, q: term },
    '/api/app/tasks',
  );
  const acrossIds = across ? idsOf(across.rows) : new Set<string>();
  record(
    'the board search matches like the palette: tokens, escapes, keys, none',
    tokenAnd !== null &&
      sameSet(idsOf(tokenAnd.rows), new Set([urgent.id])) &&
      percent !== null &&
      sameSet(idsOf(percent.rows), new Set([escaped.id])) &&
      byKey !== null &&
      idsOf(byKey.rows).has(escaped.id) &&
      !idsOf(byKey.rows).has(decoy.id) &&
      none !== null &&
      none.rows.length === 0 &&
      !none.truncated &&
      across !== null &&
      sameSet(acrossIds, expected),
    `tokenAnd=${tokenAnd?.rows.length ?? 'ERR'} (want 1), percent=${percent?.rows.length ?? 'ERR'} (want 1), byKey=${byKey ? idsOf(byKey.rows).has(escaped.id) : 'ERR'}/${byKey ? idsOf(byKey.rows).has(decoy.id) : 'ERR'} (want true/false), none=${none?.rows.length ?? 'ERR'} (want 0), across=${acrossIds.size} (want ${expected.size})`,
  );
}
