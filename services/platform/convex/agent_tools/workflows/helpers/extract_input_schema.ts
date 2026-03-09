/**
 * Extract inputSchema from a start step's config.
 *
 * The step config is a union type (stepConfigValidator) that varies by step type.
 * For start steps, it may contain an `inputSchema` field. This helper safely
 * extracts it using runtime checks.
 */

import type { WorkflowInputSchema } from '../../../workflow_engine/helpers/validation/validate_workflow_input';

import { isRecord } from '../../../../lib/utils/type-guards';

export function extractInputSchema(
  stepConfig: unknown,
): WorkflowInputSchema | undefined {
  if (!isRecord(stepConfig)) return undefined;

  const { inputSchema } = stepConfig;
  if (!isRecord(inputSchema)) return undefined;

  if (!isRecord(inputSchema.properties)) return undefined;

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated structure above matches WorkflowInputSchema
  return inputSchema as WorkflowInputSchema;
}
