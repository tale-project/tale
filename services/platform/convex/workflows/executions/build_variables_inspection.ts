/**
 * Shape the deserialized execution variables into the payload the step-debug
 * inspector consumes (#1490). Pure so it can be unit-tested; the action wraps
 * it after resolving storage-backed variables.
 *
 * Step outputs and `lastOutput` are capped per entry: an oversized value is
 * replaced by a truncated JSON-string preview plus a flag, so the action
 * result stays well below Convex's response size limits even for LLM-heavy
 * workflows.
 */

import { getString, isRecord } from '../../../lib/utils/type-utils';

export const INSPECTION_OUTPUT_MAX_CHARS = 32 * 1024;

export interface InspectedStep {
  stepType?: string;
  name?: string;
  output: unknown;
  outputTruncated?: boolean;
}

export interface ExecutionVariablesInspection {
  input: unknown;
  /** User-set variables (the `set_variables` namespace). */
  variables: Record<string, unknown>;
  /** Per-step outputs keyed by step slug, each capped at INSPECTION_OUTPUT_MAX_CHARS. */
  steps: Record<string, InspectedStep>;
  lastOutput: unknown;
  lastOutputTruncated?: boolean;
}

function capValue(value: unknown): { value: unknown; truncated: boolean } {
  const json = JSON.stringify(value);
  if (typeof json !== 'string' || json.length <= INSPECTION_OUTPUT_MAX_CHARS) {
    return { value, truncated: false };
  }
  return { value: json.slice(0, INSPECTION_OUTPUT_MAX_CHARS), truncated: true };
}

export function buildVariablesInspection(
  variables: Record<string, unknown>,
  input: unknown,
): ExecutionVariablesInspection {
  const steps: Record<string, InspectedStep> = {};
  const rawSteps = isRecord(variables.steps) ? variables.steps : {};
  for (const [slug, info] of Object.entries(rawSteps)) {
    if (!isRecord(info)) continue;
    const { value, truncated } = capValue(info.output);
    steps[slug] = {
      stepType: getString(info, 'stepType'),
      name: getString(info, 'name'),
      output: value,
      ...(truncated ? { outputTruncated: true } : {}),
    };
  }

  const lastOutput = capValue(variables.lastOutput);

  return {
    input,
    variables: isRecord(variables.variables) ? variables.variables : {},
    steps,
    lastOutput: lastOutput.value,
    ...(lastOutput.truncated ? { lastOutputTruncated: true } : {}),
  };
}
