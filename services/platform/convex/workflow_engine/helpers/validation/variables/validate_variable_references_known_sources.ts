/**
 * Validate Variable References Against Known Sources
 *
 * Detects variable references that don't use a recognized prefix.
 * With proper namespacing, all valid references must start with a known prefix:
 * steps, loop, secrets, input, config, variables, or a system variable.
 *
 * Any reference parsed as type 'variable' (the catch-all) is invalid.
 */

import type { ParsedVariableReference } from './types';

const KNOWN_PREFIXES = [
  'steps',
  'loop',
  'secrets',
  'input',
  'config',
  'variables',
];

/**
 * Validate that all variable references use recognized source prefixes.
 * References of type 'variable' (the parser catch-all) indicate an unrecognized
 * source and are flagged as errors with helpful suggestions.
 */
export function validateVariableReferencesKnownSources(
  allRefs: ParsedVariableReference[],
  knownStepSlugs: Set<string>,
  currentStepSlug: string,
): { errors: string[] } {
  const errors: string[] = [];

  for (const ref of allRefs) {
    // Only check catch-all 'variable' type — all other types are recognized
    if (ref.type !== 'variable') {
      continue;
    }

    // Skip complex expressions that can't be statically validated
    if (ref.path[0] === '__complex_expression__') {
      continue;
    }

    const root = ref.path[0];

    // Pattern A: singular "step." instead of "steps."
    if (root === 'step' && ref.path.length >= 2) {
      const corrected = `steps.${ref.path.slice(1).join('.')}`;
      errors.push(
        `Step "${currentStepSlug}" has reference "${ref.originalTemplate}" that uses singular "step" instead of "steps". ` +
          `Use "{{${corrected}}}" instead.`,
      );
      continue;
    }

    // Pattern B: root matches a known step slug (missing "steps." prefix)
    if (knownStepSlugs.has(root)) {
      const restPath = ref.path.slice(1);
      let suggestion: string;

      if (restPath.length === 0) {
        suggestion = `steps.${root}.output.data`;
      } else if (restPath[0] === 'output') {
        // Already has output path, just needs "steps." prefix
        suggestion = `steps.${ref.path.join('.')}`;
      } else {
        // Missing both "steps." prefix and "output.data" path
        suggestion = `steps.${root}.output.data.${restPath.join('.')}`;
      }

      errors.push(
        `Step "${currentStepSlug}" has reference "${ref.originalTemplate}" that appears to reference step "${root}" ` +
          `without the required "steps." prefix. Use "{{${suggestion}}}" instead.`,
      );
      continue;
    }

    // Pattern C: unknown variable — no recognized prefix
    const prefixList = KNOWN_PREFIXES.join(', ');

    if (ref.path.length > 1) {
      // Dotted path — likely a hallucinated step reference or mistyped variable
      const hasOutputLikePath = ref.path.some((p) =>
        ['output', 'response', 'result', 'data'].includes(p),
      );

      if (hasOutputLikePath) {
        errors.push(
          `Step "${currentStepSlug}" has reference "${ref.originalTemplate}" with unknown source "${root}". ` +
            `If referencing a step, use "{{steps.${root}.output.data...}}". ` +
            `All references must use a known prefix: ${prefixList}.`,
        );
      } else {
        errors.push(
          `Step "${currentStepSlug}" has reference "${ref.originalTemplate}" with unknown source "${root}". ` +
            `All references must use a known prefix: ${prefixList}. ` +
            `Use "{{config.${root}}}" for workflow config variables or "{{variables.${root}}}" for set_variables output.`,
        );
      }
    } else {
      // Single segment — bare variable name without prefix
      errors.push(
        `Step "${currentStepSlug}" has reference "${ref.originalTemplate}" with no recognized prefix. ` +
          `All references must use a known prefix: ${prefixList}. ` +
          `Use "{{config.${root}}}" for workflow config variables or "{{variables.${root}}}" for set_variables output.`,
      );
    }
  }

  return { errors };
}
