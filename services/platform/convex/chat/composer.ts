'use node';

/**
 * What the composer's model picker offers, resolved for one organization.
 *
 * The picker shows two groups. MODELS lists the models a turn can call
 * directly; a model appears only when the org has an ACTIVE credential for the
 * connector that lists it — resolved through the SAME connector set and
 * catalog a turn resolves (`resolveConnectorsForOrgId` + `getConnectorCatalog`)
 * — so the picker never offers a model no configured credential could serve.
 * Each model carries the credential's auth shape in the exact form
 * `resolveExecution` reads, so the composer's sandbox toggle locks (or stays
 * free) by asking the resolver, never by re-deriving the rule in the UI.
 *
 * SANDBOX AGENTS lists the shipped harnesses: a harness is a deployment
 * capability, offered whenever the sandbox image ships it.
 *
 * `'use node'` by necessity — reading the model catalogs, the harness files,
 * and the org's custom connectors is filesystem work.
 */

import { v, type Infer } from 'convex/values';

import type { CredentialAuth } from '../../lib/shared/providers/resolve_execution';
import type { ProviderConnector } from '../../lib/shared/schemas/providers';
import { api } from '../_generated/api';
import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { getConnectorCatalog } from '../lib/providers/catalog_fetch';
import { loadHarnesses } from '../lib/providers/load_system_config';
import { resolveConnectorsForOrgId } from '../lib/providers/org_connectors';

/** The forced-execution constraints a subscription credential carries. */
const executionConstraintsValidator = v.object({
  execution: v.literal('sandbox'),
  harness: v.string(),
});

/**
 * The credential facts execution resolution reads, mirroring
 * {@link CredentialAuth}: the plain methods carry only their name; the
 * subscription methods carry the harness they are bound to.
 */
const credentialAuthValidator = v.union(
  v.object({ authMethod: v.literal('api-key') }),
  v.object({ authMethod: v.literal('env') }),
  v.object({
    authMethod: v.literal('subscription-key'),
    constraints: executionConstraintsValidator,
  }),
  v.object({
    authMethod: v.literal('subscription-broker'),
    constraints: executionConstraintsValidator,
  }),
);

const composerModelOptionValidator = v.object({
  id: v.string(),
  label: v.string(),
  providerSlug: v.string(),
  credential: credentialAuthValidator,
});

const composerSandboxAgentValidator = v.object({
  harness: v.string(),
  label: v.string(),
});

type ComposerModelOption = Infer<typeof composerModelOptionValidator>;
type ComposerSandboxAgentOption = Infer<typeof composerSandboxAgentValidator>;
type CredentialAuthMethod = ComposerModelOption['credential']['authMethod'];

/**
 * The credential's auth shape as `resolveExecution` reads it, taken from the
 * connector's own declaration of that method (subscription constraints live on
 * the connector, not the credential row). Returns `null` when the connector
 * does not offer the method the credential names — a stale credential for a
 * method the connector dropped — so the model is simply not listed.
 */
function credentialAuthFor(
  connector: ProviderConnector,
  authMethod: CredentialAuthMethod,
): CredentialAuth | null {
  const entry = connector.auth.find(
    (candidate) => candidate.method === authMethod,
  );
  if (!entry) return null;
  switch (entry.method) {
    case 'api-key':
      return { authMethod: 'api-key' };
    case 'env':
      return { authMethod: 'env' };
    case 'subscription-key':
      return { authMethod: 'subscription-key', constraints: entry.constraints };
    case 'subscription-broker':
      return {
        authMethod: 'subscription-broker',
        constraints: entry.constraints,
      };
    default: {
      const _exhaustive: never = entry;
      return _exhaustive;
    }
  }
}

/** Rank a credential's method so direct-capable ones (api-key/env) sort first:
 * a model served by both a direct and a subscription credential should resolve
 * to the directly-usable option, since the subscription one forces a sandbox. */
function directFirst(authMethod: CredentialAuthMethod): number {
  return authMethod === 'api-key' || authMethod === 'env' ? 0 : 1;
}

/**
 * The models and sandbox agents the composer's picker lists for one org.
 * Open to any org member; the listing is non-secret capability metadata — the
 * credential SHAPES here, never secret material.
 */
export const listComposerModels = action({
  args: { organizationId: v.string() },
  returns: v.object({
    models: v.array(composerModelOptionValidator),
    sandboxAgents: v.array(composerSandboxAgentValidator),
  }),
  handler: async (ctx, args) => {
    await requireOrgMembershipById(ctx, args.organizationId);

    const credentials = await ctx.runQuery(
      api.provider_credentials.queries.listCredentials,
      { organizationId: args.organizationId },
    );
    const active = credentials
      .filter((credential) => credential.status === 'active')
      .sort((a, b) => directFirst(a.authMethod) - directFirst(b.authMethod));

    const connectors = await resolveConnectorsForOrgId(
      ctx,
      args.organizationId,
    );
    const connectorByName = new Map(
      connectors.map((connector) => [connector.name, connector] as const),
    );

    // Keyed by model id, direct-preferred first-wins: the picker selects by id
    // alone, so one option per id keeps selection unambiguous.
    const byId = new Map<string, ComposerModelOption>();
    for (const credential of active) {
      const connector = connectorByName.get(credential.providerSlug);
      if (!connector) continue;
      const credentialAuth = credentialAuthFor(
        connector,
        credential.authMethod,
      );
      if (!credentialAuth) continue;

      let catalog;
      try {
        catalog = await getConnectorCatalog(connector);
      } catch (error) {
        // One connector's unreachable /models endpoint must not blank the
        // whole picker; skip it loudly and offer the rest.
        console.warn(
          `[composer] could not resolve catalog for "${connector.name}"`,
          error instanceof Error ? error.message : error,
        );
        continue;
      }

      const allowlist = credential.modelAllowlist;
      for (const entry of catalog) {
        if (allowlist && !allowlist.includes(entry.id)) continue;
        if (byId.has(entry.id)) continue;
        byId.set(entry.id, {
          id: entry.id,
          label: entry.id,
          providerSlug: connector.name,
          credential: credentialAuth,
        });
      }
    }

    const models = [...byId.values()].sort((a, b) =>
      a.label.localeCompare(b.label),
    );

    // Only harnesses the managed lane can actually run. V1 serves the managed
    // credential path only (org provider keys reach the box as a session VK), so
    // a managed-incapable harness (e.g. Cursor: byo-only, no gateway base-URL
    // override) would build an inert exec that hangs to the turn deadline. Don't
    // offer what can't run — the plan's honesty gate.
    const sandboxAgents: ComposerSandboxAgentOption[] = loadHarnesses()
      .filter((harness) => harness.credentialPolicy.managed)
      .map((harness) => ({ harness: harness.slug, label: harness.displayName }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return { models, sandboxAgents };
  },
});

const composerCapabilityValidator = v.object({
  slug: v.string(),
  label: v.string(),
  description: v.optional(v.string()),
});

type ComposerCapability = Infer<typeof composerCapabilityValidator>;

interface ComposerCapabilityListing {
  skills: ComposerCapability[];
  connectors: ComposerCapability[];
}

/**
 * What a conversation can equip an agent with: the organization's skills and
 * its ENABLED connectors — a connector counts as enabled when the org holds
 * an active credential for it, the same credential-gated rule the model
 * listing follows. Listing is non-secret capability metadata, open to any
 * member; what a selection DOES is decided where it is consumed (a coding
 * agent's session provisioning), never here.
 *
 * The handler's return type is annotated explicitly — it calls back through
 * the generated `api`, and an unannotated return would flow that cycle into
 * the API surface and degrade its types (same rule as `startTurn`).
 */
export const listComposerCapabilities = action({
  args: { organizationId: v.string() },
  returns: v.object({
    skills: v.array(composerCapabilityValidator),
    connectors: v.array(composerCapabilityValidator),
  }),
  handler: async (ctx, args): Promise<ComposerCapabilityListing> => {
    await requireOrgMembershipById(ctx, args.organizationId);

    const skillListing = await ctx.runAction(api.skills.actions.listSkills, {
      organizationId: args.organizationId,
    });
    const skills = skillListing.skills
      .map((skill) => {
        const option: ComposerCapability = {
          slug: skill.slug,
          label: skill.slug,
        };
        if (skill.description !== '') option.description = skill.description;
        return option;
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    // Connectors are NOT offered yet: a coding turn does not mount the
    // connector MCP bridge (Phase 3), so a picked connector would be stored on
    // the thread and silently do nothing. The plan forbids showing a capability
    // the agent turn can't actually reach — so the picker lists none until the
    // sandbox capability bridge lands. (Skills DO stage into the session, so
    // they stay.) The credential-gated enumeration returns with the bridge.
    const connectors: ComposerCapability[] = [];

    return { skills, connectors };
  },
});
