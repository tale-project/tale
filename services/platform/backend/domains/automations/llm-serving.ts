import type { Sql } from 'postgres';

import { walkLlmServing } from '../../core/automations/llm_call.ts';
import type { ActionCtx } from '../../core/lib/ctx.ts';
import type { DirectServingWalk } from '../../core/lib/providers/agent_serving.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { chatShimHandlers } from '../chat/shim.ts';
import { credentialShimHandlers } from '../provider_credentials/service.ts';

/**
 * An `llm` step's serving walk for one organization: the run's own
 * (`walkLlmServing`), read through the handlers its context needs. Every
 * question about whether a model would serve such a step asks here — the
 * validator's `LLM_MODEL_UNAVAILABLE` warning, and the model a shipped pack
 * is given — so neither can disagree with a live run.
 */
export function walkLlmServingForOrganization(
  sql: Sql,
  organizationId: string,
  modelId: string,
): Promise<DirectServingWalk> {
  const shim = createCtxShim({
    ...chatShimHandlers(sql),
    ...credentialShimHandlers(sql),
  });
  return walkLlmServing(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 walk; its ctx reads (the org slug, the default credential rows) are covered by these handlers
    shim as unknown as ActionCtx,
    organizationId,
    modelId,
  );
}
