/**
 * Canonical task-domain taxonomy shared across the platform.
 *
 * A "domain" is the topical/functional category a user turn falls into — code,
 * math, legal, etc. It is detected once per turn (`detectDomain`, see
 * `convex/lib/agent_response/model_routing/domain/`) and drives two consumers:
 *
 *  - **Agent routing** (`auto_route.ts`): a capability hint to the classifier
 *    and the key for learned routing priors.
 *  - **Model routing** (`model_routing/select_model.ts`): models declare which
 *    domains they're preferred for via `routingTags`; factual/legal/medical
 *    bias toward stronger models.
 *
 * Lives in `lib/shared/` (not the Convex domain module) so the provider-JSON
 * schema (`schemas/providers.ts`, `routingTags`) and the Convex detector both
 * key off ONE literal list and can never drift.
 *
 * Structural shapes that `scoreDifficulty` already detects (RAG/tool/multi-turn
 * /structured-output) are deliberately NOT domains — they're read off the
 * difficulty signals instead of re-detected here.
 */
export const domainLiterals = [
  'code',
  'data',
  'math',
  'creative',
  'translation',
  'summary',
  'factual',
  'legal',
  'medical',
  'financial',
  'conversation',
  'general',
] as const;

export type Domain = (typeof domainLiterals)[number];

/** The catch-all domain returned when no category scores above threshold. */
export const DEFAULT_DOMAIN: Domain = 'general';

/**
 * Domains where a wrong/under-reasoned answer carries real-world risk
 * (regulatory, financial, factual-accuracy). Model routing biases these toward
 * the strongest tier and the cascade refuses to accept a cheap draft for them.
 */
export const HIGH_STAKES_DOMAINS: readonly Domain[] = [
  'legal',
  'medical',
  'financial',
  'factual',
];
