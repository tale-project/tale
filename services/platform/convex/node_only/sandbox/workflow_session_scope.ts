/**
 * Pure builder for the session-token `scope` a WORKFLOW/task sandbox-agent run
 * mints (`workflow_sandbox_exec.ts` → `insertSessionToken`). Extracted so the
 * grant plumbing is unit-testable: the dispatch surfaces enforce exactly what
 * this object says, and the two historical regressions — omitting `toolGrants`
 * entirely, and narrowing `integrationGrants` to the credential-broker subset
 * (`BROKERABLE_GRANTS`) — were invisible without a test on this seam.
 *
 * Chat-turn parity (`run_external_agent.ts` mint), minus the fields a
 * workflow run genuinely lacks: no `threadId`/`userId` (autonomous — the
 * dispatch treats both as optional; document_write's approval then fails
 * clean instead of rendering a card).
 */

export interface WorkflowSessionTokenScope {
  agentKind: string;
  allowedModels: string[];
  /**
   * The agent's FULL `integrationBindings` — the dispatch grant set for
   * `/api/integrations/execute`. NOT the `BROKERABLE_GRANTS` intersection:
   * that subset governs only which raw credentials (e.g. GITHUB_TOKEN) are
   * injected into the container env, never which integrations the platform
   * will execute on the agent's behalf.
   */
  integrationGrants: string[];
  /** The agent's `toolNames` → `/api/tools/execute` grant set. */
  toolGrants: string[];
  /**
   * Lets the tool dispatch re-resolve the agent's knowledge scope so
   * rag_search sees the same allow-list a loop turn would.
   */
  agentSlug: string;
  budgetCents: number;
}

export function buildWorkflowSessionTokenScope(input: {
  agentKind: string;
  allowedModels: string[];
  integrationBindings: readonly string[];
  toolNames: readonly string[] | undefined;
  agentSlug: string;
  budgetCents: number;
}): WorkflowSessionTokenScope {
  return {
    agentKind: input.agentKind,
    allowedModels: input.allowedModels,
    integrationGrants: [...input.integrationBindings],
    toolGrants: [...(input.toolNames ?? [])],
    agentSlug: input.agentSlug,
    budgetCents: input.budgetCents,
  };
}
