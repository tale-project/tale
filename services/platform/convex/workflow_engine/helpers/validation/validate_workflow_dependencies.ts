import type { WorkflowIntegrationDependency } from '../../../../lib/shared/schemas/workflows';
import type { QueryCtx } from '../../../_generated/server';

export interface MissingIntegrationDependency {
  name: string;
  reason: 'not_installed' | 'missing_operations';
  missingOperations?: string[];
}

export class WorkflowDependencyError extends Error {
  readonly workflowSlug?: string;
  readonly missingIntegrations: MissingIntegrationDependency[];

  constructor(
    missingIntegrations: MissingIntegrationDependency[],
    workflowSlug?: string,
  ) {
    const summary = missingIntegrations
      .map((dep) =>
        dep.reason === 'not_installed'
          ? `"${dep.name}" not installed`
          : `"${dep.name}" missing operations: ${(dep.missingOperations ?? []).join(', ')}`,
      )
      .join('; ');
    super(
      workflowSlug
        ? `Workflow "${workflowSlug}" cannot run: ${summary}`
        : `Workflow dependency check failed: ${summary}`,
    );
    this.name = 'WorkflowDependencyError';
    this.workflowSlug = workflowSlug;
    this.missingIntegrations = missingIntegrations;
  }
}

interface IntegrationCredentialRow {
  status: 'active' | 'inactive' | 'error' | 'testing';
}

interface IntegrationConnector {
  operations: Array<{ name: string }>;
  version?: number;
}

export interface ValidateWorkflowDependenciesArgs {
  organizationId: string;
  workflowSlug?: string;
  requires: { integrations?: WorkflowIntegrationDependency[] } | undefined;
}

/**
 * Validate that every integration the workflow declares as required is
 * installed (and exposes any required operations) for the given organization.
 *
 * Throws WorkflowDependencyError if any are missing. No-op if the workflow has
 * no `requires` block.
 */
export async function validateWorkflowDependencies(
  ctx: QueryCtx,
  args: ValidateWorkflowDependenciesArgs,
  loadConnectorOps?: (slug: string) => Promise<IntegrationConnector | null>,
): Promise<void> {
  const integrations = args.requires?.integrations ?? [];
  if (integrations.length === 0) return;

  const missing: MissingIntegrationDependency[] = [];

  for (const dep of integrations) {
    const cred = await ctx.db
      .query('integrationCredentials')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('slug', dep.name),
      )
      .first();

    if (!cred || (cred as IntegrationCredentialRow).status === 'inactive') {
      missing.push({ name: dep.name, reason: 'not_installed' });
      continue;
    }

    if (dep.operations && dep.operations.length > 0 && loadConnectorOps) {
      const connector = await loadConnectorOps(dep.name);
      if (connector) {
        const available = new Set(connector.operations.map((op) => op.name));
        const missingOps = dep.operations.filter((op) => !available.has(op));
        if (missingOps.length > 0) {
          missing.push({
            name: dep.name,
            reason: 'missing_operations',
            missingOperations: missingOps,
          });
        }
      }
    }
  }

  if (missing.length > 0) {
    throw new WorkflowDependencyError(missing, args.workflowSlug);
  }
}
