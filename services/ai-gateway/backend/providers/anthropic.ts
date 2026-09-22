/**
 * Anthropic — a Claude Pro/Max subscription, reached through the public OAuth
 * client Claude Code itself uses.
 *
 * The flow is the CLI's "manual" variant: the browser goes to claude.ai, and
 * after consent Anthropic's console callback page DISPLAYS the result instead
 * of redirecting anywhere this gateway could listen. The person copies that
 * `code#state` pair back into the panel.
 *
 * The usage endpoint is the one behind Claude Code's `/usage` command. It
 * insists on the `claude-code/<version>` User-Agent — without it the request
 * lands in an aggressively throttled bucket — and reports the two general
 * windows as top-level keys while per-model caps arrive in a `limits` array.
 */

import {
  expiresAtFrom,
  generatePkce,
  isRecord,
  parseAuthorizationCallback,
  readJsonRecord,
  readObject,
  readString,
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

const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
/** The console page that renders the code for copying. */
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';
const SCOPES = 'org:create_api_key user:profile user:inference';

/**
 * How long each of Anthropic's windows runs.
 *
 * The vendor never states a length; it states a name — `five_hour`,
 * `seven_day`, and `group: "session" | "weekly"` on a per-model limit — and
 * the name IS the length. Reading it here is what lets the panel show how far
 * through a window the clock is rather than only when it ends.
 */
const FIVE_HOUR_SECONDS = 5 * 60 * 60;
const SEVEN_DAY_SECONDS = 7 * 24 * 60 * 60;

/**
 * The Claude Code OAuth client. It identifies the *application*, is the same
 * for every account, and is published by the CLI itself; it is configurable
 * only so a rotation needs an environment change rather than a release.
 */
const DEFAULT_ANTHROPIC_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

export interface AnthropicProviderOptions {
  clientId?: string;
  /** Reported as `claude-code/<version>` to the usage endpoint. */
  claudeCodeVersion?: string;
  fetchImpl?: FetchLike;
}

export function createAnthropicProvider(
  options: AnthropicProviderOptions = {},
): Provider {
  const clientId = options.clientId ?? DEFAULT_ANTHROPIC_CLIENT_ID;
  const claudeCodeVersion = options.claudeCodeVersion ?? '1.0.0';
  const doFetch = options.fetchImpl ?? fetch;

  function headers(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': `claude-code/${claudeCodeVersion}`,
      'Content-Type': 'application/json',
    };
  }

  async function postToken(
    payload: Record<string, string>,
    code: 'authorization_failed' | 'refresh_failed',
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await doFetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new ProviderError(
        'anthropic',
        code,
        'The Anthropic token endpoint could not be reached.',
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new ProviderError(
        'anthropic',
        code,
        `The Anthropic token endpoint answered ${response.status}.`,
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
        'anthropic',
        'authorization_failed',
        'The Anthropic token response carried no access token.',
      );
    }
    const account = readObject(data, 'account');
    const organization = readObject(data, 'organization');
    return {
      tokens: {
        accessToken,
        refreshToken:
          readString(data, 'refresh_token') ?? fallbackRefreshToken ?? '',
        expiresAt: expiresAtFrom(data['expires_in']),
        scopes: readString(data, 'scope') ?? SCOPES,
      },
      identity: {
        email:
          readString(account, 'email_address') ?? readString(account, 'email'),
        accountId: null,
        plan: readString(organization, 'name'),
      },
    };
  }

  return {
    id: 'anthropic',
    callbackStyle: 'code',
    cliCommand(accessToken) {
      return `ANTHROPIC_AUTH_TOKEN=${accessToken} claude`;
    },

    beginAuthorization(state): AuthorizationRequest {
      const { verifier, challenge } = generatePkce();
      const params = new URLSearchParams({
        // Asks for the copy-the-code flow rather than a redirect.
        code: 'true',
        client_id: clientId,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      });
      return {
        authorizeUrl: `${AUTHORIZE_URL}?${params.toString()}`,
        codeVerifier: verifier,
        redirectUri: REDIRECT_URI,
      };
    },

    parseCallback: parseAuthorizationCallback,

    async exchangeCode({ code, codeVerifier, redirectUri, state }) {
      const data = await postToken(
        {
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
          state,
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
        },
        'refresh_failed',
      );
      // A refresh response may omit the refresh token; the old one stays valid.
      return toExchange(data, refreshToken);
    },

    async fetchIdentity({ accessToken }): Promise<ProviderIdentity> {
      let response: Response;
      try {
        response = await doFetch(PROFILE_URL, {
          headers: headers(accessToken),
        });
      } catch (error) {
        throw new ProviderError(
          'anthropic',
          'identity_failed',
          'The Anthropic profile endpoint could not be reached.',
          { cause: error },
        );
      }
      if (!response.ok) {
        throw new ProviderError(
          'anthropic',
          'identity_failed',
          `The Anthropic profile endpoint answered ${response.status}.`,
        );
      }
      const data = await readJsonRecord(response);
      const account = readObject(data, 'account');
      const organization = readObject(data, 'organization');
      return {
        email:
          readString(account, 'email') ?? readString(account, 'email_address'),
        accountId: null,
        plan: readString(organization, 'name'),
      };
    },

    async fetchUsage({ accessToken }): Promise<UsageWindow[]> {
      let response: Response;
      try {
        response = await doFetch(USAGE_URL, { headers: headers(accessToken) });
      } catch (error) {
        throw new ProviderError(
          'anthropic',
          'usage_failed',
          'The Anthropic usage endpoint could not be reached.',
          { cause: error },
        );
      }
      if (!response.ok) {
        throw new ProviderError(
          'anthropic',
          'usage_failed',
          `The Anthropic usage endpoint answered ${response.status}.`,
        );
      }
      return parseAnthropicUsage(await readJsonRecord(response));
    },
  };
}

/**
 * Map Anthropic's usage payload onto the shared windows.
 *
 * `five_hour` and `seven_day` are the general caps every model shares.
 * Per-model caps are not top-level keys: they arrive in `limits` as entries
 * tagged with `scope.model.display_name`, and they report `percent` where the
 * general windows report `utilization`.
 */
export function parseAnthropicUsage(
  data: Record<string, unknown>,
): UsageWindow[] {
  const windows: UsageWindow[] = [];

  const fiveHour = readObject(data, 'five_hour');
  if (fiveHour) {
    windows.push({
      kind: 'session',
      label: null,
      utilization: toUtilization(fiveHour['utilization']),
      resetsAt: toIsoInstant(fiveHour['resets_at']),
      windowSeconds: FIVE_HOUR_SECONDS,
    });
  }

  const sevenDay = readObject(data, 'seven_day');
  if (sevenDay) {
    windows.push({
      kind: 'weekly',
      label: null,
      utilization: toUtilization(sevenDay['utilization']),
      resetsAt: toIsoInstant(sevenDay['resets_at']),
      windowSeconds: SEVEN_DAY_SECONDS,
    });
  }

  const limits: unknown = data['limits'];
  if (Array.isArray(limits)) {
    for (const entry of limits) {
      if (!isRecord(entry)) continue;
      const limit = entry;
      const model = readObject(readObject(limit, 'scope'), 'model');
      const name = readString(model, 'display_name');
      if (!name) continue;
      windows.push({
        kind: 'scoped',
        label: name,
        utilization: toUtilization(
          limit['percent'] ?? limit['utilization'] ?? null,
        ),
        resetsAt: toIsoInstant(limit['resets_at']),
        windowSeconds: scopedWindowSeconds(limit),
      });
    }
  }

  return windows;
}

/**
 * How long a per-model limit's window runs.
 *
 * The entry says which family it belongs to rather than how long it is:
 * `group` is `session` or `weekly`, and `kind` repeats it with the scope
 * attached (`weekly_scoped`). Either is enough; a family neither names is left
 * unmeasured rather than guessed at.
 */
function scopedWindowSeconds(limit: Record<string, unknown>): number | null {
  const family = readString(limit, 'group') ?? readString(limit, 'kind') ?? '';
  if (family.startsWith('session')) return FIVE_HOUR_SECONDS;
  if (family.startsWith('weekly')) return SEVEN_DAY_SECONDS;
  return null;
}
