/**
 * Validate a step's optional `ui` / `role` annotations against the platform's
 * closed vocabulary. Known-ness is enforced HERE (publish-time) rather than in
 * the Zod file schema, so a workflow file never becomes unloadable as the
 * vocabulary evolves; the renderer additionally degrades gracefully at runtime.
 *
 * - `ui.render` must be a known render-kind            → error
 * - `ui.params.*` values outside their closed set       → warning (degrades)
 * - `ui.params.fields[].type` outside FIELD_TYPES       → warning
 * - `role` must be slug-shaped                          → error
 *   (resolvability against the org's roster is a runtime/advisory concern,
 *    not checked here — a pack must validate without the target org's roster)
 */
import { isFieldType } from '../../../../lib/shared/platform/field_types';
import {
  ARTIFACT_DISPLAYS,
  COLLECTION_LAYOUTS,
  REVIEW_CARDINALITIES,
  REVIEW_MODES,
  STREAM_ENTRY_KINDS,
  isRenderKind,
} from '../../../../lib/shared/platform/render_kinds';
import { getString, isRecord } from '../../../../lib/utils/type-utils';

const ROLE_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

const PARAM_VOCABULARIES: ReadonlyArray<readonly [string, readonly string[]]> =
  [
    ['display', ARTIFACT_DISPLAYS],
    ['layout', COLLECTION_LAYOUTS],
    ['entryKind', STREAM_ENTRY_KINDS],
    ['mode', REVIEW_MODES],
    ['cardinality', REVIEW_CARDINALITIES],
  ];

export function validateStepAnnotations(step: Record<string, unknown>): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if ('ui' in step && step.ui !== undefined) {
    if (!isRecord(step.ui)) {
      errors.push('"ui" must be an object');
    } else {
      const render = getString(step.ui, 'render');
      if (!render) {
        errors.push('"ui.render" is required when "ui" is present');
      } else if (!isRenderKind(render)) {
        errors.push(`"ui.render" is not a known render-kind: "${render}"`);
      }

      const params = isRecord(step.ui.params) ? step.ui.params : undefined;
      if (params) {
        for (const [name, allowed] of PARAM_VOCABULARIES) {
          const value = getString(params, name);
          if (value && !allowed.includes(value)) {
            warnings.push(`"ui.params.${name}" has unknown value "${value}"`);
          }
        }
        if (Array.isArray(params.fields)) {
          for (const field of params.fields) {
            const type = isRecord(field) ? getString(field, 'type') : undefined;
            if (type && !isFieldType(type)) {
              warnings.push(`"ui.params.fields[].type" unknown type "${type}"`);
            }
          }
        }
      }

      const labelKey = getString(step.ui, 'labelKey');
      if (labelKey !== undefined && labelKey.length === 0) {
        warnings.push('"ui.labelKey" should be a non-empty i18n key');
      }
    }
  }

  if ('role' in step && step.role !== undefined) {
    const role = typeof step.role === 'string' ? step.role : undefined;
    if (role === undefined || !ROLE_SLUG_REGEX.test(role)) {
      errors.push('"role" must be a slug (lowercase alphanumeric, "-" or "_")');
    }
  }

  return { errors, warnings };
}
