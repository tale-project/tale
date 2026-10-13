import { z } from 'zod';

import {
  type AccessChoice,
  EXTRA_SCOPES,
  type ExtraScope,
} from './agent-consent-model';
import type { AgentConsentRequest } from './agent-consent-request';

/**
 * What the person had chosen, kept across the one thing that reloads the
 * page under them: confirming their password, or signing in again, replaces
 * their session, and the provider signs the request anew for it. Without
 * this they would find the page back at its defaults — deploying unchecked,
 * the other organization unselected — and connect with less than they meant
 * to, or have to choose again.
 *
 * It lives for the tab only, names the request by the app's PKCE challenge
 * (which the provider keeps when it signs the query anew), and is gone after
 * ten minutes, a read, or the tab.
 */

const PREFIX = 'tale:agent-consent:';
const KEPT_FOR_MS = 10 * 60 * 1000;

export interface RememberedChoice {
  organizationId: string;
  choice: AccessChoice;
}

function keyOf(
  request: Pick<AgentConsentRequest, 'codeChallenge'>,
): string | null {
  return request.codeChallenge === null || request.codeChallenge === ''
    ? null
    : `${PREFIX}${request.codeChallenge}`;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch (error) {
    // A browser that refuses storage: the choice is simply not kept.
    console.warn('[agent-consent] session storage is not available', error);
    return null;
  }
}

/** Keep the choice, for the page the provider is about to send the person
 * back to. */
export function rememberChoice(
  request: Pick<AgentConsentRequest, 'codeChallenge'>,
  remembered: RememberedChoice,
  now: number = Date.now(),
): void {
  const key = keyOf(request);
  const store = storage();
  if (key === null || store === null) return;
  try {
    store.setItem(
      key,
      JSON.stringify({
        organizationId: remembered.organizationId,
        level: remembered.choice.level,
        extras: [...remembered.choice.extras],
        at: now,
      }),
    );
  } catch (error) {
    console.warn('[agent-consent] the choice could not be kept', error);
  }
}

const keptSchema = z.object({
  organizationId: z.string(),
  level: z.enum(['read', 'edit', 'deploy']),
  extras: z.array(z.string()),
  at: z.number(),
});

/** What was kept for this request, if it is still fresh and well formed. */
export function rememberedChoice(
  request: Pick<AgentConsentRequest, 'codeChallenge'>,
  now: number = Date.now(),
): RememberedChoice | null {
  const key = keyOf(request);
  const store = storage();
  if (key === null || store === null) return null;
  let kept: z.infer<typeof keptSchema>;
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const parsed = keptSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    kept = parsed.data;
  } catch (error) {
    console.warn('[agent-consent] the kept choice could not be read', error);
    return null;
  }
  if (now - kept.at > KEPT_FOR_MS) return null;
  return {
    organizationId: kept.organizationId,
    choice: {
      level: kept.level,
      extras: new Set<ExtraScope>(
        EXTRA_SCOPES.filter((extra) => kept.extras.includes(extra)),
      ),
    },
  };
}

export function forgetChoice(
  request: Pick<AgentConsentRequest, 'codeChallenge'>,
): void {
  const key = keyOf(request);
  const store = storage();
  if (key === null || store === null) return;
  try {
    store.removeItem(key);
  } catch (error) {
    console.warn('[agent-consent] the kept choice could not be dropped', error);
  }
}
