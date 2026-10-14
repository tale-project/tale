/**
 * The places an automation's steps carry on from between its runs
 * (migration 0213): the store behind `automation.read_position` and
 * `automation.save_position`.
 *
 * A place is keyed by the automation and the project of the asking run — the
 * run is looked up by its id, so a step only ever reaches its own
 * automation's places — and by the step's own key. A save names the revision
 * its run read and lands only while the place still holds it; each save draws
 * a new revision from a sequence, so a revision never repeats and a save
 * from an overlapping run, or from one that read before another run saved,
 * is refused instead of moving the place back. A place nothing was saved
 * under reads as `null` at revision `0`, and the first save creates it.
 * Deleting the automation deletes its places (`deleteAutomationCascade`).
 */

import type { Sql } from 'postgres';

import {
  NO_POSITION_REVISION,
  type WorkflowAutomationPositions,
} from '../../../lib/connectors/natives/platform-automation.ts';
import { toJson } from '../../db/sql.ts';

export function pgAutomationPositions(sql: Sql): WorkflowAutomationPositions {
  return {
    async read({ organizationId, runId, key }) {
      const rows = await sql<{ value: unknown; revision: string }[]>`
        SELECT p.value, p.revision::text AS revision
        FROM app.automation_runs r
        JOIN app.automation_positions p
          ON p.org_id = r.org_id
         AND p.automation_name = r.name
         AND p.project_id = coalesce(r.project_id, '')
         AND p.key = ${key}
        WHERE r.org_id = ${organizationId} AND r.id = ${runId}
      `;
      const row = rows[0];
      return row === undefined
        ? { value: null, revision: NO_POSITION_REVISION }
        : { value: row.value, revision: row.revision };
    },

    async save({ organizationId, runId, key, value, revision }) {
      return sql.begin(async (tx) => {
        const runs = await tx<{ name: string; projectId: string }[]>`
          SELECT name, coalesce(project_id, '') AS "projectId"
          FROM app.automation_runs
          WHERE org_id = ${organizationId} AND id = ${runId}
        `;
        const run = runs[0];
        if (run === undefined) return null;
        const now = Date.now();
        const json = tx.json(toJson(value));
        const written =
          revision === NO_POSITION_REVISION
            ? await tx<{ revision: string }[]>`
                INSERT INTO app.automation_positions (
                  org_id, automation_name, project_id, key, value, revision,
                  run_id, updated_at_ms
                ) VALUES (
                  ${organizationId}, ${run.name}, ${run.projectId}, ${key}, ${json},
                  nextval('app.automation_position_revisions'), ${runId}, ${now}
                )
                ON CONFLICT (org_id, automation_name, project_id, key) DO NOTHING
                RETURNING revision::text AS revision
              `
            : await tx<{ revision: string }[]>`
                UPDATE app.automation_positions
                SET value = ${json},
                    revision = nextval('app.automation_position_revisions'),
                    run_id = ${runId},
                    updated_at_ms = ${now}
                WHERE org_id = ${organizationId}
                  AND automation_name = ${run.name}
                  AND project_id = ${run.projectId}
                  AND key = ${key}
                  AND revision = ${revision}::bigint
                RETURNING revision::text AS revision
              `;
        const landed = written[0];
        if (landed !== undefined) {
          return { saved: true, conflict: false, revision: landed.revision };
        }
        // Another save moved the place since this run read it, or it was
        // never there to update: nothing changed, and the answer says where
        // the place stands.
        const current = await tx<{ revision: string }[]>`
          SELECT revision::text AS revision FROM app.automation_positions
          WHERE org_id = ${organizationId} AND automation_name = ${run.name}
            AND project_id = ${run.projectId} AND key = ${key}
        `;
        return {
          saved: false,
          conflict: true,
          revision: current[0]?.revision ?? NO_POSITION_REVISION,
        };
      });
    },
  };
}
