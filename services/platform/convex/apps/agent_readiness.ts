import { v } from 'convex/values';

import { getCredentialPolicy } from '../../lib/agent-adapters/credential-policy';
import type { ProductAgentSlug } from '../../lib/agent-adapters/events';
import {
  type ClassifiableAgent,
  classifyAgentReadiness,
  detectCredentialRuntimeMismatch,
  resolveEffectiveRequiredEnv,
} from '../../lib/shared/agents/readiness';
import { api, internal } from '../_generated/api';
import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';

/**
 * Per-agent setup readiness for an app's bundled agents — the agent half of the
 * install-wizard / readiness checklist (the integration half is
 * `getAppInstallState`). Orchestrates three existing reads and the pure
 * classifier: `listAppAgents` (the app's agent configs incl. `metadata.requires.env`),
 * `listProviders` (per-provider `hasApiKey` + model catalog), and
 * `listAgentEnvForInjection` (which env keys are set for a BYO agent). Each
 * agent's *effective* `authMode` is whatever the org's copied config currently
 * says, so the wizard's mode choice (persisted via `setAgentAuthMode`) flips the
 * check on the next refetch. Returns `v.any()` (heterogeneous, like its siblings).
 */

interface ProviderInfo {
  name: string;
  displayName?: string;
  baseUrl?: string;
  hasApiKey?: boolean;
  models?: Array<{ id: string; hasApiKeyOverride?: boolean }>;
}

interface AppAgentRow {
  name: string;
  shortName?: string;
  displayName?: string;
  status?: string;
  primaryBehavior?: 'chat' | 'image-generation' | 'external-agent';
  agentKind?: 'claude-code' | 'cursor';
  authMode?: 'managed' | 'byo';
  supportedModels?: string[];
  metadata?: {
    requires?: {
      env?: Array<{ key: string; secret?: boolean; description?: string }>;
    };
  };
}

export const getAppAgentReadiness = action({
  args: { organizationId: v.string(), appSlug: v.string() },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    await requireOrgMembershipById(ctx, args.organizationId);

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- v.any() action-boundary read
    const rawAgents = (await ctx.runAction(
      api.agents.file_actions.listAppAgents,
      { organizationId: args.organizationId, appSlug: args.appSlug },
    )) as AppAgentRow[];
    // Skip malformed-config rows (they carry `status`/`message`, not agent fields).
    const agents = rawAgents.filter(
      (a) => typeof a.name === 'string' && a.status === undefined,
    );

    const classified = agents.map((row) => {
      const productKind: ProductAgentSlug =
        row.agentKind === 'cursor' ? 'cursor' : 'claude-code';
      const credentialManagedSource =
        row.primaryBehavior === 'external-agent' && row.authMode !== 'byo'
          ? getCredentialPolicy(productKind).managedSource
          : undefined;
      return {
        row,
        needs: classifyAgentReadiness({
          primaryBehavior: row.primaryBehavior,
          authMode: row.authMode,
          supportedModels: row.supportedModels,
          requiredEnv: row.metadata?.requires?.env,
          ...(credentialManagedSource !== undefined && {
            credentialManagedSource,
          }),
        } satisfies ClassifiableAgent),
      };
    });

    // Provider read is needed whenever any agent references models — we compute
    // provider facts for external agents too (in case the user switches one to
    // managed in the wizard, which needs the provider+model check).
    const anyHasModels = classified.some((c) => c.needs.models.length > 0);
    let providers: ProviderInfo[] = [];
    if (anyHasModels) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- v.any() action-boundary read
      providers = (await ctx.runAction(
        api.providers.file_actions.listProviders,
        {
          organizationId: args.organizationId,
        },
      )) as ProviderInfo[];
    }
    const providerByName = new Map(providers.map((p) => [p.name, p]));

    const modelResolves = (m: {
      providerName?: string;
      modelId: string;
    }): boolean => {
      const check = (p: ProviderInfo): boolean => {
        const entry = (p.models ?? []).find((mm) => mm.id === m.modelId);
        if (!entry) return false;
        return p.hasApiKey === true || entry.hasApiKeyOverride === true;
      };
      if (m.providerName) {
        const p = providerByName.get(m.providerName);
        return p ? check(p) : false;
      }
      return providers.some(check);
    };

    const out: Array<Record<string, unknown>> = [];
    for (const { row, needs } of classified) {
      // Provider facts — computed regardless of current mode so the wizard can
      // branch a mode toggle locally without a refetch.
      const supportedModelsResolvable =
        needs.models.length > 0 && needs.models.some(modelResolves);
      const requiredProviders = needs.providers.map((name) => {
        const p = providerByName.get(name);
        return {
          name,
          ...(p?.displayName !== undefined && { displayName: p.displayName }),
          ...(p?.baseUrl !== undefined && { baseUrl: p.baseUrl }),
          hasKey: p?.hasApiKey === true,
          exists: p !== undefined,
        };
      });

      // Declared env + set-status (only read the table when something's required).
      let setKeys = new Set<string>();
      if (needs.needsEnv) {
        const envRows = (await ctx.runQuery(
          internal.agents.agent_env.listAgentEnvForInjection,
          { organizationId: args.organizationId, agentSlug: row.name },
        )) as Array<{ key: string }>;
        setKeys = new Set(envRows.map((r) => r.key));
      }
      const effectiveRequiredEnv = resolveEffectiveRequiredEnv({
        ...(row.agentKind !== undefined && { agentKind: row.agentKind }),
        needs,
      });
      const requiredEnv = effectiveRequiredEnv.map((e) => ({
        ...e,
        set: setKeys.has(e.key),
      }));
      const credentialMismatch = detectCredentialRuntimeMismatch({
        ...(row.agentKind !== undefined && { agentKind: row.agentKind }),
        setKeys,
        needsEnv: needs.needsEnv,
        expectedKeys: effectiveRequiredEnv.map((e) => e.key),
      });

      // Ready under the agent's CURRENT effective mode (drives the checklist).
      const ready = credentialMismatch
        ? false
        : needs.needsEnv
          ? requiredEnv.every((e) => e.set)
          : supportedModelsResolvable;

      out.push({
        agentSlug: row.name,
        shortName: row.shortName ?? row.name,
        displayName: row.displayName ?? row.shortName ?? row.name,
        mode: needs.mode,
        ...(row.agentKind !== undefined && { agentKind: row.agentKind }),
        ...(credentialMismatch !== undefined && { credentialMismatch }),
        ready,
        supportedModelsResolvable,
        requiredProviders,
        requiredEnv,
      });
    }

    return { agents: out };
  },
});
