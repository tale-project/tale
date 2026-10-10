/**
 * What an automation's trigger would hand its runs, checked before any run:
 * against the `inputs` schema of the version that runs, and for a template
 * in the trigger's fixed input. The editor's Problems panel asks it through
 * the store's `triggerInput` seam; the host asks it when a trigger is saved
 * and when a version is deployed, so all three say the same.
 *
 * A warning, never a refusal: a trigger and a version change apart.
 */

import type { ErrorObject } from 'ajv';

import { warn } from '../errors';
import type { TriggerInputSample, TriggerKind } from '../slots';
import type { Issue } from '../types';
import { describeSchemaErrors } from './schema';

/** A compiled inputs check, shaped like Ajv's `ValidateFunction`. */
export interface InputsCheck {
  (input: unknown): boolean;
  errors?: ErrorObject[] | null;
}

/** What every run a refused trigger starts comes to. */
const REFUSED: Record<TriggerKind, string> = {
  schedule: 'every scheduled run is refused',
  webhook: 'every delivery is refused',
  event: 'every run it starts is refused',
};

/** What each kind passes besides its fixed input. */
const PASSES: Record<TriggerKind, string> = {
  schedule: 'a schedule passes trigger and firedAt',
  webhook: 'a webhook passes trigger and payload',
  event: 'an event passes trigger, event and payload',
};

/** The most template paths one warning names. */
const MAX_TEMPLATED_PATHS = 10;

/** The dotted paths of the strings in `value` that hold a template. */
function templatedPaths(value: unknown, path: string, found: string[]): void {
  if (found.length >= MAX_TEMPLATED_PATHS) return;
  if (typeof value === 'string') {
    if (value.includes('{{')) found.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      templatedPaths(
        item,
        path === '' ? String(index) : `${path}.${index}`,
        found,
      );
    });
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      templatedPaths(item, path === '' ? key : `${path}.${key}`, found);
    }
  }
}

/**
 * The warnings a trigger earns before it starts a run:
 * `TRIGGER_INPUT_MISMATCH` when `check` (the inputs schema of the version
 * that runs; null when it declares none) refuses what the trigger sends —
 * a problem under one of the sample's `ignorePointers` (a webhook's body)
 * is not held against it — and `TRIGGER_INPUT_NOT_TEMPLATED` when its
 * fixed input holds a template, which arrives as text and is never
 * evaluated.
 */
export function triggerInputWarnings(
  check: InputsCheck | null,
  sample: TriggerInputSample,
): Issue[] {
  const issues: Issue[] = [];
  if (check !== null && !check(sample.input)) {
    const errors = (check.errors ?? []).filter(
      (error) =>
        !sample.ignorePointers.some(
          (pointer) =>
            error.instancePath === pointer ||
            error.instancePath.startsWith(`${pointer}/`),
        ),
    );
    if (errors.length > 0) {
      const described = describeSchemaErrors(errors);
      const missing = described
        .filter((_, i) => errors[i]?.keyword === 'required')
        .map((d) => d.path);
      const problems = described.map((d) =>
        d.path === '' ? d.message : `${d.path} ${d.message}`,
      );
      issues.push(
        warn(
          'TRIGGER_INPUT_MISMATCH',
          `the ${sample.kind} trigger starts runs with {${Object.keys(sample.input).join(', ')}}, which the inputs schema refuses: ${problems.join('; ')} — ${REFUSED[sample.kind]}`,
          {
            hint: `${PASSES[sample.kind]}, plus its fixed input: declare those in the inputs schema, and give the trigger a fixed input with every other field it needs or make those fields optional`,
            at: { pointer: '/inputs' },
            params: { kind: sample.kind, missing, problems },
          },
        ),
      );
    }
  }
  const paths: string[] = [];
  templatedPaths(sample.fixedInput, '', paths);
  if (paths.length > 0) {
    issues.push(
      warn(
        'TRIGGER_INPUT_NOT_TEMPLATED',
        `the trigger's fixed input holds a template at ${paths.join(', ')}; a fixed input is plain data, so the template arrives as text and is never evaluated`,
        {
          hint: 'map values from the payload with a transform node instead',
          at: { pointer: '/inputs' },
          params: { paths },
        },
      ),
    );
  }
  return issues;
}
