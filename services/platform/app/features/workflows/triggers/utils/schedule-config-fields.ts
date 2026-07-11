/**
 * Turn a workflow start step's `inputSchema` into `AutomationConfigField[]` —
 * the SAME grammar (and the SAME `ConfigFieldInput` / `initFieldValues` /
 * `deriveConfigValues` machinery) the automation `Form` block uses
 * (`registry/connected/form.tsx`), so the schedule dialog gets a structured
 * variables form instead of a second bespoke control vocabulary (#2614).
 *
 * Two properties get special handling instead of a plain text control:
 *  - `projectId` becomes a `select` field (options supplied by the caller,
 *    from `useProjects`) so a schedule's bound project is CHOSEN, not typed.
 *  - a schema declaring BOTH `owner` and `repo` collapses to one derived
 *    "GitHub repository" field (`owner/repo` or a full URL), reusing
 *    `deriveConfigValues`'s existing split mechanism.
 *
 * Returns `null` when a property's shape can't render as a plain control
 * (`array`/`object`, other than the recognized owner/repo pair) — the caller
 * falls back to the raw-JSON editor for that schedule rather than silently
 * dropping the field.
 */

import { deriveConfigValues } from '@/lib/shared/platform/derive_config';
import type { AutomationConfigField } from '@/lib/shared/schemas/automation_views';

import type { InputSchema } from '../../utils/input-schema-template';

type SchemaProperty = InputSchema['properties'][string];

/** Synthetic field key for the combined "owner/repo or GitHub URL" input —
 *  never sent to the backend on its own; `assembleScheduleVariables` strips
 *  it once `deriveConfigValues` has split it into the real `owner`/`repo`
 *  keys the workflow reads. */
export const SCHEDULE_REPO_FIELD_KEY = '__githubRepo';

/**
 * `owner/repo`, or a full `https://github.com/owner/repo(.git)` URL — one
 * input, two capture groups. Mirrors the pattern already proven in
 * `lib/shared/platform/derive_config.test.ts` (the retired issue-desk rule).
 */
export const GITHUB_REPO_DERIVE_PATTERN =
  '^(?:https?://github\\.com/)?([^/\\s]+)/([^/\\s#]+?)(?:\\.git)?/?$';

/** Caller-supplied literal copy for the two special-cased fields (schema
 *  `description`s become each field's `help`, same as any other field). */
export interface ScheduleFieldCopy {
  projectLabel: string;
  projectPlaceholder: string;
  repoLabel: string;
  repoPlaceholder: string;
}

/** `select` options for the `projectId` field — the org's projects. */
export interface ScheduleProjectOption {
  value: string;
  label: string;
}

/**
 * Build the field list for a workflow's `inputSchema`, or `null` when a
 * property can't render as a plain control. `[]` (not `null`) when the
 * schema declares no properties at all — the caller's `hasInputSchema` gate
 * already skips rendering the section in that case.
 */
export function buildScheduleConfigFields(
  schema: InputSchema | undefined,
  projectOptions: ScheduleProjectOption[],
  copy: ScheduleFieldCopy,
): AutomationConfigField[] | null {
  if (!schema?.properties) return [];

  const required = new Set(schema.required ?? []);
  const properties = schema.properties;
  const keys = Object.keys(properties);
  const combineRepo = keys.includes('owner') && keys.includes('repo');

  const fields: AutomationConfigField[] = [];
  let repoFieldAdded = false;

  for (const key of keys) {
    const prop: SchemaProperty = properties[key];

    if (combineRepo && (key === 'owner' || key === 'repo')) {
      if (repoFieldAdded) continue;
      repoFieldAdded = true;
      fields.push({
        key: SCHEDULE_REPO_FIELD_KEY,
        type: 'string',
        label: copy.repoLabel,
        placeholder: copy.repoPlaceholder,
        help: properties.owner?.description ?? properties.repo?.description,
        required: required.has('owner') || required.has('repo'),
        derive: {
          pattern: GITHUB_REPO_DERIVE_PATTERN,
          into: ['owner', 'repo'],
        },
      });
      continue;
    }

    if (key === 'projectId') {
      fields.push({
        key: 'projectId',
        type: 'select',
        label: copy.projectLabel,
        placeholder: copy.projectPlaceholder,
        help: prop.description,
        required: required.has('projectId'),
        options: projectOptions,
      });
      continue;
    }

    if (prop.type === 'array' || prop.type === 'object') {
      return null;
    }

    fields.push({
      key,
      type: prop.type === 'integer' ? 'number' : prop.type,
      help: prop.description,
      required: required.has(key),
    });
  }

  return fields;
}

/** A value counts as "not yet bound" for seeding purposes when it's absent,
 *  null, or a blank string — the same placeholder shapes the schedule
 *  dialog and `buildInputTemplateFromSchema` pre-fill. */
function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '')
  );
}

/**
 * Seed `initFieldValues`' `stored` argument for the built fields:
 *  - `projectId` defaults to the schedule row's own bound project
 *    (`wfSchedules.projectId`) when the variables carry none — the "defaults
 *    to binding" half of #2614;
 *  - the combined repo field's raw text is reconstructed from existing
 *    `owner`/`repo` values, when both are already set, so editing a
 *    previously-JSON-authored schedule doesn't show a blank repo input.
 */
export function seedScheduleFieldValues(
  fields: AutomationConfigField[],
  variables: Record<string, unknown> | undefined,
  boundProjectId: string | undefined,
): Record<string, unknown> {
  const stored: Record<string, unknown> = { ...variables };

  if (boundProjectId !== undefined && isBlank(stored.projectId)) {
    stored.projectId = boundProjectId;
  }

  const repoField = fields.find((f) => f.key === SCHEDULE_REPO_FIELD_KEY);
  if (repoField?.derive) {
    const [ownerKey, repoKey] = repoField.derive.into;
    const owner = stored[ownerKey];
    const repo = stored[repoKey];
    if (!isBlank(owner) && !isBlank(repo)) {
      stored[SCHEDULE_REPO_FIELD_KEY] = `${String(owner)}/${String(repo)}`;
    }
  }

  return stored;
}

/**
 * Run the structured form's local values through `deriveConfigValues` and
 * strip the synthetic repo field's own raw key — the object shape the
 * backend (and `getMissingRequiredFields`) expect.
 */
export function assembleScheduleVariables(
  fields: AutomationConfigField[],
  values: Record<string, string | boolean>,
): { variables: Record<string, unknown>; invalidFields: string[] } {
  const { values: derived, invalid } = deriveConfigValues(fields, values);
  const variables: Record<string, unknown> = { ...derived };
  delete variables[SCHEDULE_REPO_FIELD_KEY];
  return { variables, invalidFields: invalid };
}
