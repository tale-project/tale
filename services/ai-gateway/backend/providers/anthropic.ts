/**
 * Anthropic — a Claude Pro/Max subscription, reached through the public OAuth
 * client Claude Code itself uses.
 *
 * The client redirects only to a loopback address or to Anthropic's console
 * page that DISPLAYS the result. So a gateway the browser reaches on a
 * loopback address takes consent straight back on its own `/callback`, and
 * one reached anywhere else asks the person to copy that `code#state` pair
 * back into the panel — the CLI's "manual" variant.
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
  tokenFailureCode,
  toUtilization,
} from './oauth';
import {
  ProviderError,
  type AuthorizationRequest,
  type FetchLike,
  type Provider,
  type ProviderExchange,
  type ProviderIdentity,
  type Subscription,
  type UsageReading,
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
        tokenFailureCode(code, response.status),
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
        // The token answer names the organization — "you@example.com's
        // Organization" — not what it subscribes to. Only the profile says
        // that, so the plan waits for `fetchIdentity`.
        subscription: null,
      },
    };
  }

  return {
    id: 'anthropic',
    cliCommand(accessToken) {
      return `ANTHROPIC_AUTH_TOKEN=${accessToken} claude`;
    },

    /**
     * Claude Code's client redirects to two kinds of address: a loopback
     * `http://localhost:<any port>/callback` — the client's metadata lists
     * `http://localhost/callback`, and RFC 8252 lets the port vary — or the
     * console page that prints the code. So when the browser reaches this
     * gateway on a loopback address, consent comes straight back to its own
     * `/callback` and finishes there; anywhere else the page prints the code
     * and the person pastes it. Anthropic offers no device flow for a
     * subscription, so there is no third way.
     */
    beginAuthorization(
      state,
      { loopbackRedirectUri },
    ): Promise<AuthorizationRequest> {
      const { verifier, challenge } = generatePkce();
      const redirectUri = loopbackRedirectUri ?? REDIRECT_URI;
      const params = new URLSearchParams({
        // Claude Code sends this whichever way the code comes back.
        code: 'true',
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: SCOPES,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      });
      return Promise.resolve({
        flow: loopbackRedirectUri ? 'redirect' : 'paste',
        authorizeUrl: `${AUTHORIZE_URL}?${params.toString()}`,
        codeVerifier: verifier,
        redirectUri,
        pasteStyle: 'code',
      });
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
      return {
        email:
          readString(account, 'email') ?? readString(account, 'email_address'),
        accountId: null,
        subscription: subscriptionFromOrganization(
          readObject(data, 'organization'),
        ),
      };
    },

    async fetchUsage({ accessToken }): Promise<UsageReading> {
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
      const data = await readJsonRecord(response);
      if (!carriesReading(data)) {
        throw new ProviderError(
          'anthropic',
          'usage_failed',
          'The Anthropic usage endpoint answered without a reading.',
        );
      }
      return {
        windows: parseAnthropicUsage(data),
        // The usage answer carries no plan; the profile is where it lives.
        subscription: null,
      };
    },
  };
}

/**
 * The plan behind an account, read off the profile's `organization`.
 *
 * `organization_type` is the plan — `claude_max`, `claude_pro`, `claude_team`,
 * `claude_enterprise`, the same four Claude Code maps onto its subscription
 * types — and the product prefix is dropped because the vendor column already
 * says whose plan it is. `rate_limit_tier` carries the multiple a Max plan is
 * sold at as its suffix (`default_claude_max_20x`); a tier naming none, such
 * as a Pro plan's, is no multiple at all.
 */
export function subscriptionFromOrganization(
  organization: Record<string, unknown> | null,
): Subscription | null {
  const type = readString(organization, 'organization_type');
  if (!type) return null;
  const multiple = /_(\d+x)$/.exec(
    readString(organization, 'rate_limit_tier') ?? '',
  );
  return { plan: type.replace(/^claude_/, ''), tier: multiple?.[1] ?? null };
}

/**
 * The keys a usage reading is made of — the list Claude Code checks an answer
 * against before it believes one.
 */
const READING_KEYS = [
  'five_hour',
  'seven_day',
  'seven_day_oauth_apps',
  'seven_day_opus',
  'seven_day_sonnet',
  'cinder_cove',
  'extra_usage',
  'limits',
] as const;

/**
 * Whether a 200 carries a reading at all.
 *
 * A rate-limited read is not always a 429: the endpoint can answer 200 with
 * `{"error": {"type": "rate_limit_error"}}` and no window in it. Mapped as it
 * stood, that answer replaced a good reading with an empty one; it is a
 * failed read, and the last reading stands.
 */
function carriesReading(data: Record<string, unknown>): boolean {
  return READING_KEYS.some((key) => key in data);
}

/**
 * Map Anthropic's usage payload onto the shared windows — the same rows
 * Claude Code's `/usage` draws from it.
 *
 * `five_hour` and `seven_day` are the general caps every model shares.
 * Per-model caps are not top-level keys: they arrive in `limits` as entries
 * tagged with `scope.model.display_name`, and they report `percent` where the
 * general windows report `utilization`. Only a `weekly_scoped` entry is one:
 * Claude Code classifies a row on its `kind`, never on its label, and an entry
 * of another kind that happened to name a model would land beside the weekly
 * one under the same name ("Fable" twice, with two figures).
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
      if (readString(entry, 'kind') !== 'weekly_scoped') continue;
      const model = readObject(readObject(entry, 'scope'), 'model');
      const name = readString(model, 'display_name');
      if (!name) continue;
      windows.push({
        kind: 'scoped',
        label: name,
        utilization: toUtilization(
          entry['percent'] ?? entry['utilization'] ?? null,
        ),
        resetsAt: toIsoInstant(entry['resets_at']),
        // `weekly_scoped` names its length: the week the plan cap runs over.
        windowSeconds: SEVEN_DAY_SECONDS,
      });
    }
  }

  return windows;
}
