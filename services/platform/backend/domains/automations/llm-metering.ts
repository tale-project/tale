import type { Sql } from 'postgres';

import { AUTOMATION_SUBJECT_ID } from '../../../lib/shared/constants/usage.ts';
import {
  type DirectCallLease,
  type DirectCallSubject,
  openTokenCall,
  releaseDirectCall,
  settleTokenCall,
  type TokenCallModel,
} from '../governance/direct-calls.ts';
import { resolveAutomationRunAttribution } from '../sandbox/op-attribution.ts';

/**
 * An automation's `llm` step is a direct model call the organization pays
 * for, made outside any sandbox session — so its run is its billing subject
 * (`resolveAutomationRunAttribution`): the person who started the run, or
 * `__automation__` for a run a trigger started, under the automation's
 * name, with the key a keyed door used and the projects the run is in —
 * what the run's agent steps book under too.
 *
 * Each call is a direct call (`governance/direct-calls.ts`): before it, its
 * worst case — the prompt and the node's whole output cap at the catalog
 * price — is measured against every cap that binds that subject, counting
 * what all work in flight holds, and held while the call runs; once a cap
 * has too little room the step is refused. After it, the tokens the
 * provider reported are priced from the catalog and booked in the hold's
 * place.
 */

/** The longest one call may hold its worst case: the model call's own
 * timeout (180 s) with room to spare. */
const LLM_STEP_CALL_MAX_MS = 10 * 60 * 1000;

export type LlmStepAdmission =
  | { allowed: true; lease: DirectCallLease }
  | { allowed: false; reason: string };

export async function openLlmStepCall(
  sql: Sql,
  args: TokenCallModel & {
    runId: string;
    /** The run's automation — the ledger's label when the run itself can
     * no longer be read. */
    automation: string;
    promptTokens: number;
    maxOutputTokens: number;
  },
): Promise<LlmStepAdmission> {
  const attribution = await resolveAutomationRunAttribution(sql, args);
  const subject: DirectCallSubject =
    attribution !== null
      ? {
          userId: attribution.userId,
          agentSlug: attribution.agentSlug ?? args.automation,
          ...(attribution.apiKeyId !== undefined
            ? { apiKeyId: attribution.apiKeyId }
            : {}),
          ...(attribution.projectIds !== undefined
            ? { projectIds: attribution.projectIds }
            : {}),
        }
      : // A run with no starter to read is still the organization's spend.
        { userId: AUTOMATION_SUBJECT_ID, agentSlug: args.automation };
  const admission = await openTokenCall(sql, {
    organizationId: args.organizationId,
    provider: args.provider,
    model: args.model,
    lane: 'llm-step',
    subject,
    promptTokens: args.promptTokens,
    maxOutputTokens: args.maxOutputTokens,
    maxDurationMs: LLM_STEP_CALL_MAX_MS,
  });
  return admission.allowed
    ? { allowed: true, lease: admission.lease }
    : { allowed: false, reason: admission.reason };
}

/** One call's spend, as the provider reported it. */
export interface LlmStepUsage extends TokenCallModel {
  lease: DirectCallLease;
  inputTokens: number;
  outputTokens: number;
}

/** Book the call at the catalog price in its hold's place. */
export async function settleLlmStepCall(
  sql: Sql,
  usage: LlmStepUsage,
): Promise<void> {
  await settleTokenCall(sql, usage.lease, {
    organizationId: usage.organizationId,
    provider: usage.provider,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
}

/** Release the hold of a call that reported no usage. */
export async function releaseLlmStepCall(
  sql: Sql,
  args: { lease: DirectCallLease },
): Promise<void> {
  await releaseDirectCall(sql, args.lease);
}
