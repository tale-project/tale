import type { TransactionSql } from 'postgres';

import { taskLabelCountRefusal } from '../../core/tasks/helpers.ts';
import { TaskError } from './service.ts';

/**
 * The labels an issue sync mirrors from an issue onto its task (TASK-R98).
 * A source maps some of its tracker's labels to labels of the project; the
 * task wears exactly the mapped labels its issue wears, and keeps every
 * other label it has — a source's own, a person's, a pause. The mirror never
 * mints a label: the sync refuses a mapping to a label the project does not
 * have before it reads a tracker ({@link missingProjectLabels}), and a write
 * refuses one the catalog lost since.
 */

/** The project labels a source mirrors, by name, and those of them the
 * issue wears now. */
export interface LabelMirror {
  managed: readonly string[];
  carried: readonly string[];
}

/** The names among `names` the project has no label for, matched as the
 * catalog matches: without regard to case. In the order given. */
export async function missingProjectLabels(
  tx: TransactionSql,
  args: {
    organizationId: string;
    projectId: string;
    names: readonly string[];
  },
): Promise<string[]> {
  if (args.names.length === 0) return [];
  const rows = await tx<{ name: string }[]>`
    SELECT wanted.name FROM unnest(${[...args.names]}::text[])
      WITH ORDINALITY AS wanted(name, at)
    WHERE NOT EXISTS (
      SELECT 1 FROM app.task_labels
      WHERE org_id = ${args.organizationId}
        AND project_id = ${args.projectId}
        AND lower(name) = lower(wanted.name)
    )
    ORDER BY wanted.at
  `;
  return rows.map((row) => row.name);
}

/** The catalog's ids for a mirror: every managed label the project has, and
 * each carried one, which it must have (`TASK_LABEL_UNKNOWN`). */
export async function resolveMirroredLabels(
  tx: TransactionSql,
  args: { organizationId: string; projectId: string; mirror: LabelMirror },
): Promise<{ managed: ReadonlySet<string>; carried: string[] }> {
  const names = [...new Set([...args.mirror.managed, ...args.mirror.carried])];
  if (names.length === 0) return { managed: new Set(), carried: [] };
  const rows = await tx<{ name: string; id: string | null }[]>`
    SELECT wanted.name, label.id FROM unnest(${names}::text[])
      WITH ORDINALITY AS wanted(name, at)
    LEFT JOIN app.task_labels AS label
      ON label.org_id = ${args.organizationId}
      AND label.project_id = ${args.projectId}
      AND lower(label.name) = lower(wanted.name)
    ORDER BY wanted.at
  `;
  const idOf = new Map<string, string>();
  for (const row of rows) if (row.id !== null) idOf.set(row.name, row.id);
  const managed = new Set<string>();
  for (const name of args.mirror.managed) {
    const id = idOf.get(name);
    if (id !== undefined) managed.add(id);
  }
  const carried: string[] = [];
  const unknown: string[] = [];
  for (const name of args.mirror.carried) {
    const id = idOf.get(name);
    if (id === undefined) {
      unknown.push(name);
      continue;
    }
    managed.add(id);
    if (!carried.includes(id)) carried.push(id);
  }
  if (unknown.length > 0) {
    throw new TaskError('TASK_LABEL_UNKNOWN', 'Unknown label', 400, {
      labels: unknown,
    });
  }
  return { managed, carried };
}

/** A task's labels with the mirror applied: a managed label stays only
 * while the issue wears it, a carried one the task lacks is added after
 * the rest, and every other label stays where it is. */
export function withMirroredLabels(
  current: readonly string[],
  mirrored: { managed: ReadonlySet<string>; carried: readonly string[] },
): string[] {
  const carried = new Set(mirrored.carried);
  const next = current.filter(
    (id) => !mirrored.managed.has(id) || carried.has(id),
  );
  for (const id of mirrored.carried) if (!next.includes(id)) next.push(id);
  const refusal = taskLabelCountRefusal(next.length);
  if (refusal !== null) throw new TaskError('TASK_LABELS_INVALID', refusal);
  return next;
}
