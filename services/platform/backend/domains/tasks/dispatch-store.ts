import {
  projectDispatchSchema,
  type ProjectDispatch,
} from '@tale/shared/schemas/project-dispatch';
import type { Sql, TransactionSql } from 'postgres';

import { ConfigurationError } from '../../core/lib/config_store/precondition.ts';

/**
 * A project's dispatch document as stored (migration 0206): the one read
 * every reader shares — the pass, the readback and the gates act on it, and
 * the managed configuration (`dispatch-config.ts`, which also writes it)
 * reads it as the preimage of a write.
 */

export interface StoredProjectDispatch {
  config: ProjectDispatch;
  updatedAt: number;
  updatedBy: string | null;
}

async function readDispatchRow(
  sql: Sql | TransactionSql,
  organizationId: string,
  projectId: string,
): Promise<StoredProjectDispatch | 'unreadable' | null> {
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
  if (!parsed.success) return 'unreadable';
  return {
    config: parsed.data,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

/** The dispatch as stored, or null when the project has none. A stored
 * document a newer image wrote in a shape this one cannot read reads as
 * none: this image starts nothing on a dispatch it does not understand. */
export async function readStoredDispatch(
  sql: Sql | TransactionSql,
  organizationId: string,
  projectId: string,
): Promise<StoredProjectDispatch | null> {
  const stored = await readDispatchRow(sql, organizationId, projectId);
  if (stored !== 'unreadable') return stored;
  console.warn(
    `[dispatch] project ${projectId}: its stored dispatch does not parse here and is ignored`,
  );
  return null;
}

/**
 * The dispatch a write replaces, and that managed configuration reads to
 * plan one: null only when the project has none. A stored document this
 * image cannot read is refused (`CONFIG_UNREADABLE`) rather than read as
 * none, as every managed preimage is (`configSnapshot`): reading it as none
 * would let a plan create over it, and a save replace a document a newer
 * image wrote with one that drops what this image does not know.
 */
export async function readDispatchPreimage(
  sql: Sql | TransactionSql,
  organizationId: string,
  projectId: string,
): Promise<StoredProjectDispatch | null> {
  const stored = await readDispatchRow(sql, organizationId, projectId);
  if (stored !== 'unreadable') return stored;
  throw new ConfigurationError(
    'CONFIG_UNREADABLE',
    'The project’s stored dispatch cannot be read by this version of Tale, and is kept as it is. Upgrade Tale, or repair the stored dispatch, before changing it.',
  );
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
