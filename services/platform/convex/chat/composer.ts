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

import { v, type Infer } from 'convex/values';

import { walkChatCatalog } from '../lib/providers/chat_catalog';
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
   * picker renders only for these. `toolsRequireOff` marks a model whose
   * endpoint refuses tools+effort together: the picker offers no levels and
   * says why (the resolver sends the catalog's off value regardless). */
  reasoning: v.optional(
    v.object({
      knob: v.union(v.literal('effort'), v.literal('budget-tokens')),
      toolsRequireOff: v.optional(v.boolean()),
    }),
  ),
  /** The model can see images (catalog `vision` tag) — the composer warns
   * when attachments are staged for a model without it. */
  vision: v.optional(v.boolean()),
});

type ComposerModelOption = Infer<typeof composerModelOptionValidator>;
/**
 * The per-hit projection behind the model picker — pure, so the 0.5 backend
 * runs it over its own catalog walk. Keyed by (provider, id), first-wins per
 * pair (the caller sorts direct-capable credentials first): an org with two
 * providers serving the same model sees BOTH copies, grouped by provider in
 * the picker. Voice availability rides the same walk: a TTS-tagged entry on
 * a DIRECT credential enables synthesis, a transcription-tagged entry on a
 * DIRECT openai-format connector enables dictation (the Anthropic Messages
 * wire has no transcription endpoint).
 */
export function collectComposerOptions(
  hits: readonly Awaited<ReturnType<typeof walkChatCatalog>>[number][],
): {
  byId: Map<string, ComposerModelOption>;
  ttsAvailable: boolean;
  transcriptionAvailable: boolean;
} {
  const byId = new Map<string, ComposerModelOption>();
  let ttsAvailable = false;
  let transcriptionAvailable = false;
  for (const { connector, credential, credentialAuth, entry } of hits) {
    if (
      entry.tags.includes('text-to-speech') &&
      (credential.authMethod === 'api-key' || credential.authMethod === 'env')
    ) {
      ttsAvailable = true;
    }
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
        ? {
            reasoning: {
              knob: entry.reasoning.knob,
              ...(entry.reasoning.toolsRequireOff === true
                ? { toolsRequireOff: true }
                : {}),
            },
          }
        : {}),
      ...(entry.supportsVision ? { vision: true } : {}),
    });
  }
  return { byId, ttsAvailable, transcriptionAvailable };
}
