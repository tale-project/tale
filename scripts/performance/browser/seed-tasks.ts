// Deterministic synthetic task-board fixture: org members (SQL rows in better-auth's `member` table) and the
// two boards' tasks through the board's OWN service code (createTask / addTaskDependency / addTaskComment,
// each in its own serializable transaction like the HTTP door). The HTTP door is not used for the bulk because
// its per-user `task:create` rate limit would refuse it. Deterministic (seeded PRNG), synthetic text only.
//
// Run only inside the owned offline diagnostic container.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { z } from 'zod';

import { transactSerializable } from '../../../packages/shared/src/db/serializable.ts';
import { createSql } from '../../../services/platform/backend/db/sql.ts';
import { getProjectAuthContext } from '../../../services/platform/backend/domains/projects/service.ts';
import { addTaskComment } from '../../../services/platform/backend/domains/tasks/comments.ts';
import {
  addTaskDependency,
  createTask,
  createTaskLabel,
} from '../../../services/platform/backend/domains/tasks/service.ts';

const OUT = process.env.BENCH_OUTPUT!;
const id = z.string().regex(/^[A-Za-z0-9_-]+$/);
const ids = z
  .object({
    orgId: id,
    userIds: z.array(id).length(5),
    emails: z.array(z.string().email()).length(5),
    names: z.array(z.string()).length(5),
    projectNames: z.record(z.string(), z.string()),
    projects: z.record(z.string(), id),
  })
  .parse(JSON.parse(readFileSync(`${OUT}/seed-ids.json`, 'utf8')));
const sql = createSql(process.env.DATABASE_URL!);

// mulberry32 — a fixed seed per project makes every round's fixture identical.
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(rand: () => number, weighted: Array<[T, number]>): T {
  const total = weighted.reduce((sum, [, w]) => sum + w, 0);
  let r = rand() * total;
  for (const [value, w] of weighted) {
    r -= w;
    if (r <= 0) return value;
  }
  return weighted[weighted.length - 1]![0];
}

const VERBS = [
  'Fix',
  'Add',
  'Update',
  'Review',
  'Migrate',
  'Document',
  'Investigate',
  'Refactor',
  'Remove',
  'Prepare',
  'Translate',
  'Audit',
];
const OBJECTS = [
  'invoice export',
  'login redirect',
  'billing webhook',
  'search ranking',
  'onboarding email',
  'CSV import',
  'mobile layout',
  'audit log',
  'SSO mapping',
  'rate limiter',
  'knowledge sync',
  'contact merge',
  'release notes',
  'dashboard chart',
  'retention policy',
  'API pagination',
  'password reset',
  'team permissions',
  'PDF preview',
  'notification digest',
];
const TAILS = [
  'for enterprise customers',
  'on Safari',
  'after the 0.5 upgrade',
  'in the German locale',
  'before the Q4 review',
  'for the support queue',
  'with retries',
  'behind the feature flag',
  'for large accounts',
  'when the session lapses',
  '',
  '',
  '',
  '',
];
const LABELS = ['bug', 'feature', 'improvement', 'docs', 'infra', 'customer'];
const SENTENCES = [
  'Customers report that the current behaviour is confusing when they switch between organizations.',
  'The fix should keep the existing API contract and add a regression test.',
  'Steps to reproduce: open the page, change the filter, then reload the browser.',
  'Expected: the list keeps its order. Actual: the newest rows jump to the top.',
  'This blocks the onboarding of two pilot customers next week.',
  'See the support thread for screenshots and the exact error message.',
  'We agreed in the weekly sync to split this into a backend and a UI part.',
  'Measure the change on a large account before and after the deploy.',
  'The translation keys exist in English only; German and French are missing.',
  'Keep the accessibility of the dialog intact: focus order, labels and contrast.',
];

function title(rand: () => number, index: number): string {
  const base =
    `${VERBS[Math.floor(rand() * VERBS.length)]} ${OBJECTS[Math.floor(rand() * OBJECTS.length)]} ${TAILS[Math.floor(rand() * TAILS.length)]}`.trim();
  // Search tokens: "zebra" in every 100th task (1 %), "quokka" in every 10th (10 %).
  if (index % 100 === 37) return `${base} (zebra crossing)`;
  if (index % 10 === 3) return `${base} — quokka follow-up`;
  return base;
}
function description(rand: () => number): string | undefined {
  if (rand() < 0.3) return undefined;
  const paragraphs = 1 + Math.floor(rand() * 3);
  const out: string[] = [];
  for (let p = 0; p < paragraphs; p += 1) {
    const n = 2 + Math.floor(rand() * 5);
    const words: string[] = [];
    for (let s = 0; s < n; s += 1)
      words.push(SENTENCES[Math.floor(rand() * SENTENCES.length)]!);
    out.push(words.join(' '));
  }
  if (rand() < 0.3)
    out.push('- [ ] backend change\n- [ ] UI change\n- [ ] docs');
  return out.join('\n\n');
}

const REF_MS = Date.UTC(2026, 9, 1, 12, 0, 0);
const DAY = 86_400_000;

async function main() {
  // Members: Jonas admin, the other three members. Same shape better-auth writes.
  const roles = ['admin', 'member', 'member', 'member'];
  for (let i = 1; i < ids.userIds.length; i += 1) {
    const [existing] =
      await sql`SELECT 1 FROM "member" WHERE "organizationId" = ${ids.orgId} AND "userId" = ${ids.userIds[i]}`;
    if (existing) continue;
    await sql`INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
              VALUES (${randomUUID()}, ${ids.orgId}, ${ids.userIds[i]}, ${roles[i - 1]}, now())`;
  }
  const ownerAuth = await getProjectAuthContext(
    sql,
    { organizationId: ids.orgId, userId: ids.userIds[0], role: 'owner' },
    ids.emails[0],
  );
  const [database] = await sql`SELECT version() AS version`;
  writeFileSync(
    `${OUT}/database-runtime.json`,
    JSON.stringify(database, null, 2),
  );
  const sizes: Record<string, number> = { small: 50, large: 2000 };
  const summary: Record<string, unknown> = {};
  for (const [size, count] of Object.entries(sizes)) {
    const projectId = ids.projects[size];
    const [already] =
      await sql`SELECT count(*)::int AS n FROM app.tasks WHERE project_id = ${projectId}`;
    if (already.n > 0)
      throw new Error(
        `project ${size} already has ${already.n} tasks — seed a fresh round instead`,
      );
    for (const name of ['docs', 'infra', 'customer']) {
      await transactSerializable(sql, (tx) =>
        createTaskLabel(tx, ownerAuth, { projectId, name }),
      );
    }
    const rand = prng(361_000 + count);
    const created: string[] = [];
    const seeded: Array<{
      taskId: string;
      title: string;
      parent?: string;
      assigneeName: string | null;
    }> = [];
    const roots: string[] = [];
    let subtasks = 0,
      comments = 0,
      deps = 0,
      withDesc = 0,
      withDue = 0;
    const statusCount: Record<string, number> = {};
    const t0 = Date.now();
    for (let i = 0; i < count; i += 1) {
      const status = pick(rand, [
        ['backlog', 30],
        ['todo', 25],
        ['in_progress', 12],
        ['in_review', 6],
        ['done', 22],
        ['cancelled', 5],
      ]);
      const priority = pick<string | undefined>(rand, [
        ['p0', 5],
        ['p1', 15],
        ['p2', 30],
        ['p3', 20],
        [undefined, 30],
      ]);
      const nLabels = pick(rand, [
        [0, 40],
        [1, 40],
        [2, 15],
        [3, 5],
      ]);
      const labels = [
        ...new Set(
          Array.from(
            { length: nLabels },
            () => LABELS[Math.floor(rand() * LABELS.length)]!,
          ),
        ),
      ];
      const assignee = pick<number | null>(rand, [
        [0, 25],
        [1, 15],
        [2, 15],
        [3, 10],
        [4, 10],
        [null, 25],
      ]);
      const desc = description(rand);
      const due =
        rand() < 0.3 ? REF_MS + Math.round(rand() * 60 - 30) * DAY : undefined;
      const parent =
        roots.length > 5 && rand() < 0.06
          ? roots[Math.floor(rand() * roots.length)]
          : undefined;
      const taskTitle = title(rand, i);
      const taskId = await transactSerializable(sql, (tx) =>
        createTask(tx, ownerAuth, {
          projectId,
          title: taskTitle,
          ...(desc !== undefined ? { description: desc } : {}),
          status,
          ...(priority !== undefined ? { priority } : {}),
          ...(labels.length > 0 ? { labels } : {}),
          ...(assignee !== null
            ? { assigneeType: 'user', assigneeId: ids.userIds[assignee] }
            : {}),
          ...(parent !== undefined ? { parentTaskId: parent } : {}),
          ...(due !== undefined ? { dueDate: due } : {}),
        } as Parameters<typeof createTask>[2]),
      );
      created.push(taskId);
      seeded.push({
        taskId,
        title: taskTitle,
        parent,
        assigneeName: assignee === null ? null : ids.names[assignee]!,
      });
      if (parent === undefined) roots.push(taskId);
      else subtasks += 1;
      if (desc !== undefined) withDesc += 1;
      if (due !== undefined) withDue += 1;
      statusCount[status] = (statusCount[status] ?? 0) + 1;
      if (rand() < 0.15) {
        const n = 1 + Math.floor(rand() * 4);
        for (let c = 0; c < n; c += 1) {
          await transactSerializable(sql, (tx) =>
            addTaskComment(tx, ownerAuth, {
              taskId,
              body: SENTENCES[Math.floor(rand() * SENTENCES.length)]!,
            }),
          );
          comments += 1;
        }
      }
      if (created.length > 10 && rand() < 0.03) {
        const blocker = created[Math.floor(rand() * (created.length - 1))]!;
        if (blocker !== taskId) {
          await transactSerializable(sql, (tx) =>
            addTaskDependency(tx, ownerAuth, {
              blockerTaskId: blocker,
              blockedTaskId: taskId,
            }),
          );
          deps += 1;
        }
      }
      if ((i + 1) % 250 === 0)
        console.log(
          `${size}: ${i + 1}/${count} (${Math.round((Date.now() - t0) / 1000)} s)`,
        );
    }
    const counts = new Map<string, number>();
    for (const task of seeded)
      counts.set(task.title, (counts.get(task.title) ?? 0) + 1);
    const target = seeded.find(
      (task) => task.parent === undefined && counts.get(task.title) === 1,
    );
    if (!target) throw new Error('fixture has no uniquely named root task');
    summary[size] = {
      projectId,
      count,
      target,
      projectName: ids.projectNames[size],
      tasks: seeded,
      statusCount,
      subtasks,
      comments,
      deps,
      withDesc,
      withDue,
      seconds: Math.round((Date.now() - t0) / 1000),
    };
    console.log(
      size,
      JSON.stringify({
        count,
        target,
        statusCount,
        subtasks,
        comments,
        deps,
        withDesc,
        withDue,
      }),
    );
  }
  writeFileSync(`${OUT}/seed-summary.json`, JSON.stringify(summary, null, 2));
  await sql.end();
}
await main();
