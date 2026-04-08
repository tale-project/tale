import type { GenericQueryCtx } from 'convex/server';

import type {
  DefaultModelsConfig,
  DefaultModelRule,
} from '../../lib/shared/schemas/governance';
import type { DataModel } from '../_generated/dataModel';
import { readPolicyConfig } from './helpers';

interface DefaultModelOverride {
  providerName: string;
  modelId: string;
}

/**
 * Find the most specific model rule that applies.
 * Priority: team > role > default
 */
function findApplicableModelRule(
  rules: DefaultModelRule[],
  teamIds: string[],
  userRole?: string,
): DefaultModelRule | null {
  const teamRule = rules.find(
    (r) => r.scope === 'team' && r.scopeId && teamIds.includes(r.scopeId),
  );
  if (teamRule) return teamRule;

  if (userRole) {
    const roleRule = rules.find(
      (r) => r.scope === 'role' && r.scopeId === userRole,
    );
    if (roleRule) return roleRule;
  }

  return rules.find((r) => r.scope === 'default') ?? null;
}

/**
 * Resolve the default model override for a user based on governance policies.
 *
 * Returns the provider/model override or null if no governance override exists.
 */
export async function resolveDefaultModel(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
  teamIds: string[],
  userRole?: string,
): Promise<DefaultModelOverride | null> {
  const config = await readPolicyConfig<DefaultModelsConfig>(
    ctx,
    organizationId,
    'default_models',
  );

  if (!config || !config.enabled || config.rules.length === 0) {
    return null;
  }

  const rule = findApplicableModelRule(config.rules, teamIds, userRole);
  if (!rule) {
    return null;
  }

  return { providerName: rule.providerName, modelId: rule.modelId };
}
