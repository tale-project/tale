/** Upgrade proof over the shipped 0130 shape. All DDL and fixtures roll back,
 * leaving both the migration and the other integration lanes untouched. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

import type { Sql } from 'postgres';

import {
  startOfTodayIn,
  type TaskRepeat,
} from '../../../lib/shared/task-repeat.ts';
import { toJson } from '../../db/sql.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { createDueRepeatCopy, stopTaskRepeat } from './repeat.ts';
import { createTask } from './service.ts';

class RollbackFixture extends Error {}

export async function checkTaskRepeatSeriesUpgrade(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const migration = await readFile(
    new URL('../../db/migrations/0132_task_repeat_series.sql', import.meta.url),
    'utf8',
  );
  const { orgId, userId } = ctx;
  const auth = {
    organizationId: orgId,
    userId,
    role: 'owner',
    teamIds: [] as string[],
  };
  const rule: TaskRepeat = {
    frequency: 'daily',
    interval: 1,
    timezone: 'UTC',
    createOn: 'dueDate',
  };
  const dueDate = startOfTodayIn('UTC', Date.now());
  try {
    await sql.begin(async (tx) => {
      // Recreate the old shape inside this transaction. The outer rollback
      // restores every existing membership value, index, trigger and function.
      await tx`DROP TRIGGER IF EXISTS tasks_repeat_series_compat ON app.tasks`;
      await tx`ALTER TABLE app.tasks
        DROP COLUMN repeat_series_id CASCADE,
        DROP COLUMN repeat_series_position CASCADE`;
      const projectId = randomUUID();
      const otherProject = randomUUID();
      const foreignProject = randomUUID();
      const foreignOrg = randomUUID();
      const now = Date.now();
      for (const [id, organization] of [
        [projectId, orgId],
        [otherProject, orgId],
        [foreignProject, foreignOrg],
      ]) {
        await tx`INSERT INTO app.projects
          (id, org_id, name, created_by, created_at_ms, updated_at_ms)
          VALUES (${id}, ${organization}, 'Repeat upgrade', ${userId}, ${now}, ${now})`;
      }
      const make = async (
        title: string,
        project = projectId,
        organization = orgId,
      ) => {
        const id = randomUUID();
        await tx`INSERT INTO app.tasks (
          id, org_id, project_id, title, status, rank, created_by, created_by_type,
          created_at_ms, updated_at_ms, status_changed_at_ms, due_date_ms, repeat_rule
        ) VALUES (
          ${id}, ${organization}, ${project}, ${title}, 'todo', 'a0', ${userId}, 'user',
          ${now}, ${now}, ${now}, ${dueDate}, ${tx.json(toJson(rule))}
        )`;
        return id;
      };
      const audit = async (
        child: string,
        parent: unknown,
        project = projectId,
      ) => {
        await createAuditLog(tx, {
          organizationId: orgId,
          actorId: 'system',
          actorType: 'system',
          action: 'task.created',
          category: 'data',
          resourceType: 'task',
          resourceId: child,
          status: 'success',
          metadata: {
            projectId: project,
            parentTaskId: null,
            repeatOf: parent,
          },
        });
      };
      const link = async (
        parent: string,
        child: string,
        withAudit: boolean,
      ) => {
        await tx`UPDATE app.tasks SET repeat_next_task_id = ${child},
          repeat_continued_at_ms = ${now} WHERE id = ${parent}`;
        if (withAudit) await audit(child, parent);
      };
      const chain = async (length: number, withAudit: boolean) => {
        const ids: string[] = [];
        for (let i = 0; i < length; i += 1) {
          const id = await make(`Legacy ${i}`);
          const previous = ids.at(-1);
          if (previous !== undefined) await link(previous, id, withAudit);
          ids.push(id);
        }
        return ids;
      };
      const retained = await chain(12, true);
      await tx`DELETE FROM app.tasks WHERE id = ANY(${[retained[0], retained[5]]})`;
      const fallback = await chain(3, false);
      const forgotten = await chain(3, false);
      await tx`DELETE FROM app.tasks WHERE id = ${forgotten[1]}`;
      const foreign = await make('Other tenant', foreignProject, foreignOrg);
      const anotherProject = await make('Other project', otherProject);
      const badTenant = await make('Forged tenant ancestry');
      const badProject = await make('Forged project ancestry');
      const badShape = await make('Malformed ancestry');
      const ambiguous = await make('Conflicting ancestry');
      await audit(badTenant, foreign);
      await audit(badProject, anotherProject);
      await audit(badShape, { id: fallback[0] });
      await audit(ambiguous, fallback[0]);
      await audit(ambiguous, retained[1]);
      const cycle = [await make('Cycle A'), await make('Cycle B')] as const;
      await audit(cycle[0], cycle[1]);
      await audit(cycle[1], cycle[0]);

      const longChain = Array.from({ length: 1_001 }, () => randomUUID());
      await tx`INSERT INTO app.tasks (
        id, org_id, project_id, title, status, rank, created_by, created_by_type,
        created_at_ms, updated_at_ms, status_changed_at_ms, repeat_rule,
        repeat_next_task_id, repeat_continued_at_ms
      ) SELECT id, ${orgId}, ${projectId}, 'Long closed series', 'done', 'a0',
          ${userId}, 'user', ${now}, ${now}, ${now}, ${tx.json(toJson(rule))},
          lead(id) OVER (ORDER BY position), ${now}
        FROM unnest(${longChain}::text[]) WITH ORDINALITY AS member(id, position)`;

      const migrationStarted = Date.now();
      await tx.unsafe(migration);
      const migrationMs = Date.now() - migrationStarted;
      const membership = (ids: string[]) => tx<
        {
          id: string;
          series: string | null;
          position: number | null;
        }[]
      >`SELECT id, repeat_series_id AS series, repeat_series_position AS position
        FROM app.tasks WHERE id = ANY(${ids}) ORDER BY id`;
      const upgraded = await membership(retained);
      const longRows = await membership(longChain);
      record(
        'repeat upgrade: a thousand closed predecessors remain one complete ordered series',
        longRows.length === 1_001 &&
          longRows.every((row) => row.series === longChain[0]) &&
          longRows.find((row) => row.id === longChain.at(-1))?.position ===
            1_000,
        `${longRows.length} members; complete migration ${migrationMs}ms`,
      );
      record(
        'repeat upgrade: retained audit ancestry reconnects a deleted root and middle task',
        upgraded.length === 10 &&
          upgraded.every((row) => row.series === retained[0]) &&
          new Set(upgraded.map((row) => row.position)).size === 10,
        JSON.stringify(upgraded),
      );
      const fallbackRows = await membership(fallback);
      record(
        'repeat upgrade: live pointers recover a chain without audit history',
        fallbackRows.length === 3 &&
          fallbackRows.every((row) => row.series === fallback[0]),
        JSON.stringify(fallbackRows),
      );
      const unknownRows = await membership(forgotten);
      record(
        'repeat upgrade: a deleted link without retained ancestry is not invented',
        unknownRows.every((row) => row.series === row.id),
        JSON.stringify(unknownRows),
      );
      const unsafeRows = await membership([
        badTenant,
        badProject,
        badShape,
        ambiguous,
      ]);
      record(
        'repeat upgrade: malformed, conflicting and foreign ancestry never joins unrelated work',
        unsafeRows.every((row) => row.series === row.id),
        JSON.stringify(unsafeRows),
      );
      const cycleRows = await membership([...cycle]);
      record(
        'repeat upgrade: cyclic audit ancestry terminates with one finite ordered series',
        new Set(cycleRows.map((row) => row.series)).size === 1 &&
          cycleRows.every((row) => row.series !== null) &&
          new Set(cycleRows.map((row) => row.position)).size === 2,
        JSON.stringify(cycleRows),
      );
      await tx.unsafe(migration);
      record(
        'repeat upgrade: a second application preserves every assigned identity and position',
        isDeepStrictEqual(upgraded, await membership(retained)) &&
          isDeepStrictEqual(fallbackRows, await membership(fallback)) &&
          isDeepStrictEqual(cycleRows, await membership([...cycle])),
        'compared retained-gap, pointer-only and cyclic series',
      );
      const capped = await createDueRepeatCopy(tx, {
        organizationId: orgId,
        taskId: retained[retained.length - 1],
        now: Date.now(),
      });
      record(
        'repeat upgrade: the new writer counts ten surviving open legacy members across deletion',
        capped.kind === 'capped' && capped.openCopies === 10,
        JSON.stringify(capped),
      );
      // Mark all legacy work touched; Stop must preserve it and clear all rules.
      await tx`UPDATE app.tasks SET updated_at_ms = ${now + 1} WHERE id = ANY(${retained})`;
      await stopTaskRepeat(tx, auth, retained[1]);
      const active = await tx`SELECT id FROM app.tasks
        WHERE id = ANY(${retained}) AND repeat_rule IS NOT NULL`;
      record(
        'repeat upgrade: Stop reaches every surviving legacy member',
        active.length === 0,
        `${active.length} rules left`,
      );

      // The previous image inserts copies without either membership column,
      // then publishes the pointer. The compatibility trigger owns that edge.
      const oldRoot = await make('Old image root');
      const oldMiddle = await make('Old image middle');
      await link(oldRoot, oldMiddle, false);
      const oldTail = await make('Old image tail');
      await link(oldMiddle, oldTail, false);
      await tx`DELETE FROM app.tasks WHERE id = ${oldMiddle}`;
      const rolled = await membership([oldRoot, oldTail]);
      record(
        'repeat upgrade: an old writer retains membership before a middle copy is deleted',
        rolled.length === 2 &&
          rolled.every((row) => row.series === oldRoot) &&
          rolled.find((row) => row.id === oldTail)?.position === 2,
        JSON.stringify(rolled),
      );
      const next = await createDueRepeatCopy(tx, {
        organizationId: orgId,
        taskId: oldTail,
        now: Date.now(),
      });
      const mixed = await membership([
        oldRoot,
        oldTail,
        ...(next.kind === 'created' ? [next.copy.id] : []),
      ]);
      record(
        'repeat upgrade: a new writer continues an old-image series without resetting its identity',
        next.kind === 'created' &&
          mixed.length === 3 &&
          mixed.every((row) => row.series === oldRoot),
        JSON.stringify(mixed),
      );
      if (next.kind === 'created') {
        const assignedChild = await make('Already assigned child');
        await tx`UPDATE app.tasks SET repeat_series_id = ${oldRoot},
          repeat_series_position = 4 WHERE id = ${assignedChild}`;
        const assignedBefore = await membership([assignedChild]);
        await link(next.copy.id, assignedChild, false);
        record(
          'repeat upgrade: publishing a preassigned child preserves its identity and position',
          isDeepStrictEqual(assignedBefore, await membership([assignedChild])),
          JSON.stringify(assignedBefore),
        );
        await tx`DELETE FROM app.tasks WHERE id = ${oldRoot}`;
        const afterRootDelete = await make('Old image after root deletion');
        await link(assignedChild, afterRootDelete, false);
        const surviving = await membership([assignedChild, afterRootDelete]);
        record(
          'repeat upgrade: an old image continues the same series after its root was deleted',
          surviving.every((row) => row.series === oldRoot) &&
            surviving.find((row) => row.id === afterRootDelete)?.position === 5,
          JSON.stringify(surviving),
        );
      }
      const abortedRoot = await make('Rollback root');
      let abortedChild = '';
      try {
        await tx.savepoint(async (sp) => {
          abortedChild = await createTask(sp, auth, {
            projectId,
            title: 'Rollback child',
            repeat: rule,
          });
          await sp`UPDATE app.tasks SET repeat_next_task_id = ${abortedChild},
            repeat_continued_at_ms = ${now} WHERE id = ${abortedRoot}`;
          throw new RollbackFixture();
        });
      } catch (error) {
        if (!(error instanceof RollbackFixture)) throw error;
      }
      const aborted = await membership([abortedRoot, abortedChild]);
      record(
        'repeat upgrade: a rolled-back old-image edge leaves no membership or copy behind',
        aborted.length === 1 &&
          aborted[0]?.id === abortedRoot &&
          aborted[0].series === null,
        JSON.stringify(aborted),
      );
      throw new RollbackFixture();
    });
  } catch (error) {
    if (!(error instanceof RollbackFixture)) throw error;
  }
}
