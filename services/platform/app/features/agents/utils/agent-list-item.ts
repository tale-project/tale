import type { AgentI18nOverrides } from '@/convex/agents/file_utils';

/**
 * Shape of a configurable agent as returned by `api.agents.file_actions
 * .listAgents` (a `v.any()` action, so the client has no generated type). Both
 * the agents table and the catalog read this same projection, so the narrowing
 * lives here once rather than as a duplicated inline guard + `as any` casts.
 *
 * Read-error rows (`{ name, status, message }`) and system-managed agents
 * (`uiConfigurable === false`, e.g. the Auto router) are excluded by
 * `toConfigurableAgent`, so consumers never see them.
 */
export interface ConfigurableAgentListItem {
  name: string;
  displayName?: string;
  description?: string;
  conversationStarters?: string[];
  systemInstructions?: string;
  supportedModels?: string[];
  toolNames?: string[];
  visibleInChat?: boolean;
  roleRestriction?: string;
  primaryBehavior?: string;
  /** Top-level folder (chat/workforce/github) — the catalog's visual section. */
  folder?: string;
  i18n?: Record<string, AgentI18nOverrides>;
  metadata?: AgentListItemMetadata;
}

/** Optional, free-form config metadata carried on a catalog agent. */
export interface AgentListItemMetadata {
  labels?: unknown;
  templateCatalog?: boolean;
  requires?: { integrations?: unknown };
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
    ? value
    : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Narrows a raw `listAgents` entry to a configurable agent, or `null` when it
 * is a read-error row or a system-managed (non-`uiConfigurable`) agent. The one
 * place the `v.any()` boundary is validated, so callers stay cast-free: every
 * field is checked on the way out rather than asserted.
 */
export function toConfigurableAgent(
  raw: unknown,
): ConfigurableAgentListItem | null {
  if (!isRecord(raw)) return null;
  const name = asString(raw.name);
  if (name === undefined) return null;
  // Read errors surface as `{ name, status, message }` instead of config fields.
  if ('status' in raw) return null;
  if (raw.uiConfigurable === false) return null;

  return {
    name,
    displayName: asString(raw.displayName),
    description: asString(raw.description),
    conversationStarters: asStringArray(raw.conversationStarters),
    systemInstructions: asString(raw.systemInstructions),
    supportedModels: asStringArray(raw.supportedModels),
    toolNames: asStringArray(raw.toolNames),
    visibleInChat: asBoolean(raw.visibleInChat),
    roleRestriction: asString(raw.roleRestriction),
    primaryBehavior: asString(raw.primaryBehavior),
    folder: asString(raw.folder),
    // i18n + metadata are free-form trees consumed downstream; pass them as-is
    // when present. `resolveAgentLocale` / `agentLabels` defensively read their
    // own leaves, so we only assert the container is an object here.
    i18n: asI18nOverrides(raw.i18n),
    metadata: isRecord(raw.metadata) ? raw.metadata : undefined,
  };
}

/**
 * The per-locale override map is an opaque tree at the `v.any()` boundary; its
 * consumer (`resolveAgentLocale`) reads each leaf defensively via `pickField`,
 * so validating only that it's a record is sufficient and avoids re-deriving
 * the full `AgentI18nOverrides` shape here.
 */
function asI18nOverrides(
  value: unknown,
): Record<string, AgentI18nOverrides> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, AgentI18nOverrides> = {};
  for (const [locale, overrides] of Object.entries(value)) {
    if (isRecord(overrides)) {
      out[locale] = {
        displayName: asString(overrides.displayName),
        description: asString(overrides.description),
        conversationStarters: asStringArray(overrides.conversationStarters),
        systemInstructions: asString(overrides.systemInstructions),
      };
    }
  }
  // Mirror the other `as*` helpers: absent (no valid overrides) is `undefined`,
  // not an empty object.
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Reads the labels array off an agent's metadata, filtering to strings. */
export function agentLabels(agent: ConfigurableAgentListItem): string[] {
  const labels = agent.metadata?.labels;
  return Array.isArray(labels)
    ? labels.filter((l): l is string => typeof l === 'string')
    : [];
}

/** Reads the required-integration slugs off an agent's metadata. */
export function agentRequiredIntegrations(
  agent: ConfigurableAgentListItem,
): string[] {
  const integrations = agent.metadata?.requires?.integrations;
  return Array.isArray(integrations)
    ? integrations.filter((i): i is string => typeof i === 'string')
    : [];
}
