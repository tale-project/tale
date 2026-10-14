import {
  projectDispatchSchema,
  type ProjectDispatch,
} from '@tale/shared/schemas/project-dispatch';
import type { Sql, TransactionSql } from 'postgres';

/**
 * A project's dispatch document as stored (migration 0206): the one read
 * every reader shares — the pass, the readback, the gates and the managed
 * configuration (`dispatch-config.ts`, which also writes it).
 */

export interface StoredProjectDispatch {
  config: ProjectDispatch;
  updatedAt: number;
  updatedBy: string | null;
}

/** The dispatch as stored, or null when the project has none. A stored
 * document a newer image wrote in a shape this one cannot read reads as
 * none: this image starts nothing on a dispatch it does not understand. */
export async function readStoredDispatch(
  sql: Sql | TransactionSql,
  organizationId: string,
  projectId: string,
): Promise<StoredProjectDispatch | null> {
  const rows = await sql<
    { config: unknown; updatedAt: number; updatedBy: string | null }[]
  >`
    SELECT config, updated_at_ms::float8 AS "updatedAt",
           updated_by AS "updatedBy"
    FROM app.project_dispatch
    WHERE project_id = ${projectId} AND org_id = ${organizationId}
  `;
  const row = rows[0];
  if (row === undefined) return null;
  const parsed = projectDispatchSchema.safeParse(row.config);
  if (!parsed.success) {
    console.warn(
      `[dispatch] project ${projectId}: its stored dispatch does not parse here and is ignored`,
    );
    return null;
  }
  return {
    config: parsed.data,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

/** The value managed configuration reads and writes: the project's id and
 * its dispatch document, flat. */
export type ProjectDispatchConfigurationValue = {
  projectId: string;
} & ProjectDispatch;

export function dispatchConfigurationValue(
  projectId: string,
  config: ProjectDispatch,
): ProjectDispatchConfigurationValue {
  return { projectId, ...config };
}
