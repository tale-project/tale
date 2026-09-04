/**
 * The `review_policy` refusal codes the task-review gate throws. Shared with
 * `domains/tasks/service.ts`, whose batch door (`bulkUpdateTasks`) skips a
 * task on one of these instead of aborting the whole batch. The gate itself —
 * reviewer resolution, the mint, the close-on-leave — lives in
 * `domains/tasks/reviews.ts`.
 */

export const REVIEW_POLICY_REFUSAL_CODES = [
  'REVIEW_INDEPENDENT_REVIEWER_REQUIRED',
  'REVIEW_COMPETENCE_REQUIRED',
] as const;
