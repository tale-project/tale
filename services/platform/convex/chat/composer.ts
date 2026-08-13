'use node';

/**
 * What the composer's model picker offers, resolved for one organization.
 *
 * The picker shows two groups. MODELS lists the models a turn can call
 * directly; a model appears only when the org has an ACTIVE credential for the
 * connector that lists it — resolved through the SAME connector set and
 * catalog a turn resolves (`resolveProvidersForOrgId` + `getProviderCatalog`)
 * — so the picker never offers a model no configured credential could serve.
 * Each model carries the credential's auth shape in the exact form
 * `resolveExecution` reads, so the composer's sandbox toggle locks (or stays
 * free) by asking the resolver, never by re-deriving the rule in the UI.
 *
 * There is deliberately NO agent, harness, or capability listing here: the
 * chat page offers model selection only (the Chat·Task·Automation boundary),
 * and the sandbox/skill surfaces live on tasks and automations.
 *
 * `'use node'` by necessity — reading the model catalogs and the org's
 * custom connectors is filesystem work.
 */

import { ConvexError, v, type Infer } from 'convex/values';

import { loadConnectorDefinitions } from '../../lib/connectors/catalog';
import { api, internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { walkChatCatalog } from '../lib/providers/chat_catalog';
import {
  loadHarnesses,
  readSystemEntryIcon,
} from '../lib/providers/load_system_config';

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
  /** The provider's human name (`displayName` in its yml) — pickers show it
   * next to each model so two providers serving the same id are tellable
   * apart. */
  providerLabel: v.string(),
  credential: credentialAuthValidator,
  /** Present when the model's reasoning depth is controllable — the effort
   * picker renders only for these. */
  reasoning: v.optional(
    v.object({
      knob: v.union(v.literal('effort'), v.literal('budget-tokens')),
    }),
  ),
  /** The model can see images (catalog `vision` tag) — the composer warns
   * when attachments are staged for a model without it. */
  vision: v.optional(v.boolean()),
});

type ComposerModelOption = Infer<typeof composerModelOptionValidator>;
type CredentialAuthMethod = ComposerModelOption['credential']['authMethod'];

/** Rank a credential's method so direct-capable ones (api-key/env) sort first:
 * a model served by both a direct and a subscription credential should resolve
 * to the directly-usable option, since the subscription one forces a sandbox. */
function directFirst(authMethod: CredentialAuthMethod): number {
  return authMethod === 'api-key' || authMethod === 'env' ? 0 : 1;
}

const composerHarnessValidator = v.object({
  harness: v.string(),
  label: v.string(),
  /** The harness's shipped `icon.svg`, inlined as a data URL. */
  iconUrl: v.optional(v.string()),
});

/**
 * The models the composer's picker lists for one org. Open to any org
 * member; the listing is non-secret capability metadata — the credential
 * SHAPES here, never secret material.
 *
 * `harnesses` (the shipped coding CLIs) rides along for the TASK lane — the
 * project agents tab builds its roster from it. The chat page itself never
 * renders it: chat is model selection only.
 */
export const listComposerModels = action({
  args: { organizationId: v.string() },
  returns: v.object({
    models: v.array(composerModelOptionValidator),
    harnesses: v.array(composerHarnessValidator),
    /** Non-chat capability facts derived in the same connector walk. */
    voice: v.object({
      ttsAvailable: v.boolean(),
      transcriptionAvailable: v.boolean(),
    }),
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

    // Keyed by (provider, id), direct-preferred first-wins per pair: an org
    // with two providers serving the same model sees BOTH copies, grouped by
    // provider in the picker — hiding one made the second provider's copy
    // unselectable and the model hard to find under the other's section.
    const byId = new Map<string, ComposerModelOption>();
    let ttsAvailable = false;
    let transcriptionAvailable = false;
    const hits = await walkChatCatalog(ctx, args.organizationId, active);
    for (const { connector, credential, credentialAuth, entry } of hits) {
      // Voice availability rides the same walk: a TTS-tagged entry served
      // by a DIRECT credential means "Read replies aloud" can synthesize.
      if (
        entry.tags.includes('text-to-speech') &&
        (credential.authMethod === 'api-key' || credential.authMethod === 'env')
      ) {
        ttsAvailable = true;
      }
      // Likewise for dictation: a transcription-tagged entry on an
      // openai-format connector served by a DIRECT credential means the
      // MediaRecorder fallback can transcribe (`transcribeDictation`) —
      // the Anthropic Messages wire has no transcription endpoint, so
      // anthropic-format connectors never qualify.
      if (
        entry.tags.includes('transcription') &&
        connector.apiFormat === 'openai' &&
        (credential.authMethod === 'api-key' || credential.authMethod === 'env')
      ) {
        transcriptionAvailable = true;
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
        providerLabel: connector.displayName,
        credential: credentialAuth,
        ...(entry.reasoning !== undefined
          ? { reasoning: { knob: entry.reasoning.knob } }
          : {}),
        ...(entry.supportsVision ? { vision: true } : {}),
      });
    }

    // The governance model-access policy filters the catalog server-side —
    // the picker (and anything caching its answer) never even sees a model
    // the policy hides; the turn action re-checks at send time.
    const candidateIds = [
      ...new Set([...byId.values()].map((option) => option.id)),
    ];
    if (candidateIds.length > 0) {
      const accessible = new Set(
        await ctx.runQuery(api.governance.queries.getAccessibleModelsForUser, {
          organizationId: args.organizationId,
          modelIds: candidateIds,
        }),
      );
      for (const [key, option] of byId) {
        if (!accessible.has(option.id)) byId.delete(key);
      }
    }

    const models = [...byId.values()].sort(
      (a, b) =>
        a.label.localeCompare(b.label) ||
        a.providerSlug.localeCompare(b.providerSlug),
    );

    // Only harnesses the managed lane can actually run (see the project
    // agents roster): a managed-incapable harness would build an inert exec.
    const harnesses = loadHarnesses()
      .filter((harness) => harness.credentialPolicy.managed)
      .map((harness) => ({
        harness: harness.slug,
        label: harness.displayName,
        // Convex drops undefined fields at serialization, matching the
        // validator's optional iconUrl.
        iconUrl: readSystemEntryIcon('harnesses', harness.slug),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      models,
      harnesses,
      voice: { ttsAvailable, transcriptionAvailable },
    };
  },
});

const composerCapabilityValidator = v.object({
  slug: v.string(),
  label: v.string(),
  description: v.optional(v.string()),
  /** Iconify id from the skill's frontmatter, for the pickers' cards. */
  icon: v.optional(v.string()),
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
}): ComposerCapability {
  const option: ComposerCapability = {
    slug: skill.slug,
    label: skill.slug,
  };
  if (skill.description !== '') option.description = skill.description;
  if (skill.icon !== undefined) option.icon = skill.icon;
  return option;
}

/**
 * The connectors a selection may equip: a connector is offered when the org
 * holds an ACTIVE credential for it — the same credential-gated rule the
 * model listing follows. An equipped connector reaches the turn for real: it
 * becomes the session token's connector grant and mounts the in-sandbox
 * `tale-connectors-mcp` bridge (read-only in V1).
 */
async function listEnabledConnectors(
  ctx: ActionCtx,
  organizationId: string,
): Promise<ComposerCapability[]> {
  const credentials = await ctx.runQuery(
    api.connector_credentials.queries.listCredentials,
    { organizationId },
  );
  const enabledSlugs = new Set(
    credentials
      .filter((credential) => credential.status === 'active')
      .map((credential) => credential.connectorSlug),
  );
  return loadConnectorDefinitions()
    .filter((connector) => enabledSlugs.has(connector.name))
    .map((connector) => ({
      slug: connector.name,
      label: connector.displayName,
      description: connector.description,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * What a PROJECT's agents can equip: the skills visible to the project
 * itself — org-wide ones plus team skills shared with any of the project's
 * teams; an org-wide project sees org skills only. Deliberately NOT the
 * configuring member's visibility: a project agent runs for every project
 * member, so its equipment must never smuggle in something only its author
 * could see. The caller still has to be a member with access to the project.
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
 * What an AUTOMATION's agent node can equip: org-wide skills plus enabled
 * connectors, optionally widened to a project's team skills when the
 * automation is authored inside a project surface. Unlike a project agent, an
 * automation is not inherently project-bound (it may bind to many projects
 * later), so the default viewer is org-level. Developer-gated, matching the
 * automation domain's own write gate.
 */
export const listAutomationCapabilities = action({
  args: {
    organizationId: v.string(),
    projectId: v.optional(v.id('projects')),
  },
  returns: capabilityListingValidator,
  handler: async (ctx, args): Promise<ComposerCapabilityListing> => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const teamIds =
      args.projectId !== undefined
        ? ((
            await ctx.runQuery(
              internal.projects.internal_queries.getProjectSkillScope,
              { projectId: args.projectId },
            )
          )?.teamIds ?? [])
        : [];
    const skillListing = await ctx.runAction(
      internal.skills.file_actions.listSkills,
      {
        orgSlug: auth.orgSlug,
        viewer:
          args.projectId !== undefined
            ? { kind: 'project' as const, teamIds }
            : { kind: 'org' as const },
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
