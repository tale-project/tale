import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Customer support portal schema (issue #1923).
 *
 * A support case is a customer-facing ticket worked by designated support staff
 * through its lifecycle (open → closed), with escalation, SLA tracking and a
 * comment thread. Cases are ORG-SCOPED, not project-scoped: support staff see
 * every case in their organization (`support_cases/helpers.ts`), in contrast to
 * the project-member-scoped {@link tasksTable}. This is the new surface the
 * issue calls out as missing — the existing internal `tasks` board stays
 * project-internal.
 *
 * Polymorphic single assignee mirrors `tasks`: a case is assigned to exactly
 * one actor that is EITHER a human user OR an AI agent (e.g. the builtin
 * a support agent). `assigneeType` + `assigneeId` are set/cleared
 * together (invariant enforced in the mutation layer). `assigneeId` is a
 * `string` — not a typed Id — because it polymorphically holds either a Better
 * Auth userId or an agent slug.
 *
 * Soft-delete via `archivedAt` (mirrors `tasks.archivedAt`).
 */

/**
 * Case lifecycle. `open` and `closed` are the two endpoints the issue requires;
 * `pending` (awaiting customer/third party) and `resolved` (fixed, pending
 * confirmation before close) are the standard intermediate helpdesk states.
 * Escalation is tracked SEPARATELY in `escalationLevel` — an escalated case is
 * still `open`, so the two axes compose rather than collide.
 */
export const supportCaseStatusValidator = v.union(
  v.literal('open'),
  v.literal('pending'),
  v.literal('resolved'),
  v.literal('closed'),
);

export const supportCasePriorityValidator = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('urgent'),
);

/**
 * Polymorphic actor type: a human user or an AI agent. Matches
 * `taskActorTypeValidator` (human-vs-agent authorship) — kept local to this
 * feature so the support domain owns its own validator rather than importing
 * across feature boundaries.
 */
export const supportCaseActorTypeValidator = v.union(
  v.literal('user'),
  v.literal('agent'),
);

export const supportCasesTable = defineTable({
  organizationId: v.string(),

  // Content
  subject: v.string(),
  description: v.optional(v.string()),

  // Lifecycle + triage
  status: supportCaseStatusValidator,
  priority: v.optional(supportCasePriorityValidator),

  // Escalation ladder. 0 (or undefined) = not escalated; each escalation bumps
  // the level by one and stamps `escalatedAt`. A case can be escalated while
  // staying `open` — status and escalation are orthogonal axes.
  escalationLevel: v.optional(v.number()),
  escalatedAt: v.optional(v.number()),

  // Polymorphic single assignee (set/cleared together; see header).
  assigneeType: v.optional(supportCaseActorTypeValidator),
  assigneeId: v.optional(v.string()),

  // The contact this case is for (issue #2618). Optional — a case can be opened
  // against a free-text requester before the contact record exists.
  // `requesterEmail` / `requesterName` capture the reporter when there is no
  // linked contact (e.g. inbound email from an unknown address).
  contactId: v.optional(v.id('contacts')),
  requesterEmail: v.optional(v.string()),
  requesterName: v.optional(v.string()),

  // Case-level SLA. `slaDueAt` is the deadline a first resolution is expected
  // by; `firstRespondedAt` / `resolvedAt` / `closedAt` stamp the lifecycle
  // milestones used for SLA reporting and the overdue badge.
  slaDueAt: v.optional(v.number()),
  firstRespondedAt: v.optional(v.number()),
  resolvedAt: v.optional(v.number()),
  closedAt: v.optional(v.number()),

  // Denormalized count of non-deleted comments, maintained by the comment
  // add/delete mutations so the list can render a comment indicator without an
  // N+1 fetch. Treat undefined as 0.
  commentCount: v.optional(v.number()),

  // When the case last changed status — powers age-in-state chips and stale
  // detection without scanning the activity feed. Legacy rows fall back to
  // `updatedAt`.
  statusChangedAt: v.optional(v.number()),

  // Authorship + lifecycle
  createdBy: v.string(),
  createdByType: supportCaseActorTypeValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  archivedAt: v.optional(v.number()),
})
  .index('by_organization', ['organizationId'])
  .index('by_org_status', ['organizationId', 'status'])
  .index('by_org_updatedAt', ['organizationId', 'updatedAt'])
  .index('by_org_escalation', ['organizationId', 'escalationLevel'])
  .index('by_assignee', ['organizationId', 'assigneeType', 'assigneeId'])
  .index('by_contact', ['contactId'])
  // Due-soon / overdue SLA sweeps.
  .index('by_org_sla', ['organizationId', 'slaDueAt']);

/**
 * A comment on a support case. `internal: true` marks a staff-only note (never
 * shown to the customer in the portal); a normal comment is part of the
 * customer-visible conversation. `authorType` distinguishes a human agent reply
 * from an AI-agent draft. Hard-deleted (with a `commentCount` decrement) rather
 * than soft-deleted, mirroring the task-comment surface.
 */
export const supportCaseCommentsTable = defineTable({
  organizationId: v.string(),
  caseId: v.id('supportCases'),
  authorType: supportCaseActorTypeValidator,
  authorId: v.string(),
  body: v.string(),
  // Staff-only note vs. customer-visible reply. Treat undefined as false
  // (customer-visible).
  internal: v.optional(v.boolean()),
  createdAt: v.number(),
  editedAt: v.optional(v.number()),
}).index('by_case', ['caseId', 'createdAt']);

/**
 * Append-only per-case activity timeline (status / escalation / assignee
 * changes). The product-facing "Activity" feed — intentionally distinct from
 * the org-wide governance `auditLogs` compliance trail, mirroring
 * `taskActivity`. The creation row uses `action: 'created'`.
 */
export const supportCaseActivityTable = defineTable({
  organizationId: v.string(),
  caseId: v.id('supportCases'),
  actorType: supportCaseActorTypeValidator,
  actorId: v.string(),
  action: v.string(),
  fromValue: v.optional(v.string()),
  toValue: v.optional(v.string()),
  createdAt: v.number(),
})
  .index('by_case', ['caseId', 'createdAt'])
  .index('by_organization', ['organizationId']);
