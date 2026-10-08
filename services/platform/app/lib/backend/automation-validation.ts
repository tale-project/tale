/**
 * The editor's draft check over the 0.5 backend
 * (`POST /api/app/automations/:name/validate`). Its own module rather than a
 * row in `./automations`: the adapter rows load with every page, and only
 * the automation editor checks a draft.
 */

import {
  validationAnswerSchema,
  type ValidationAnswer,
} from '@/lib/shared/schemas/automation-issues';

import { backendFetch } from './api-client';
import { namePath } from './automations';

/** What a draft check answers beside the issues (`detail` of the route). */
export type ValidationDetail = 'analysis' | 'types';

/**
 * Check a draft without saving it: the problems the engine finds, split into
 * errors and warnings. Reads only — nothing is written or audited — and is
 * author-gated like a save. The answer is parsed at this boundary; one in a
 * shape this build does not read is a failed check, never a cast. `detail`
 * names what to answer beside the issues; the editor reads none of it yet,
 * so the default asks for nothing more.
 *
 * Throws the transport's errors as they are; callers that show a refusal's
 * words normalize them through `runAdapted` like every adapted read.
 */
export async function validateAutomationDraft(
  organizationId: string,
  name: string,
  document: unknown,
  options: {
    signal?: AbortSignal;
    detail?: readonly ValidationDetail[];
  } = {},
): Promise<ValidationAnswer> {
  const body = await backendFetch<unknown>(
    `/automations/${namePath(name)}/validate`,
    {
      orgId: organizationId,
      body: { document, detail: [...(options.detail ?? [])] },
      ...(options.signal !== undefined && { signal: options.signal }),
    },
  );
  const parsed = validationAnswerSchema.safeParse(body);
  if (!parsed.success) {
    console.warn(
      '[automations] the draft check answered in a shape this app does not read',
      parsed.error.issues,
    );
    throw new Error('The draft check answered in an unreadable shape.');
  }
  return parsed.data;
}
