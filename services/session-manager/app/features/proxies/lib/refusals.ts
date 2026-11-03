import type { ApiError } from '@/app/lib/api/client';
import {
  idSchema,
  messageParamsSchema,
  sessionRefSchema,
  type MessageParams,
  type SessionRef,
} from '@/lib/api/schemas';

// The extra fields of a refusal are not part of the typed contract: they are
// read leniently, and a missing or malformed one only means less to say.

/** The session a 409 about a proxy names (`proxy_in_use`, `proxy_busy`). */
export function sessionOfRefusal(error: ApiError): SessionRef | null {
  const parsed = sessionRefSchema.safeParse(error.extra.session);
  return parsed.success ? parsed.data : null;
}

/** The proxy a `duplicate` refusal says already exists. */
export function existingIdOfRefusal(error: ApiError): number | null {
  const parsed = idSchema.safeParse(error.extra.existingId);
  return parsed.success ? parsed.data : null;
}

export interface ParseCause {
  /** The reason a line could not be read, e.g. `missing_port`. */
  code: string;
  params: MessageParams;
}

/** Why an `invalid_proxy` refusal found the text unreadable, when it says. */
export function parseCauseOfRefusal(error: ApiError): ParseCause | null {
  const { reason, params } = error.extra;
  if (typeof reason !== 'string' || reason === '') return null;
  const parsed = messageParamsSchema.safeParse(params);
  return { code: reason, params: parsed.success ? parsed.data : {} };
}
