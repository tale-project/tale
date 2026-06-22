/**
 * The per-message response-shaping advice the Auto router classifier produces,
 * and the pure helpers that turn the prose part of it into a system-prompt
 * fragment.
 *
 * Two distinct, advisory shapes — there are NO per-agent manual overrides any
 * more; the adaptive reasoning governor (effort/temperature) and the router
 * (style/verbosity + a reasoning seed) are the sole, automatic deciders:
 *
 *  - {@link ResponseStyleAdvice} — prose-level tone/depth (`style`) and length
 *    (`verbosity`), rendered into a short instruction suffix appended to the
 *    agent's system prompt for the turn.
 *  - {@link ResponseReasoningSeed} — a coarse effort/creativity hint fed to the
 *    governor as a PRIOR (blended into the difficulty score), never a hard
 *    override. The online controller still refines from observed usage.
 *
 * Pure and dependency-free — the canonical home shared by the router helpers
 * (`auto_route_helpers.ts` aliases these) and the chat backend.
 */

/**
 * Prose-level response shaping the router advises per message: tone/depth
 * (`style`) and length (`verbosity`). `style` controls phrasing; `verbosity`
 * targets length specifically, so both can be set together. Only emitted in
 * Auto mode; a pinned agent's tone comes from its own `systemInstructions`.
 */
export interface ResponseStyleAdvice {
  style?: 'concise' | 'detailed' | 'formal' | 'friendly';
  verbosity?: 'terse' | 'normal' | 'verbose';
}

/**
 * Coarse per-message reasoning seed the router advises — a PRIOR for the
 * adaptive reasoning governor, never a hard override. `effort` seeds how much
 * step-by-step reasoning the turn gets; `creativity` seeds the sampling
 * temperature. The governor blends these into its difficulty score on the first
 * turn (fixing cold-start), then the online controller refines from observed
 * reasoning-token usage + response quality, so a wrong hint self-corrects.
 */
export interface ResponseReasoningSeed {
  effort?: 'low' | 'medium' | 'high';
  creativity?: 'precise' | 'balanced' | 'creative';
}

/**
 * Style → a short system-prompt instruction fragment. Empty string means "no
 * advice" (the default). Appended to the agent instructions for the turn.
 */
export function styleInstructionFragment(
  style: ResponseStyleAdvice['style'],
): string {
  switch (style) {
    case 'concise':
      return 'Response style: be concise. Keep answers brief and to the point; avoid preamble and filler.';
    case 'detailed':
      return 'Response style: be thorough. Provide detailed, comprehensive answers with relevant context and examples.';
    case 'formal':
      return 'Response style: use a professional, formal tone.';
    case 'friendly':
      return 'Response style: use a warm, conversational, friendly tone.';
    default:
      return '';
  }
}

/**
 * Verbosity → a soft length-target fragment, independent of `style`. Empty
 * string means "no advice". `style` controls tone/depth phrasing; `verbosity`
 * targets length specifically, so both can be set together.
 */
export function verbosityInstructionFragment(
  verbosity: ResponseStyleAdvice['verbosity'],
): string {
  switch (verbosity) {
    case 'terse':
      return 'Length: answer in as few words as possible — ideally one or two sentences.';
    case 'normal':
      return 'Length: aim for a moderate, balanced answer length.';
    case 'verbose':
      return 'Length: be expansive — cover edge cases, caveats, and worked examples.';
    default:
      return '';
  }
}

/**
 * Compose the style + verbosity fragments (either may be empty) into the suffix
 * appended to an agent's system instructions for the turn. Returns '' when
 * neither is set.
 */
export function tuningInstructionSuffix(
  advice: ResponseStyleAdvice | undefined,
): string {
  if (!advice) return '';
  const parts = [
    styleInstructionFragment(advice.style),
    verbosityInstructionFragment(advice.verbosity),
  ].filter(Boolean);
  return parts.join('\n');
}
