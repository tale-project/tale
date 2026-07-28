/**
 * The automation's TASK-SURFACE contract — one declaration every task surface
 * consumes: the task modal's status choreography, the folder input card,
 * board-side template creation, and the ownership badge. Ported from the
 * pre-rewrite task-automation contract; on the rebuilt engine it lives with
 * the automation VERSION in the store (seeded from a pack's `automation.yml
 * subjects:` block or the upload dialog) rather than in a bundle manifest.
 *
 * A task is bound to its owning automation via `createdByType: 'app'` +
 * `createdBy: <automation name>` (write-once at creation); tasks born before
 * ownership stamping resolve via the `externalSystem` namespace instead.
 */

import { z } from 'zod/v4';

/** Localizable strings of the create-flow's single input field (the
 *  subject's natural key, e.g. the quarter folder name). */
const taskSubjectFieldTextSchema = z.object({
  label: z.string().optional(),
  placeholder: z.string().optional(),
  help: z.string().optional(),
});

export const taskSubjectContractSchema = z.object({
  /** Automation the task-surface Start / Request-changes choreography runs
   *  (`startTaskWorkflow`; this is the automation's own store name). */
  workflow: z.string().min(1),
  /** Dedup namespace stamped on owned tasks (`tasks.externalSystem`) — also
   *  the ownership fallback for tasks created before name stamping. */
  externalSystem: z.string().min(1).optional(),
  /** What the task's external binding IS. `folder`: `externalId` holds a
   *  project root folder id — the task modal swaps its Attachments zone for
   *  the folder's upload card so input lands where the run reads it. */
  input: z
    .object({
      kind: z.literal('folder'),
      /** Anchored regex the folder name must match at template-create time
       *  (e.g. "^\\d{4}Q[1-4]$" for VAT quarters). */
      naming: z.string().optional(),
      /** Sibling setup folder resolved into `externalUrl` on create (the
       *  desks' binding convention; create fails closed when missing). */
      setupFolderName: z.string().optional(),
    })
    .optional(),
  /** Board-side template creation ("New quarter" from the task board). */
  create: z
    .object({
      enabled: z.boolean(),
      /** Title derived from the input value; `{name}` is the only token. */
      titleTemplate: z.string().optional(),
      /** Literal description for the created task. */
      description: z.string().optional(),
      field: taskSubjectFieldTextSchema
        .extend({
          i18n: z.record(z.string(), taskSubjectFieldTextSchema).optional(),
        })
        .optional(),
    })
    .optional(),
  /** Start gating over the task facts (`when_predicate` grammar; variables:
   *  `status`, `hasFiles`). Absent ⇒ status moves never start a run. */
  start: z.object({ when: z.string().optional() }).optional(),
  /** Review affordances: `requestChanges` maps In review → In progress onto
   *  comment-then-rerun (the same `startTaskWorkflow` path as Start). */
  review: z.object({ requestChanges: z.boolean().optional() }).optional(),
  /**
   * The deliverables — what a reviewer opens the task FOR. The task surface
   * promotes these out of the bound folder into an always-open Outcome zone
   * (everything else in the folder stays under the collapsed Files zone), and
   * names them as promised rows before a run has filed them.
   *
   * Only the automation knows which of its written files are the point and
   * which are working material, so the list is declared here rather than
   * guessed platform-side. Absent ⇒ the surface falls back to provenance: every
   * file a run filed shows as outcome.
   */
  outcome: z
    .object({
      /** File names in the bound folder, in the order to show them. `*` and
       *  `?` wildcards are honoured (`*.xml`), so a run-derived name can be
       *  declared too — an exact name doubles as the promised row's label. */
      files: z.array(z.string().min(1)).min(1),
    })
    .optional(),
});

export type TaskSubjectContract = z.infer<typeof taskSubjectContractSchema>;

/** Tolerant read of a stored contract: an unparsable value reads as none —
 * the task surfaces then treat the automation as contract-less rather than
 * failing to render. */
export function parseTaskSubjectContract(
  value: unknown,
): TaskSubjectContract | null {
  const parsed = taskSubjectContractSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
