/**
 * The writes an automation may make without a person approving each run, as
 * a coding agent reads and changes them (the settings kind
 * `automation-approval`). The writer is the General tab's
 * (`backend/domains/automations/approval-allowances.ts`); these schemas
 * read what an agent sends and describe what it reads back.
 *
 * Nothing here reaches the engine, so the MCP tool inventory — which every
 * settings page lists — can take its descriptions from it.
 */

import { z } from 'zod';

/** How many types one act names. */
const APPROVAL_ACT_TYPES_MAX = 50;

/** A write as a step names it: `<connector>.<action>`. The writer checks
 * that it is a write to an outside system of the catalog. */
const stepType = z.string().min(3).max(200);

/** What the acts `grant` and `revoke` take: the step types to allow without
 * approval, or to withdraw the allowance of. */
export const approvalActArgsSchema = z.strictObject({
  types: z
    .array(stepType)
    .min(1)
    .max(APPROVAL_ACT_TYPES_MAX)
    .describe(
      'Step types, <connector>.<action>: writes to outside systems of the connector catalog.',
    ),
});

/**
 * An automation's allowances as `get_settings` answers them. Read only: the
 * acts change `allowed`, and what is read of the rest follows the latest
 * version and the organization's approval policy. Its hash covers the
 * automation and `allowed` alone, so a new version or a policy edit never
 * makes a plan stale.
 */
export const automationApprovalConfigSchema = z.strictObject({
  automation: z.string().describe("The automation's name."),
  allowed: z
    .array(stepType)
    .describe('Step types that run without approval, in order.'),
  used: z
    .array(stepType)
    .describe('Writes the latest version of the automation makes.'),
  requiredByPolicy: z
    .array(stepType)
    .describe(
      "Of the allowed and the used, the ones a rule of the organization's approval policy still requires a person for, whatever is allowed.",
    ),
  grants: z
    .array(
      z.strictObject({
        type: stepType,
        grantedBy: z
          .string()
          .describe('The id of the person who allowed it, as Tale records it.'),
        grantedByName: z
          .string()
          .nullable()
          .describe(
            'Their name; null for someone who left the organization or has none. Never an address.',
          ),
        grantedAt: z.number().int().describe('When, in epoch milliseconds.'),
      }),
    )
    .describe('Who allowed each of `allowed`, and when.'),
});

export type AutomationApprovalConfig = z.infer<
  typeof automationApprovalConfigSchema
>;
