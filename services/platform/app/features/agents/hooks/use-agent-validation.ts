'use client';

import { useMemo } from 'react';

import type { AgentJsonConfig } from '@/convex/agents/file_utils';
import { useT } from '@/lib/i18n/client';
import { agentJsonSchema } from '@/lib/shared/schemas/agents';

/** The required fields the editor surfaces with inline error messages. */
export type AgentValidationField =
  | 'displayName'
  | 'systemInstructions'
  | 'supportedModels';

export interface AgentValidation {
  /** Whether the draft config would pass the server's `agentJsonSchema.parse`. */
  isValid: boolean;
  /**
   * Top-level config keys with at least one schema issue (each Zod issue's
   * `path[0]`). Superset of {@link AgentValidationField} — keys without an
   * inline surface still gate Save via `isValid`.
   */
  invalidFields: ReadonlySet<string>;
}

/**
 * Client-side mirror of the save boundary's validation
 * (`saveAgent` → `agentJsonSchema.parse`). Running the SAME schema keeps the
 * editor's Save gate exactly as strict as the server — including the i18n
 * fallbacks (a displayName in any locale counts) and the external-agent model
 * exemptions — so Save can never submit a config the server would reject for
 * these fields (#2665).
 */
export function computeAgentValidation(
  config: AgentJsonConfig,
): AgentValidation {
  const parsed = agentJsonSchema.safeParse(config);
  if (parsed.success) {
    return { isValid: true, invalidFields: new Set<string>() };
  }
  const invalidFields = new Set<string>();
  for (const issue of parsed.error.issues) {
    const head = issue.path[0];
    if (typeof head === 'string') invalidFields.add(head);
  }
  return { isValid: false, invalidFields };
}

export interface AgentValidationResult extends AgentValidation {
  /**
   * Localized inline error per surfaced field — feed straight into the
   * field's `errorMessage`. Absent key = field is valid.
   */
  fieldErrors: Partial<Record<AgentValidationField, string>>;
}

/** {@link computeAgentValidation} plus the localized inline field errors. */
export function useAgentValidation(
  config: AgentJsonConfig,
): AgentValidationResult {
  const { t } = useT('settings');
  return useMemo(() => {
    const validation = computeAgentValidation(config);
    const fieldErrors: Partial<Record<AgentValidationField, string>> = {};
    if (validation.invalidFields.has('displayName')) {
      fieldErrors.displayName = t('agents.validation.displayNameRequired');
    }
    if (validation.invalidFields.has('systemInstructions')) {
      fieldErrors.systemInstructions = t(
        'agents.validation.systemInstructionsRequired',
      );
    }
    if (validation.invalidFields.has('supportedModels')) {
      fieldErrors.supportedModels = t('agents.validation.modelRequired');
    }
    return { ...validation, fieldErrors };
  }, [config, t]);
}
