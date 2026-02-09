/**
 * Update workflow step
 */

import { merge } from 'lodash';

import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { UpdateStepArgs } from './types';

import { validateStepConfig } from '../../workflow_engine/helpers/validation/validate_step_config';

/** Partial update type for wfStepDefs - used for ctx.db.patch */
type StepDefPatch = Partial<Omit<Doc<'wfStepDefs'>, '_id' | '_creationTime'>>;

export async function updateStep(
  ctx: MutationCtx,
  args: UpdateStepArgs,
): Promise<Doc<'wfStepDefs'> | null> {
  const existing = await ctx.db.get(args.stepRecordId);
  if (!existing) {
    return null;
  }

  if (!args.updates || typeof args.updates !== 'object') {
    // Nothing to update; return current record
    return existing as Doc<'wfStepDefs'>;
  }

  const updates = args.updates as Record<string, unknown>;

  // Only run stepConfig validation when core step definition fields change.
  const affectsCoreFields =
    'stepSlug' in updates ||
    'name' in updates ||
    'stepType' in updates ||
    'config' in updates;

  if (affectsCoreFields) {
    // Merge existing document with updates in-memory to get the full effective state
    const merged = merge({}, existing, updates) as {
      stepSlug?: string;
      name?: string;
      stepType?: string;
      config?: unknown;
    };

    const validation = validateStepConfig({
      stepSlug: merged.stepSlug,
      name: merged.name,
      stepType: merged.stepType,
      config: merged.config,
    });

    if (!validation.valid) {
      throw new Error(
        `Invalid step configuration: ${validation.errors.join(', ')}`,
      );
    }
  }

  // Cast to StepDefPatch - runtime validation already performed above
  await ctx.db.patch(args.stepRecordId, args.updates as StepDefPatch);

  const updated = await ctx.db.get(args.stepRecordId);
  return updated as Doc<'wfStepDefs'> | null;
}
