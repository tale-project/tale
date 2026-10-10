import type { TriggerView } from '@tale/shared/schemas/automation-trigger';
import { useMemo } from 'react';

import { triggerInputSample } from '@/lib/automations/trigger-input';
import type { Issue } from '@/lib/engine/core/types';

import {
  fixableFields,
  type MissingInputField,
  missingRequiredFields,
} from '../lib/fixed-input';
import { parseFixedInput, type TriggerDraft } from '../lib/trigger-draft';
import { useJsonInputDraft } from './use-json-input-draft';
import { useSchedulePreview } from './use-schedule-preview';

/**
 * What a trigger would start a run with, and whether the deployed version
 * takes it — from the sample the save's own check reads
 * (`triggerInputSample`, over the builder the scan, the webhook door and the
 * event dispatch start runs with), so the input a person is shown is the
 * input a run receives.
 *
 * The check against the deployed version's `inputs` is the client's best
 * effort, as in the run dialog; while the form is what is stored, the
 * server's own warning from the last save wins. A webhook's body is unknown
 * until a delivery comes, so a problem inside `payload` is not held against
 * the trigger.
 */

export type TriggerInputVerdict =
  | { kind: 'accepted' }
  | {
      kind: 'refused';
      /** The fields the input breaks, dotted. */
      paths: string[];
    };

export interface TriggerInputCheck {
  /** The run input, fixed input included; null for an event trigger that
   * names no event yet. */
  input: Record<string, unknown> | null;
  /** The due time a schedule's sample fires at — its next start; null for
   * the other kinds. */
  firedAt: number | null;
  /** The required fields the run input lacks that a fixed input can add. */
  missing: MissingInputField[];
  /** Null while nothing is deployed, or nothing can be sampled. */
  verdict: TriggerInputVerdict | null;
  /** The last save's warnings, while the form is what it saved. */
  warnings: Issue[];
}

/** The dotted path a JSON Pointer names (`/payload/id` → `payload.id`). */
function pointerPath(pointer: string): string {
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .join('.');
}

/** Whether `path` is `prefix` or inside it. */
function within(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`);
}

/** The field names a mismatch warning says are missing. */
function warningPaths(warning: Issue): string[] {
  const missing = warning.params?.missing;
  return Array.isArray(missing)
    ? missing.filter((name): name is string => typeof name === 'string')
    : [];
}

export function useTriggerInputCheck({
  draft,
  stored,
  inputsSchema,
  deployed,
  clean,
  saveWarnings,
}: {
  draft: TriggerDraft;
  stored: TriggerView | null;
  /** The deployed version's `inputs`; undefined when it has none. */
  inputsSchema: Record<string, unknown> | undefined;
  /** A version is deployed, and its document has been read. */
  deployed: boolean;
  /** The draft is what is stored. */
  clean: boolean;
  /** What the last save of this trigger answered. */
  saveWarnings: readonly Issue[];
}): TriggerInputCheck {
  const preview = useSchedulePreview(draft, stored, 1);
  const { check } = useJsonInputDraft(inputsSchema);
  const nextStart = preview.occurrences?.[0]?.at;
  return useMemo(() => {
    // A schedule's sample fires at its next start; without one (a schedule
    // the form refuses), now.
    const now = nextStart ?? Date.now();
    const firedAt = draft.kind === 'schedule' ? now : null;
    const sample = triggerInputSample(
      {
        kind: draft.kind,
        event: draft.event,
        // Text that is no JSON object is refused on its own field; the
        // sample goes on without it.
        input: parseFixedInput(draft.input) ?? null,
      },
      now,
    );
    const input = sample?.input ?? null;
    const missing = fixableFields(missingRequiredFields(inputsSchema, input));
    const warnings = clean ? [...saveWarnings] : [];
    let verdict: TriggerInputVerdict | null = null;
    if (deployed && sample !== null) {
      const mismatch = warnings.find(
        (warning) => warning.code === 'TRIGGER_INPUT_MISMATCH',
      );
      if (mismatch !== undefined) {
        verdict = { kind: 'refused', paths: warningPaths(mismatch) };
      } else {
        const ignored = sample.ignorePointers.map(pointerPath);
        const checked = check(sample.input);
        const paths = checked.valid
          ? []
          : checked.paths.filter(
              (path) => !ignored.some((prefix) => within(path, prefix)),
            );
        verdict =
          paths.length === 0
            ? { kind: 'accepted' }
            : { kind: 'refused', paths };
      }
    }
    return { input, firedAt, missing, verdict, warnings };
  }, [
    draft.kind,
    draft.event,
    draft.input,
    nextStart,
    inputsSchema,
    deployed,
    clean,
    saveWarnings,
    check,
  ]);
}
