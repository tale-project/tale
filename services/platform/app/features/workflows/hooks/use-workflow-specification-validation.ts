'use client';

import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import {
  workflowJsonSchema,
  type WorkflowJsonConfig,
} from '@/lib/shared/schemas/workflows';

/** The specification editor's only user-editable field. */
export type WorkflowSpecificationValidationField = 'specification';

/**
 * Server's specification character ceiling — keep in sync with the
 * `z.string().max(...)` on `specification` in `workflowJsonSchema`
 * (`lib/shared/schemas/workflows.ts`); `workflows.test.ts` pins the same
 * number server-side.
 */
const SPECIFICATION_MAX_LENGTH = 20_000;

export interface WorkflowSpecificationValidation {
  /** Whether the draft config would pass the server's `saveWorkflow` → `workflowJsonSchema.parse`. */
  isValid: boolean;
  /**
   * Top-level config keys with at least one schema issue (each Zod issue's
   * `path[0]`). Superset of {@link WorkflowSpecificationValidationField} —
   * keys without an inline surface still gate Save via `isValid`.
   */
  invalidFields: ReadonlySet<string>;
}

/**
 * Client-side mirror of the save boundary's validation
 * (`saveWorkflow` → `workflowJsonSchema.parse`). Running the SAME schema
 * keeps the specification editor's Save gate exactly as strict as the
 * server — the editor only ever mutates `specification` (and the
 * programmatically-derived `specificationMeta`), so Save can never submit a
 * draft the server would reject for exceeding the 20,000-character ceiling
 * (#2665). `config` should already carry whatever the save path would
 * actually persist (see `WorkflowSpecification`'s trim-before-save
 * transform) so a would-be-invalid draft that trims down to something valid
 * never false-positives.
 */
export function computeWorkflowSpecificationValidation(
  config: WorkflowJsonConfig,
): WorkflowSpecificationValidation {
  const parsed = workflowJsonSchema.safeParse(config);
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

export interface WorkflowSpecificationValidationResult extends WorkflowSpecificationValidation {
  /**
   * Localized inline error per surfaced field — feed straight into the
   * field's error message. Absent key = field is valid.
   */
  fieldErrors: Partial<Record<WorkflowSpecificationValidationField, string>>;
}

/**
 * {@link computeWorkflowSpecificationValidation} plus the localized inline
 * field error. `config` is `undefined` while the workflow is still loading —
 * that reads as valid (nothing to reject yet; `isLoading`/`isDirty` already
 * gate Save in that window).
 */
export function useWorkflowSpecificationValidation(
  config: WorkflowJsonConfig | undefined,
): WorkflowSpecificationValidationResult {
  const { t } = useT('workflows');
  const { t: tCommon } = useT('common');
  return useMemo(() => {
    if (config === undefined) {
      return {
        isValid: true,
        invalidFields: new Set<string>(),
        fieldErrors: {},
      };
    }
    const validation = computeWorkflowSpecificationValidation(config);
    const fieldErrors: Partial<
      Record<WorkflowSpecificationValidationField, string>
    > = {};
    if (validation.invalidFields.has('specification')) {
      fieldErrors.specification = tCommon('validation.maxLength', {
        field: t('editorView.specification'),
        max: SPECIFICATION_MAX_LENGTH,
      });
    }
    return { ...validation, fieldErrors };
  }, [config, t, tCommon]);
}
