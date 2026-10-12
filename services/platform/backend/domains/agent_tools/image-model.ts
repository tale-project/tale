import type { Sql } from 'postgres';

import type { ActionCtx } from '../../core/lib/ctx.ts';
import {
  resolveImageGenerationModel,
  type ResolvedImageModel,
} from '../../core/lib/providers/resolve_image_model.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { chatShimHandlers } from '../chat/shim.ts';

/**
 * The image model an agent turn may use, or `undefined` — the organization's
 * `image_generation` policy is off, or nothing can serve it. One answer for
 * every lane that offers `generate_image`: a chat reply and a task run read
 * the same policy and resolve the same model over the provider credentials,
 * the way the agents of the full workspace resolve it. A failure offers no
 * image tool rather than failing the turn.
 */
export async function offeredImageModel(
  sql: Sql,
  organizationId: string,
): Promise<ResolvedImageModel | undefined> {
  const policy = await readGovernancePolicyForOrg(
    sql,
    organizationId,
    'image_generation',
  );
  if (policy?.enabled !== true) return undefined;
  // The turn's own ctx: the same handlers that resolve a chat's model
  // resolve the image model, whichever module hosts each of them.
  const shim = createCtxShim(chatShimHandlers(sql));
  try {
    const model = await resolveImageGenerationModel(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the resolver reads org slugs, provider credentials and one policy, all served by these handlers
      shim as unknown as ActionCtx,
      organizationId,
    );
    return model ?? undefined;
  } catch (error) {
    console.warn(
      `[agent-tools] image generation not offered to a turn of ${organizationId}:`,
      error,
    );
    return undefined;
  }
}
