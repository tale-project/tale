import type { Sql } from 'postgres';

import { AGENT_TOOL_CATALOG } from '../../core/sandbox/tool_names.ts';
import {
  listComposerModels,
  listProjectCapabilities,
} from '../chat/composer.ts';

/**
 * What a project agent may be equipped with — checked against the SAME
 * listings the in-app dialog offers, so a machine caller is held to what
 * a person could have picked. Each check answers a refusal (the code and
 * the sentence the door puts on the wire) or null; the service turns it
 * into its `ProjectError`. The refusals used to be silent: a model the
 * organization cannot call or a provider that does not exist was stored
 * with a 201 and failed unattended at the first task start; unknown tool
 * grants were dropped to an empty list; unknown skills and connectors were
 * stored verbatim.
 */

export interface EquipmentRefusal {
  code: string;
  message: string;
}

/** The grant names the catalog does not carry, in the order sent. */
export function unknownToolGrants(tools: readonly string[]): string[] {
  const known = new Set<string>(AGENT_TOOL_CATALOG.map((tool) => tool.name));
  return [...new Set(tools.filter((tool) => !known.has(tool)))];
}

/** Every grantable tool name, in catalog order — the vocabulary a refusal
 * and the OpenAPI document both name. */
export const AGENT_TOOL_GRANT_NAMES: readonly string[] = AGENT_TOOL_CATALOG.map(
  (tool) => tool.name,
);

/**
 * Whether (`model`, `modelProvider`) is a pair this organization can call,
 * from the composer's servable listing (governance model access applied for
 * the configuring user). A subscription-served entry runs only in the
 * harness its credential is bound to, so it counts only for that harness.
 */
export async function agentModelRefusal(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    harness: string;
    model: string;
    modelProvider?: string;
  },
): Promise<EquipmentRefusal | null> {
  const { models } = await listComposerModels(sql, {
    organizationId: args.organizationId,
    userId: args.userId,
  });
  const hint =
    'GET /api/v1/models lists the models and providers this organization can call.';
  if (
    args.modelProvider !== undefined &&
    !models.some((option) => option.providerSlug === args.modelProvider)
  ) {
    return {
      code: 'PROJECT_AGENT_PROVIDER_UNKNOWN',
      message: `Unknown provider "${args.modelProvider}". ${hint}`,
    };
  }
  const candidates = models.filter(
    (option) =>
      option.id === args.model &&
      (args.modelProvider === undefined ||
        option.providerSlug === args.modelProvider),
  );
  if (candidates.length === 0) {
    return {
      code: 'PROJECT_AGENT_MODEL_INVALID',
      message:
        args.modelProvider === undefined
          ? `Model "${args.model}" is not available to this organization. ${hint}`
          : `Provider "${args.modelProvider}" does not serve model "${args.model}". ${hint}`,
    };
  }
  const servesHarness = candidates.some((option) => {
    const credential = option.credential;
    return credential.authMethod === 'api-key' ||
      credential.authMethod === 'env'
      ? true
      : credential.constraints.harness === args.harness;
  });
  if (!servesHarness) {
    const bound = [
      ...new Set(
        candidates.flatMap((option) =>
          option.credential.authMethod === 'api-key' ||
          option.credential.authMethod === 'env'
            ? []
            : [option.credential.constraints.harness],
        ),
      ),
    ];
    return {
      code: 'PROJECT_AGENT_MODEL_INVALID',
      message: `Model "${args.model}" is served by a subscription bound to the ${bound.join(', ')} harness, not ${args.harness}. ${hint}`,
    };
  }
  return null;
}

/**
 * Whether every skill and connector named is one the project's agents can
 * equip — the skills visible to the project and the organization's
 * CONNECTED connectors, exactly the dialog's own listing.
 */
export async function agentEquipmentRefusal(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    projectId: string;
    skills: readonly string[];
    connectors: readonly string[];
  },
): Promise<EquipmentRefusal | null> {
  if (args.skills.length === 0 && args.connectors.length === 0) return null;
  const capabilities = await listProjectCapabilities(sql, {
    organizationId: args.organizationId,
    userId: args.userId,
    projectId: args.projectId,
  });
  const skills = new Set(capabilities.skills.map((skill) => skill.slug));
  const unknownSkills = args.skills.filter((slug) => !skills.has(slug));
  if (unknownSkills.length > 0) {
    return {
      code: 'PROJECT_AGENT_SKILL_UNKNOWN',
      message: `Unknown skills: ${unknownSkills.join(', ')}. GET /api/v1/skills lists the skills this project's agents can use.`,
    };
  }
  const connectors = new Set(
    capabilities.connectors.map((connector) => connector.slug),
  );
  const unknownConnectors = args.connectors.filter(
    (slug) => !connectors.has(slug),
  );
  if (unknownConnectors.length > 0) {
    return {
      code: 'PROJECT_AGENT_CONNECTOR_UNKNOWN',
      message: `Unknown or unconnected connectors: ${unknownConnectors.join(', ')}. An agent can use the connectors this organization has connected: ${[...connectors].sort().join(', ') || 'none yet'}.`,
    };
  }
  return null;
}
