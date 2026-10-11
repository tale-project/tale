/**
 * WHICH live writes hold for a human — the rule, kept pure and away from the
 * gate's record-keeping so it can be read and tested on its own.
 *
 * The gate exists to catch a write LEAVING the tenant. A connector that holds
 * vendor credentials (mail, GitHub, Slack, a WebDAV share) acts on the outside
 * world, and a person should see it first. A connector that declares
 * `auth: platform` IS the platform — tasks, documents, the organization's own
 * sandbox — and its writes are already bound by the platform's own
 * authorization; the automation performing them passed the deploy gate, and
 * the run records every effect. Asking a human to approve "move this card to
 * In progress" buys nothing and buries the approvals that matter (one
 * document-verify-desk run used to need six).
 *
 * An organization can override either way through the `approval_policy`
 * governance file: a rule naming one `action` beats a rule naming its
 * `connector`, and either beats the built-in default.
 *
 * Between the two sits an automation's allowance: an owner or admin let ONE
 * automation make this write without a person. It allows where the default
 * would ask, and yields to any rule — a rule that requires a person for the
 * action still requires one, whatever an automation was allowed.
 */

import type { ApprovalPolicyConfig } from '@tale/shared/schemas/governance';

export type ApprovalRequirement = 'allow' | 'require';

export interface ApprovalDecisionInput {
  /** The connector slug, e.g. `task` or `github`. */
  connector: string;
  /** The action name within the connector, e.g. `update_status`. */
  action: string;
  /**
   * Whether this write stays inside the tenant's own platform surface — TRUE
   * for a `platform`-auth connector. The callers pass it because the connector
   * catalog is read from disk and a V8 mutation cannot reach it.
   */
  platformInternal: boolean;
  /** The org's parsed policy, or null when it has none on file. */
  policy: ApprovalPolicyConfig | null;
  /** Whether an owner or admin allowed the automation making this write to
   * make it without a person. Absent outside an automation's step. */
  allowance?: boolean;
}

/** Whether this write runs straight away and on whose word, or waits. */
export type ApprovalDecision =
  | { requirement: 'require' }
  | { requirement: 'allow'; by: 'rule' | 'allowance' | 'platform' };

/**
 * The most specific rule that speaks about this operation, or `null`.
 * Action-level rules win over connector-level ones; within the same
 * specificity the LAST matching rule wins, so an operator appending a line
 * changes the outcome rather than being silently shadowed.
 */
function matchingRule(
  args: ApprovalDecisionInput,
): ApprovalPolicyConfig['rules'][number] | null {
  const rules = args.policy?.rules ?? [];
  const qualified = `${args.connector}.${args.action}`;
  let connectorMatch: ApprovalPolicyConfig['rules'][number] | null = null;
  let actionMatch: ApprovalPolicyConfig['rules'][number] | null = null;
  for (const rule of rules) {
    if (rule.action === qualified) actionMatch = rule;
    else if (rule.connector === args.connector) connectorMatch = rule;
  }
  return actionMatch ?? connectorMatch;
}

/** Whether this write runs straight away, on whose word, or waits. */
export function resolveApprovalDecision(
  args: ApprovalDecisionInput,
): ApprovalDecision {
  const rule = matchingRule(args);
  if (rule !== null) {
    return rule.decision === 'auto_approve'
      ? { requirement: 'allow', by: 'rule' }
      : { requirement: 'require' };
  }
  if (args.allowance === true) return { requirement: 'allow', by: 'allowance' };
  return args.platformInternal
    ? { requirement: 'allow', by: 'platform' }
    : { requirement: 'require' };
}

/** Whether this write runs straight away or waits for a person. */
export function resolveApprovalRequirement(
  args: ApprovalDecisionInput,
): ApprovalRequirement {
  return resolveApprovalDecision(args).requirement;
}
