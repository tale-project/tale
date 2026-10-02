import type { Fragment, Sql, TransactionSql } from 'postgres';

/**
 * Where a task holds a blob: `app.tasks.attachments` and `app.tasks.outputs`
 * are JSON lists whose `fileId` IS the blob ref (`s3:<key>`), written by the
 * task door (`service.ts`) and the run harvest — never by a file row, so a
 * ref a task lists has no row of its own for the row-driven liveness checks
 * to find. Before this predicate, every lane that asks "may the bytes go?"
 * — `knowledge/liveness.ts` (the release seam), `files/service.ts`'
 * `deleteFile`, the abandoned-upload sweep — looked at `file_metadata` and
 * `documents` alone, so a file row deleted under a task took the task's
 * bytes with it: the card kept showing the file, and every run start met
 * the store's 404 (2026-10-02).
 *
 * ONE predicate, used by every such lane and by the task door's own release
 * (`retire.ts`): some task of the organization lists `ref` in either
 * column. `ref` is a fragment, so a caller passes a parameter
 * (``sql`${ref}` ``) or a column of its own query (``sql`r.ref` ``). The
 * containment test is JSONB `@>` over `[{"fileId": <ref>}]`, which matches
 * an element however many other keys it carries; the two columns are
 * concatenated (NULL read as the empty list) so the needle is built once.
 * The `::text` is load-bearing for the parameter form: `jsonb_build_object`
 * takes "any", so Postgres cannot infer a bare parameter's type there
 * ("could not determine data type of parameter", seen on real Postgres).
 */
export function taskHoldsBlobRef(
  sql: Sql | TransactionSql,
  organizationId: string,
  ref: Fragment,
): Fragment {
  return sql`EXISTS (
    SELECT 1 FROM app.tasks held
    WHERE held.org_id = ${organizationId}
      AND (coalesce(held.attachments, '[]'::jsonb)
           || coalesce(held.outputs, '[]'::jsonb))
          @> jsonb_build_array(jsonb_build_object('fileId', ${ref}::text))
  )`;
}
