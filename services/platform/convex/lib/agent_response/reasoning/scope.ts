/**
 * Cross-thread reasoning-profile scope key (pure).
 *
 * The `reasoningProfiles` table is keyed per (organization, scopeKey). The
 * scope used to be the resolved model id alone, so a mechanical `crm`/`workflow`
 * agent and a free-form `chat` agent on the same model shared one warm-start
 * anchor — a muddy prior. Composing the agent type in keeps a difficulty→need
 * curve per (model, agent kind), which is how reasoning need actually varies.
 *
 * Keep the format stable: it is persisted as an index key. Changing it orphans
 * previously persisted profiles — `getReasoningProfile` does an exact lookup on
 * this composite key with no bare-model fallback, so old `scopeKey: model` rows
 * simply re-accumulate cold under the new key (a one-time, self-healing cost).
 */
export function reasoningScopeKey(model: string, agentType?: string): string {
  return `${model}::${agentType ?? 'chat'}`;
}
