/**
 * The editor's draft check over the 0.5 backend
 * (`POST /api/app/automations/:name/validate`). Its own module rather than a
 * row in `./automations`: the adapter rows load with every page, and only
 * the automation editor checks a draft.
 */

import type { ZodType } from 'zod';

import {
  analysisSchema,
  typesSchema,
  validationAnswerSchema,
  type AnalysisView,
  type TypesView,
  type ValidationAnswer,
} from '@/lib/shared/schemas/automation-issues';

import { backendFetch } from './api-client';
import { namePath } from './automations';

/** What a draft check answers beside the issues (`detail` of the route). */
export type ValidationDetail = 'analysis' | 'types';

/** A check's answer: the issues, and what it was asked for beside them
 * when it answered that in a shape this build reads. */
export type DraftCheck = ValidationAnswer & {
  analysis?: AnalysisView;
  types?: TypesView;
};

/** One detail of an answer, read on its own: a malformed one is left out
 * with a warning, and the issues still stand. */
function detailOf<T>(
  body: unknown,
  key: ValidationDetail,
  schema: ZodType<T>,
): T | undefined {
  if (typeof body !== 'object' || body === null || !(key in body)) {
    return undefined;
  }
  const value: unknown = Reflect.get(body, key);
  if (value === undefined || value === null) return undefined;
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  console.warn(
    `[automations] the draft check answered its ${key} in a shape this app does not read`,
    parsed.error.issues,
  );
  return undefined;
}

/**
 * Check a draft without saving it: the problems the engine finds, split into
 * errors and warnings. Reads only — nothing is written or audited — and is
 * author-gated like a save. The answer is parsed at this boundary; one in a
 * shape this build does not read is a failed check, never a cast. `detail`
 * names what to answer beside the issues (nothing more by default); each
 * part is read on its own, so a malformed part is dropped, never the
 * issues.
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
): Promise<DraftCheck> {
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
  const analysis = detailOf(body, 'analysis', analysisSchema);
  const types = detailOf(body, 'types', typesSchema);
  return {
    ...parsed.data,
    ...(analysis !== undefined && { analysis }),
    ...(types !== undefined && { types }),
  };
}
