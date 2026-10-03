import type { Sql, TransactionSql } from 'postgres';

export interface TaskReviewSource {
  runId: string;
  implementationAgentId: string;
  status: string;
  settledAt: number | null;
  evidenceRevision: string;
}

/** One exact task/source snapshot, shared by the read and the decision.
 * Hash content, not updated_at: a priority edit is harmless, while editing
 * or deleting even an older discussion message must invalidate a review.
 * Discussion bodies stay in Postgres; only their ordered SHA-256 digests
 * enter the outer hash. JSONB gives object keys one canonical ordering.
 * This binds local evidence only. External PR heads remain agent-attested. */
export async function readTaskReviewSource(
  sql: Sql | TransactionSql,
  args: { organizationId: string; taskId: string; runId: string },
): Promise<TaskReviewSource | null> {
  const rows = await sql<TaskReviewSource[]>`
    SELECT r.id AS "runId", r.agent_id AS "implementationAgentId", r.status,
           r.settled_at_ms::float8 AS "settledAt",
           encode(sha256(convert_to(jsonb_build_array(
             t.id, t.org_id, t.project_id, t.title, t.description,
             t.attachments, t.outputs, t.label_ids, t.parent_task_id,
             t.assignee_type, t.assignee_id, t.external_system, t.external_id,
             t.external_url, t.external_source_id, t.external_issue,
             r.id, r.agent_id, r.status, r.result_text, r.result_message_id,
             r.settled_at_ms,
             coalesce((
               SELECT jsonb_agg(
                 encode(sha256(convert_to(jsonb_build_array(
                   m.id, m.text, d.author_type, d.author_id, d.body_by_locale
                 )::text, 'UTF8')), 'hex') ORDER BY m.id
               )
               FROM app.task_discussion_message_meta d
               JOIN app.messages m ON m.id = d.message_id AND m.org_id = d.org_id
               WHERE d.org_id = t.org_id AND d.task_id = t.id
             ), '[]'::jsonb)
           )::text, 'UTF8')), 'hex') AS "evidenceRevision"
    FROM app.project_agent_runs r
    JOIN app.tasks t ON t.id = r.task_id AND t.org_id = r.org_id
      AND t.project_id = r.project_id
    WHERE r.id = ${args.runId} AND r.org_id = ${args.organizationId}
      AND r.task_id = ${args.taskId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}
