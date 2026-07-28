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

import { ConvexError, v, type Infer } from 'convex/values';

import { loadIntegrationConnectors } from '../../lib/integrations/catalog';
import { api, internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { getConnectorCatalog } from '../lib/providers/catalog_fetch';
import { credentialAuthFor } from '../lib/providers/credential_auth';
import {
  loadHarnesses,
  readSystemEntryIcon,
} from '../lib/providers/load_system_config';
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
  /** Present when the model's reasoning depth is controllable — the effort
   * picker renders only for these. */
  reasoning: v.optional(
    v.object({
      knob: v.union(v.literal('effort'), v.literal('budget-tokens')),
    }),
  ),
});

const composerExternalAgentValidator = v.object({
  harness: v.string(),
  label: v.string(),
  /** The harness's shipped `icon.svg`, inlined as a data URL. */
  iconUrl: v.optional(v.string()),
});

type ComposerModelOption = Infer<typeof composerModelOptionValidator>;
type ComposerExternalAgentOption = Infer<typeof composerExternalAgentValidator>;
type CredentialAuthMethod = ComposerModelOption['credential']['authMethod'];

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
    externalAgents: v.array(composerExternalAgentValidator),
    /** Non-chat capability facts derived in the same connector walk. */
    voice: v.object({ ttsAvailable: v.boolean() }),
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

    // Keyed by (provider, id), direct-preferred first-wins per pair: an org
    // with two providers serving the same model sees BOTH copies, grouped by
    // provider in the picker — hiding one made the second provider's copy
    // unselectable and the model hard to find under the other's section.
    const byId = new Map<string, ComposerModelOption>();
    let ttsAvailable = false;
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
        // Voice availability rides the same walk: a TTS-tagged entry served
        // by a DIRECT credential means "Read replies aloud" can synthesize.
        if (
          entry.tags.includes('text-to-speech') &&
          (credential.authMethod === 'api-key' ||
            credential.authMethod === 'env')
        ) {
          ttsAvailable = true;
        }
        // The picker lists conversational models only — a TTS or embedding
        // entry is a capability, not something a turn can be sent to.
        if (!entry.tags.includes('chat')) continue;
        const key = `${connector.name} ${entry.id}`;
        if (byId.has(key)) continue;
        byId.set(key, {
          id: entry.id,
          label: entry.id,
          providerSlug: connector.name,
          credential: credentialAuth,
          ...(entry.reasoning !== undefined
            ? { reasoning: { knob: entry.reasoning.knob } }
            : {}),
        });
      }
    }

    const models = [...byId.values()].sort(
      (a, b) =>
        a.label.localeCompare(b.label) ||
        a.providerSlug.localeCompare(b.providerSlug),
    );

    // Only harnesses the managed lane can actually run. V1 serves the managed
    // credential path only (org provider keys reach the box as a session VK), so
    // a managed-incapable harness (e.g. Cursor: byo-only, no gateway base-URL
    // override) would build an inert exec that hangs to the turn deadline. Don't
    // offer what can't run — the plan's honesty gate.
    const externalAgents: ComposerExternalAgentOption[] = loadHarnesses()
      .filter((harness) => harness.credentialPolicy.managed)
      .map((harness) => ({
        harness: harness.slug,
        label: harness.displayName,
        // Convex drops undefined fields at serialization, matching the
        // validator's optional iconUrl.
        iconUrl: readSystemEntryIcon('harnesses', harness.slug),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return { models, externalAgents, voice: { ttsAvailable } };
  },
});

const composerCapabilityValidator = v.object({
  slug: v.string(),
  label: v.string(),
  description: v.optional(v.string()),
  /** Iconify id from the skill's frontmatter, for the pickers' cards. */
  icon: v.optional(v.string()),
  /** `chat | agent | all`; absent reads as `all`. Connectors never carry it. */
  usageMode: v.optional(
    v.union(v.literal('chat'), v.literal('agent'), v.literal('all')),
  ),
});

type ComposerCapability = Infer<typeof composerCapabilityValidator>;

interface ComposerCapabilityListing {
  skills: ComposerCapability[];
  connectors: ComposerCapability[];
}

const capabilityListingValidator = v.object({
  skills: v.array(composerCapabilityValidator),
  connectors: v.array(composerCapabilityValidator),
});

function toSkillCapability(skill: {
  slug: string;
  description: string;
  icon?: string;
  usageMode?: 'chat' | 'agent' | 'all';
}): ComposerCapability {
  const option: ComposerCapability = {
    slug: skill.slug,
    label: skill.slug,
  };
  if (skill.description !== '') option.description = skill.description;
  if (skill.icon !== undefined) option.icon = skill.icon;
  if (skill.usageMode !== undefined) option.usageMode = skill.usageMode;
  return option;
}

/**
 * The connectors a selection may equip: a connector is offered when the org
 * holds an ACTIVE credential for it — the same credential-gated rule the
 * model listing follows. An equipped connector reaches the turn for real: it
 * becomes the session token's integration grant and mounts the in-sandbox
 * `tale-integrations-mcp` bridge (read-only in V1).
 */
async function listEnabledConnectors(
  ctx: ActionCtx,
  organizationId: string,
): Promise<ComposerCapability[]> {
  const credentials = await ctx.runQuery(
    api.integration_credentials.queries.listCredentials,
    { organizationId },
  );
  const enabledSlugs = new Set(
    credentials
      .filter((credential) => credential.status === 'active')
      .map((credential) => credential.connectorSlug),
  );
  return loadIntegrationConnectors()
    .filter((connector) => enabledSlugs.has(connector.name))
    .map((connector) => ({
      slug: connector.name,
      label: connector.displayName,
      description: connector.description,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * What a CONVERSATION can equip: the skills the asking member may use in
 * chat — their own visibility (private + their teams' + org), narrowed to
 * the `chat` surface so an agent-only skill never shows up in the composer
 * or the `/` command — plus the org's enabled connectors. Listing is
 * non-secret capability metadata, open to any member; what a selection DOES
 * is decided where it is consumed, never here.
 *
 * The handler's return type is annotated explicitly — it calls back through
 * the generated `api`, and an unannotated return would flow that cycle into
 * the API surface and degrade its types (same rule as `startTurn`).
 */
export const listComposerCapabilities = action({
  args: { organizationId: v.string() },
  returns: capabilityListingValidator,
  handler: async (ctx, args): Promise<ComposerCapabilityListing> => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const context = await ctx.runQuery(
      internal.skills.viewer_context.getUserSkillViewerContext,
      { organizationId: args.organizationId, userId: auth.userId },
    );

    const skillListing = await ctx.runAction(
      internal.skills.file_actions.listSkills,
      {
        orgSlug: auth.orgSlug,
        viewer: {
          kind: 'user' as const,
          userId: auth.userId,
          teamIds: context?.teamIds ?? [],
          isOrgAdmin: context?.isOrgAdmin ?? false,
        },
        surface: 'chat' as const,
      },
    );
    const skills = skillListing.skills
      .map(toSkillCapability)
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      skills,
      connectors: await listEnabledConnectors(ctx, args.organizationId),
    };
  },
});

/**
 * What a PROJECT's agents can equip: the skills visible to the project
 * itself — org-wide ones plus team skills shared with any of the project's
 * teams; an org-wide project sees org skills only — narrowed to the `agent`
 * surface. Deliberately NOT the configuring member's visibility: a project
 * agent runs for every project member, so its equipment must never smuggle
 * in something only its author could see. The caller still has to be a
 * member with access to the project.
 */
export const listProjectCapabilities = action({
  args: { organizationId: v.string(), projectId: v.id('projects') },
  returns: capabilityListingValidator,
  handler: async (ctx, args): Promise<ComposerCapabilityListing> => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const access = await ctx.runQuery(
      internal.projects.internal_queries.assertProjectAccessForChat,
      {
        projectId: args.projectId,
        organizationId: args.organizationId,
        userId: auth.userId,
      },
    );
    if (!access.allowed) {
      throw new ConvexError({
        code:
          access.reason === 'not_found'
            ? 'PROJECT_NOT_FOUND'
            : 'PROJECT_FORBIDDEN',
        message: 'You do not have access to this project.',
      });
    }
    const scope = await ctx.runQuery(
      internal.projects.internal_queries.getProjectSkillScope,
      { projectId: args.projectId },
    );

    const skillListing = await ctx.runAction(
      internal.skills.file_actions.listSkills,
      {
        orgSlug: auth.orgSlug,
        viewer: {
          kind: 'project' as const,
          teamIds: scope?.teamIds ?? [],
        },
        surface: 'agent' as const,
      },
    );
    const skills = skillListing.skills
      .map(toSkillCapability)
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      skills,
      connectors: await listEnabledConnectors(ctx, args.organizationId),
    };
  },
});
