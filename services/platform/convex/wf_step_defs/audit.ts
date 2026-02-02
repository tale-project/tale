/**
 * Workflow Step Audit Logging
 *
 * Tracks changes to workflow step definitions for debugging and compliance.
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

type EditMode = 'visual' | 'json' | 'ai';
type ChangeType = 'created' | 'updated' | 'deleted';

interface AuditStepChangeParams {
  stepId: Id<'wfStepDefs'>;
  wfDefinitionId: Id<'wfDefinitions'>;
  organizationId: string;
  changedBy: string;
  changeType: ChangeType;
  editMode: EditMode;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export async function auditStepChange(
  ctx: MutationCtx,
  params: AuditStepChangeParams,
): Promise<Id<'wfStepAuditLogs'>> {
  return await ctx.db.insert('wfStepAuditLogs', {
    stepId: params.stepId,
    wfDefinitionId: params.wfDefinitionId,
    organizationId: params.organizationId,
    changedBy: params.changedBy,
    changedAt: Date.now(),
    changeType: params.changeType,
    editMode: params.editMode,
    before: params.before,
    after: params.after,
  });
}
