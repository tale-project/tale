/**
 * Real-Postgres proof of the chat list's pages (#5153): pinned chats first,
 * then the newest activity, ties on either timestamp split by id, so a walk
 * page by page answers every chat once; the generating flag read from the
 * page's own generations; and the pinned walk taken from 0224's
 * `thread_metadata_pinned` in its custom and generic plans.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import {
  errorText,
  type RecordCheck,
  withCleanup,
} from '../../integration-lane-helpers.ts';
import {
  listThreads,
  parseThreadListCursor,
  type ThreadListCursor,
  type ThreadPage,
} from './threads.ts';

export async function checkChatThreadPages(
  sql: Sql,
  ctx: { orgId: string },
  record: RecordCheck,
): Promise<void> {
  const parts: ReadonlyArray<readonly [string, () => Promise<void>]> = [
    ['the walk page by page', () => checkWalk(sql, ctx, record)],
    ['the pinned walk plans', () => checkPinnedPlans(sql, ctx, record)],
  ];
  // Each part records its own failure, so a part that throws fails its
  // check without cutting off the parts and lanes after it.
  for (const [part, run] of parts) {
    try {
      await run();
    } catch (error) {
      record(`chat thread pages: ${part} runs`, false, errorText(error));
    }
  }
}

interface SeededThread {
  name: string;
  orgId: string;
  userId: string;
  updatedAt: number;
  pinnedAt?: number;
  archived?: boolean;
  hidden?: boolean;
  status?: string;
  generating?: boolean;
}

/**
 * A fresh person's chats, walked two at a time. Three pins share a pin time
 * and three chats share their last activity, so both ties straddle a page
 * seam, and the pins end exactly on a page. The rows that must stay out
 * (archived, hidden, in the trash, another person's, another
 * organization's) are the newest of all, so a missing filter would show on
 * the first pages.
 */
async function checkWalk(
  sql: Sql,
  ctx: { orgId: string },
  record: RecordCheck,
): Promise<void> {
  const run = randomUUID();
  const userId = `itest-thread-pages-${run}`;
  const base = Date.now();
  // Ids of one length that differ in their last character, so the order of
  // a tie is the same in every collation.
  const idOf = (name: string): string => `itest-tp-${run}-${name}`;
  const seeds: SeededThread[] = [
    { name: 'pin-c', orgId: ctx.orgId, userId, updatedAt: 100, pinnedAt: 5000 },
    { name: 'pin-b', orgId: ctx.orgId, userId, updatedAt: 990, pinnedAt: 5000 },
    { name: 'pin-a', orgId: ctx.orgId, userId, updatedAt: 200, pinnedAt: 5000 },
    { name: 'pin-0', orgId: ctx.orgId, userId, updatedAt: 300, pinnedAt: 4000 },
    { name: 'rec-9', orgId: ctx.orgId, userId, updatedAt: 900 },
    { name: 'rec-c', orgId: ctx.orgId, userId, updatedAt: 800 },
    { name: 'rec-b', orgId: ctx.orgId, userId, updatedAt: 800 },
    { name: 'rec-a', orgId: ctx.orgId, userId, updatedAt: 800 },
    { name: 'rec-5', orgId: ctx.orgId, userId, updatedAt: 700 },
    {
      name: 'rec-4',
      orgId: ctx.orgId,
      userId,
      updatedAt: 600,
      generating: true,
    },
    {
      name: 'out-a',
      orgId: ctx.orgId,
      userId,
      updatedAt: 999,
      pinnedAt: 6000,
      archived: true,
    },
    { name: 'out-h', orgId: ctx.orgId, userId, updatedAt: 998, hidden: true },
    {
      name: 'out-t',
      orgId: ctx.orgId,
      userId,
      updatedAt: 997,
      status: 'trashed',
    },
    {
      name: 'out-u',
      orgId: ctx.orgId,
      userId: `${userId}-other`,
      updatedAt: 996,
      pinnedAt: 6000,
      generating: true,
    },
    {
      name: 'out-o',
      orgId: `itest-thread-pages-org-${run}`,
      userId,
      updatedAt: 995,
      pinnedAt: 6000,
    },
  ];
  const expected = [
    'pin-c',
    'pin-b',
    'pin-a',
    'pin-0',
    'rec-9',
    'rec-c',
    'rec-b',
    'rec-a',
    'rec-5',
    'rec-4',
  ];
  const ids = seeds.map((seed) => idOf(seed.name));
  await withCleanup(
    [
      [
        'deletes its threads',
        () => sql`DELETE FROM app.threads WHERE id IN ${sql(ids)}`,
      ],
    ],
    async () => {
      for (const seed of seeds) {
        const id = idOf(seed.name);
        await sql`
          INSERT INTO app.threads (id, org_id, user_id, title, kind,
                                   created_at_ms, updated_at_ms)
          VALUES (${id}, ${seed.orgId}, ${seed.userId},
                  ${`Thread pages: ${seed.name}`}, 'chat', ${base},
                  ${base + seed.updatedAt})
        `;
        await sql`
          INSERT INTO app.thread_metadata (thread_id, org_id, user_id,
            chat_type, status, archived, pinned_at_ms, hidden, created_at_ms)
          VALUES (${id}, ${seed.orgId}, ${seed.userId}, 'chat',
                  ${seed.status ?? 'active'}, ${seed.archived ?? false},
                  ${seed.pinnedAt === undefined ? null : base + seed.pinnedAt},
                  ${seed.hidden ?? null}, ${base})
        `;
        if (seed.generating === true) {
          await sql`
            INSERT INTO app.generations (thread_id, org_id, started_at_ms,
                                         heartbeat_at_ms, updated_at_ms)
            VALUES (${id}, ${seed.orgId}, ${base}, ${base}, ${base})
          `;
        }
      }

      const pages: ThreadPage[] = [];
      let cursor: ThreadListCursor | undefined;
      // Bounded: a cursor that never advanced would walk forever.
      for (let turn = 0; turn < expected.length + 2; turn++) {
        const page = await listThreads(sql, ctx.orgId, userId, {
          ...(cursor === undefined ? {} : { cursor }),
          limit: 2,
        });
        pages.push(page);
        if (page.isDone) break;
        cursor = parseThreadListCursor(page.continueCursor) ?? undefined;
        if (cursor === undefined) break;
      }
      const nameOf = (id: string): string =>
        seeds.find((seed) => idOf(seed.name) === id)?.name ?? id;
      const walked = pages.flatMap((page) =>
        page.page.map((thread) => nameOf(thread.id)),
      );
      const seams = pages.map((page) => page.continueCursor);
      record(
        'chat thread pages: a walk page by page answers every chat once, pins first, ties split by id',
        walked.join(',') === expected.join(',') &&
          pages.length === 5 &&
          pages.every((page) => page.page.length <= 2) &&
          pages.at(-1)?.isDone === true &&
          pages.at(-1)?.continueCursor === '',
        `walked=${walked.join(',')} (want ${expected.join(',')}) over ${pages.length} pages (want 5), cursors=${JSON.stringify(seams)}`,
      );
      record(
        "chat thread pages: archived, hidden and trashed chats, another person's and another organization's stay out",
        !walked.some((name) => name.startsWith('out-')),
        `walked=${walked.join(',')}`,
      );
      record(
        'chat thread pages: a page of pins ends in the pinned walk, and the next page starts the newest activity from its top',
        parseThreadListCursor(seams[1] ?? '')?.walk === 'pinned' &&
          pages[2]?.page[0]?.id === idOf('rec-9'),
        `second cursor=${seams[1]}, third page starts with ${nameOf(pages[2]?.page[0]?.id ?? '')} (want a pinned cursor, then rec-9)`,
      );
      const generating = pages.flatMap((page) =>
        page.page
          .filter((thread) => thread.generating)
          .map((thread) => nameOf(thread.id)),
      );
      record(
        "chat thread pages: only the chat with a turn in flight is marked generating, from the page's own generations",
        generating.join(',') === 'rec-4',
        `generating=${generating.join(',')} (want rec-4; another person's chat generates too)`,
      );
    },
  );
}

/** A tag's template, as postgres.js tells one from a helper call. */
const isTemplate = (value: unknown): value is TemplateStringsArray =>
  Array.isArray(value) && 'raw' in value;

/**
 * The plans of the pinned walk's statement, taken inside the read: its
 * custom plan (values bound) and the generic plan a prepared statement may
 * settle on, for the first page and for a page after a pinned cursor. On the
 * harness's handful of rows the planner may prefer any index plus a sort,
 * so sequential scans and sorts are ruled out: the walk must take the
 * person's pins, newest pin first, from an index, and only 0224's partial
 * index both bounds and orders them.
 */
async function checkPinnedPlans(
  sql: Sql,
  ctx: { orgId: string },
  record: RecordCheck,
): Promise<void> {
  const userId = `itest-thread-pages-${randomUUID()}`;
  const explainPinnedWalk = async (cursor?: ThreadListCursor) => {
    const plans = { custom: '', generic: '' };
    await sql.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`;
      await tx`SET LOCAL enable_sort = off`;
      const explaining = new Proxy(tx, {
        apply(target, thisArg: unknown, args: unknown[]): unknown {
          const [strings, ...values] = args;
          if (
            !isTemplate(strings) ||
            !strings.join(' ').includes('FROM app.thread_metadata tm') ||
            !strings.join(' ').includes('ORDER BY tm.pinned_at_ms DESC')
          ) {
            const passed: unknown = Reflect.apply(target, thisArg, args);
            return passed;
          }
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the read's own parameters, passed through
          const parameters = values as never[];
          const prefixed = Object.assign(
            [`EXPLAIN ${strings[0] ?? ''}`, ...strings.slice(1)],
            {
              raw: [`EXPLAIN ${strings.raw[0] ?? ''}`, ...strings.raw.slice(1)],
            },
          );
          const explain = async () => {
            const custom = await target<{ 'QUERY PLAN': string }[]>(
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template array with its raw strings, as postgres.js reads one
              prefixed as unknown as TemplateStringsArray,
              ...parameters,
            );
            const { string } = await target(strings, ...parameters).describe();
            const generic = await target
              .unsafe<{ 'QUERY PLAN': string }[]>(
                `EXPLAIN (GENERIC_PLAN) ${string}`,
              )
              .simple();
            plans.custom = custom.map((row) => row['QUERY PLAN']).join('\n');
            plans.generic = generic.map((row) => row['QUERY PLAN']).join('\n');
            return [];
          };
          return explain();
        },
      });
      await listThreads(
        explaining,
        ctx.orgId,
        userId,
        cursor === undefined ? {} : { cursor },
      );
    });
    return plans;
  };
  const first = await explainPinnedWalk();
  const after = await explainPinnedWalk({
    walk: 'pinned',
    at: Date.now(),
    id: 'itest-thread-pages-cursor',
  });
  const reads = (plan: string): boolean =>
    plan.includes('thread_metadata_pinned');
  record(
    'chat thread pages: the pinned walk reads thread_metadata_pinned in its custom and generic plans (0224)',
    reads(first.custom) &&
      reads(first.generic) &&
      reads(after.custom) &&
      reads(after.generic),
    `first page: custom: ${first.custom} | generic: ${first.generic} || after a cursor: custom: ${after.custom} | generic: ${after.generic}`,
  );
}
