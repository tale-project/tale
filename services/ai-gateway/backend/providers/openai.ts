/**
 * OpenAI — a ChatGPT Plus/Pro subscription, reached through the public OAuth
 * client the Codex CLI ships with.
 *
 * Unlike Anthropic's console flow there is no page that prints the code:
 * consent redirects the browser to the CLI's loopback callback
 * (`http://localhost:1455/auth/callback`), which answers only when Codex is
 * the thing listening. The panel therefore asks for the whole address bar and
 * reads `code` and `state` out of the query — a redirect the browser could not
 * load still carries both.
 *
 * Identity rides along in the `id_token`: the account's e-mail, and under the
 * `https://api.openai.com/auth` claim the `chatgpt_account_id` that later
 * calls carry as a header.
 */

import {
  decodeJwtClaims,
  expiresAtFrom,
  generatePkce,
  parseAuthorizationCallback,
  readJsonRecord,
  readObject,
  readString,
  resetsAtFromSeconds,
  toIsoInstant,
  toUtilization,
} from './oauth';
import {
  ProviderError,
  type AuthorizationRequest,
  type FetchLike,
  type Provider,
  type ProviderExchange,
  type ProviderIdentity,
  type UsageWindow,
} from './types';

const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
/** The loopback the Codex client is registered for. */
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const USAGE_URL = 'https://chatgpt.com/backend-api/codex/usage';
const SCOPES = 'openid profile email offline_access';
/** The namespace OpenAI puts its own claims under in the id_token. */
const AUTH_CLAIM = 'https://api.openai.com/auth';

/**
 * The Codex CLI OAuth client. Like Anthropic's it identifies the application
 * rather than an account, and is configurable only so a rotation needs an
 * environment change rather than a release.
 */
const DEFAULT_OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

export interface OpenAiProviderOptions {
  clientId?: string;
  fetchImpl?: FetchLike;
}

export function createOpenAiProvider(
  options: OpenAiProviderOptions = {},
): Provider {
  const clientId = options.clientId ?? DEFAULT_OPENAI_CLIENT_ID;
  const doFetch = options.fetchImpl ?? fetch;

  async function postToken(
    payload: Record<string, string>,
    code: 'authorization_failed' | 'refresh_failed',
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await doFetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(payload).toString(),
      });
    } catch (error) {
      throw new ProviderError(
        'openai',
        code,
        'The OpenAI token endpoint could not be reached.',
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new ProviderError(
        'openai',
        code,
        `The OpenAI token endpoint answered ${response.status}.`,
      );
    }
    return readJsonRecord(response);
  }

  function toExchange(
    data: Record<string, unknown>,
    fallbackRefreshToken?: string,
  ): ProviderExchange {
    const accessToken = readString(data, 'access_token');
    if (!accessToken) {
      throw new ProviderError(
        'openai',
        'authorization_failed',
        'The OpenAI token response carried no access token.',
      );
    }
    const idToken = readString(data, 'id_token');
    return {
      tokens: {
        accessToken,
        refreshToken:
          readString(data, 'refresh_token') ?? fallbackRefreshToken ?? '',
        expiresAt: expiresAtFrom(data['expires_in']),
        scopes: readString(data, 'scope') ?? SCOPES,
      },
      identity: idToken ? identityFromIdToken(idToken) : null,
    };
  }

  return {
    id: 'openai',
    callbackStyle: 'redirect-url',
    cliCommand(accessToken) {
      return `CODEX_ACCESS_TOKEN=${accessToken} codex`;
    },

    beginAuthorization(state): AuthorizationRequest {
      const { verifier, challenge } = generatePkce();
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        // Both flags are what the CLI sends: the first puts the account's
        // organizations into the id_token, the second selects the consent
        // screen written for a command-line client.
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
        state,
      });
      return {
        authorizeUrl: `${AUTHORIZE_URL}?${params.toString()}`,
        codeVerifier: verifier,
        redirectUri: REDIRECT_URI,
      };
    },

    parseCallback: parseAuthorizationCallback,

    async exchangeCode({ code, codeVerifier, redirectUri }) {
      const data = await postToken(
        {
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        },
        'authorization_failed',
      );
      return toExchange(data);
    },

    async refresh(refreshToken) {
      const data = await postToken(
        {
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: refreshToken,
          scope: SCOPES,
        },
        'refresh_failed',
      );
      return toExchange(data, refreshToken);
    },

    async fetchUsage({ accessToken, accountId }): Promise<UsageWindow[]> {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      };
      if (accountId) headers['chatgpt-account-id'] = accountId;

      let response: Response;
      try {
        response = await doFetch(USAGE_URL, { headers });
      } catch (error) {
        throw new ProviderError(
          'openai',
          'usage_failed',
          'The OpenAI usage endpoint could not be reached.',
          { cause: error },
        );
      }
      if (!response.ok) {
        throw new ProviderError(
          'openai',
          'usage_failed',
          `The OpenAI usage endpoint answered ${response.status}.`,
        );
      }
      return parseOpenAiUsage(await readJsonRecord(response));
    },
  };
}

/** Read the account's identity out of the id_token OpenAI just issued. */
export function identityFromIdToken(idToken: string): ProviderIdentity {
  const claims = decodeJwtClaims(idToken);
  const auth = readObject(claims, AUTH_CLAIM);
  return {
    email: readString(claims, 'email'),
    accountId: readString(auth, 'chatgpt_account_id'),
    plan: readString(auth, 'chatgpt_plan_type'),
  };
}

/**
 * Map OpenAI's rate-limit payload onto the shared windows.
 *
 * Codex reports two windows it calls `primary` and `secondary`, each with a
 * `used_percent` and a length in minutes. The short one is the session cap and
 * the long one the weekly cap; the length decides which is which rather than
 * the name, so a plan whose windows are ordered differently still reads
 * correctly. The reset arrives either as an absolute `resets_at` or as a
 * relative `resets_in_seconds`.
 */
export function parseOpenAiUsage(
  data: Record<string, unknown>,
  now: Date = new Date(),
): UsageWindow[] {
  const limits = readObject(data, 'rate_limits') ?? data;
  const entries = (['primary', 'secondary'] as const)
    .map((name) => readObject(limits, name))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  if (entries.length === 0) return [];

  const minutesOf = (entry: Record<string, unknown>): number => {
    const minutes = entry['window_minutes'];
    return typeof minutes === 'number' && Number.isFinite(minutes)
      ? minutes
      : Number.POSITIVE_INFINITY;
  };
  // A single reported window is the session cap unless it is clearly a
  // multi-day one; a day is the boundary the two plans' windows sit either
  // side of (five hours vs seven days).
  const weeklyThresholdMinutes = 24 * 60;
  const sorted = [...entries].sort((a, b) => minutesOf(a) - minutesOf(b));

  return sorted.map((entry, index) => ({
    kind:
      index === 0 && minutesOf(entry) < weeklyThresholdMinutes
        ? ('session' as const)
        : ('weekly' as const),
    label: null,
    utilization: toUtilization(entry['used_percent']),
    resetsAt:
      toIsoInstant(entry['resets_at']) ??
      resetsAtFromSeconds(
        entry['resets_in_seconds'] ?? entry['reset_after_seconds'],
        now,
      ),
  }));
}
