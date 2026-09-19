import type { Sql } from 'postgres';

import type { AgentLanguageContext } from '../../../lib/shared/agent-language.ts';
import { getOrganizationDefaultLocale } from '../../../lib/shared/utils/get-organization-default-locale.ts';

/** Resolve only canonical task content, scoped to the run's organization. */
export async function loadAgentLanguageContext(
  sql: Sql,
  args: {
    organizationId: string;
    taskId?: string | null;
    projectIds?: string[];
  },
): Promise<AgentLanguageContext> {
  const rows = await sql<
    {
      metadata: unknown;
      id: string | null;
      title: string | null;
      description: string | null;
    }[]
  >`
    SELECT o.metadata, t.id, t.title, t.description
    FROM "organization" o
    LEFT JOIN app.tasks t ON t.id = ${args.taskId ?? null}
      AND t.org_id = o.id
      AND (${args.projectIds ?? null}::text[] IS NULL OR t.project_id = ANY(${args.projectIds ?? null}::text[]))
    WHERE o.id = ${args.organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  return {
    defaultLocale: getOrganizationDefaultLocale(row?.metadata),
    task:
      row?.id != null && row.title !== null
        ? { id: row.id, title: row.title, description: row.description }
        : null,
  };
}
