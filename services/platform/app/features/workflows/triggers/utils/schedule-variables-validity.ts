/**
 * Shared "is this schedule save valid" gate for the schedule dialog's
 * structured-form AND raw-JSON variables editor — reuses
 * `getMissingRequiredFields`, the exact function the workflow test panel
 * gates Run on (`workflow-tester.tsx`), so a schedule can't be saved with a
 * required variable left blank in either editing mode (#2608).
 */

import {
  getMissingRequiredFields,
  type InputSchema,
} from '../../utils/input-schema-template';

export interface ScheduleVariablesValidityInput {
  /** Whether the workflow declares an inputSchema at all — when it doesn't,
   *  the variables editor isn't shown and there's nothing to validate. */
  hasInputSchema: boolean;
  inputSchema: InputSchema | undefined;
  mode: 'form' | 'json';
  /** The raw-JSON editor's parsed value, or `null` when it isn't valid JSON
   *  (an object). Only consulted when `mode === 'json'`. */
  parsedJson: Record<string, unknown> | null;
  /** The variables that would actually be saved right now, in whichever
   *  mode is active. */
  effectiveVariables: Record<string, unknown>;
  /** How many structured fields' entered text failed to derive (e.g. the
   *  combined GitHub repo field). Only consulted when `mode === 'form'`. */
  deriveInvalidCount: number;
}

export interface ScheduleVariablesValidity {
  missingRequiredFields: string[];
  missingRequiredSet: Set<string>;
  /** `false` only in JSON mode, when the entered text isn't a valid object. */
  jsonIsValid: boolean;
  /** Gates the dialog's Save button. */
  variablesValid: boolean;
}

export function computeScheduleVariablesValidity({
  hasInputSchema,
  inputSchema,
  mode,
  parsedJson,
  effectiveVariables,
  deriveInvalidCount,
}: ScheduleVariablesValidityInput): ScheduleVariablesValidity {
  const jsonIsValid = mode !== 'json' || parsedJson !== null;
  const missingRequiredFields = hasInputSchema
    ? getMissingRequiredFields(inputSchema, effectiveVariables)
    : [];
  const missingRequiredSet = new Set(missingRequiredFields);

  const variablesValid = !hasInputSchema
    ? true
    : mode === 'json'
      ? jsonIsValid && missingRequiredFields.length === 0
      : missingRequiredFields.length === 0 && deriveInvalidCount === 0;

  return {
    missingRequiredFields,
    missingRequiredSet,
    jsonIsValid,
    variablesValid,
  };
}
