import {
  getCredentialEnvKeys,
  getCredentialPolicy,
} from '../../agent-adapters/credential-policy';
import type { ProductAgentSlug } from '../../agent-adapters/events';
/**
 * Pure classifier for an agent's setup dependencies — what must be configured
 * before the agent can run. Mirrors the integration-availability model
 * (`convex/integrations/availability.ts`): a small, side-effect-free function the
 * app-install readiness action wires filesystem + DB reads around, so the
 * decision tree is unit-testable in isolation.
 *
 * The buckets (the user-facing taxonomy):
 *  - internal (chat) / image-generation / external-GATEWAY-managed → the provider+model
 *    the agent uses must be configured (provider has a key, model resolves).
 *  - external-ENV-managed → managed external agent whose runtime reads credentials
 *    from the session env (not the platform gateway); declared env/secrets must be set.
 *  - external-BYO → the agent's declared secrets/env must be set (it brings its
 *    own credential; supportedModels are hints, not a provider-key requirement).
 */
import { parseModelRef } from '../utils/model-ref';

type ParsedModelRef = ReturnType<typeof parseModelRef>;

type AgentReadinessMode =
  | 'internal'
  | 'image'
  | 'external-gateway-managed'
  | 'external-env-managed'
  | 'external-byo';

interface RequiredEnvKey {
  key: string;
  secret: boolean;
  description?: string;
}

interface AgentReadinessNeeds {
  mode: AgentReadinessMode;
  /** Provider+model must be configured (provider key present, model resolvable). */
  needsProviderModel: boolean;
  /** The declared env/secrets must be set. */
  needsEnv: boolean;
  /** Distinct provider slugs referenced by `supportedModels` (qualified refs only). */
  providers: string[];
  /** Parsed `supportedModels`. */
  models: ParsedModelRef[];
  /** Declared required env/secret keys (from `metadata.requires.env`). */
  requiredEnv: RequiredEnvKey[];
}

/** The agent-config fields the classifier reads — a structural subset. */
export interface ClassifiableAgent {
  primaryBehavior?: 'chat' | 'image-generation' | 'external-agent';
  authMode?: 'managed' | 'byo';
  supportedModels?: readonly string[];
  /** From `metadata.requires.env`. */
  requiredEnv?: ReadonlyArray<{
    key: string;
    secret?: boolean;
    description?: string;
  }>;
  /**
   * Managed external agents only: where credentials come from. Defaults to
   * `'gateway'` (Claude Code). `'agent-env'` means the runtime uses session
   * env keys (e.g. Cursor CURSOR_API_KEY) even in managed mode.
   */
  credentialManagedSource?: 'gateway' | 'agent-env';
}

export function classifyAgentReadiness(
  agent: ClassifiableAgent,
): AgentReadinessNeeds {
  const primaryBehavior = agent.primaryBehavior ?? 'chat';
  const isExternal = primaryBehavior === 'external-agent';
  const isByo = isExternal && agent.authMode === 'byo';
  const managedSource = agent.credentialManagedSource ?? 'gateway';

  const models = (agent.supportedModels ?? []).map((ref) => parseModelRef(ref));
  const providers = Array.from(
    new Set(
      models
        .map((m) => m.providerName)
        .filter((p): p is string => typeof p === 'string' && p.length > 0),
    ),
  );
  const requiredEnv: RequiredEnvKey[] = (agent.requiredEnv ?? []).map((e) => ({
    key: e.key,
    secret: e.secret ?? false,
    ...(e.description !== undefined && { description: e.description }),
  }));

  const mode: AgentReadinessMode = isByo
    ? 'external-byo'
    : isExternal
      ? managedSource === 'agent-env'
        ? 'external-env-managed'
        : 'external-gateway-managed'
      : primaryBehavior === 'image-generation'
        ? 'image'
        : 'internal';

  return {
    mode,
    needsProviderModel:
      mode === 'internal' ||
      mode === 'image' ||
      mode === 'external-gateway-managed',
    needsEnv: mode === 'external-byo' || mode === 'external-env-managed',
    providers,
    models,
    requiredEnv,
  };
}

const CURSOR_API_KEY_DESCRIPTION =
  'The Cursor API key the agent CLI authenticates with.';

const CLAUDE_BYO_AUTH_KEYS = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
] as const;

/** Machine-readable mismatch between saved `agentKind` and configured env keys. */
export type CredentialRuntimeMismatchCode =
  | 'cursorKeyOnClaudeRuntime'
  | 'claudeKeyOnCursorRuntime';

/** Mismatch detail for app-pack copy — includes env key names for `{expectedKeys}` etc. */
export interface CredentialRuntimeMismatchDetail {
  code: CredentialRuntimeMismatchCode;
  /** Env var names the saved runtime expects. */
  expectedKeys: readonly string[];
  /** Env var names currently set that belong to the other runtime. */
  configuredKeys: readonly string[];
}

export function formatEnvKeyList(keys: readonly string[]): string {
  return keys.join(', ');
}

const CURSOR_CREDENTIAL_KEYS = ['CURSOR_API_KEY'] as const;

function configuredMismatchedKeys(
  setKeys: ReadonlySet<string>,
  keys: readonly string[],
): string[] {
  return keys.filter((k) => setKeys.has(k));
}

/**
 * Detect when Environment credentials don't match the saved external runtime.
 * Returns a stable code plus key names the app pack maps to user-facing copy via
 * `<messageNamespace>.readiness.mismatch.<code>` — no platform i18n here.
 */
export function detectCredentialRuntimeMismatch(args: {
  agentKind?: 'claude-code' | 'cursor' | 'hermes' | 'gemini';
  setKeys: ReadonlySet<string>;
  needsEnv: boolean;
  /** Keys the saved runtime expects (from `resolveEffectiveRequiredEnv`). */
  expectedKeys: readonly string[];
}): CredentialRuntimeMismatchDetail | undefined {
  if (!args.needsEnv) return undefined;
  const kind = args.agentKind ?? 'claude-code';
  const hasCursor = args.setKeys.has('CURSOR_API_KEY');
  const hasClaude = CLAUDE_BYO_AUTH_KEYS.some((k) => args.setKeys.has(k));
  if (kind === 'claude-code' && hasCursor && !hasClaude) {
    const expected =
      args.expectedKeys.length > 0
        ? args.expectedKeys
        : ['ANTHROPIC_AUTH_TOKEN'];
    return {
      code: 'cursorKeyOnClaudeRuntime',
      expectedKeys: expected,
      configuredKeys: configuredMismatchedKeys(
        args.setKeys,
        CURSOR_CREDENTIAL_KEYS,
      ),
    };
  }
  if (kind === 'cursor' && hasClaude && !hasCursor) {
    return {
      code: 'claudeKeyOnCursorRuntime',
      expectedKeys:
        args.expectedKeys.length > 0 ? args.expectedKeys : ['CURSOR_API_KEY'],
      configuredKeys: configuredMismatchedKeys(
        args.setKeys,
        CLAUDE_BYO_AUTH_KEYS,
      ),
    };
  }
  return undefined;
}

/**
 * Env keys the readiness checklist / install wizard should treat as required for
 * this agent's *current* runtime — aligned with `getCredentialEnvKeys` at run
 * time, not stale `metadata.requires.env` left over after an agentKind switch.
 */
export function resolveEffectiveRequiredEnv(args: {
  agentKind?: 'claude-code' | 'cursor' | 'hermes' | 'gemini';
  needs: Pick<AgentReadinessNeeds, 'needsEnv' | 'mode' | 'requiredEnv'>;
}): RequiredEnvKey[] {
  if (!args.needs.needsEnv) return [];

  const productKind: ProductAgentSlug =
    args.agentKind === 'cursor'
      ? 'cursor'
      : args.agentKind === 'hermes'
        ? 'hermes'
        : args.agentKind === 'gemini'
          ? 'gemini'
          : 'claude-code';
  const metadataByKey = new Map(
    args.needs.requiredEnv.map((e) => [e.key, e] as const),
  );

  const useRuntimeCredentialKeys =
    args.agentKind === 'cursor' ||
    args.needs.mode === 'external-env-managed' ||
    getCredentialPolicy(productKind).managedSource === 'agent-env';

  if (!useRuntimeCredentialKeys) {
    return args.needs.requiredEnv;
  }

  // Cursor (and other agent-env runtimes) authenticate with runtime credential
  // keys — metadata may still list ANTHROPIC_AUTH_TOKEN from the app template.
  return getCredentialEnvKeys(productKind).map((key) => {
    const fromMeta = metadataByKey.get(key);
    return {
      key,
      secret: fromMeta?.secret ?? true,
      description:
        fromMeta?.description ??
        (key === 'CURSOR_API_KEY' ? CURSOR_API_KEY_DESCRIPTION : undefined),
    };
  });
}
