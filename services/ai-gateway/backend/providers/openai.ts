/**
 * OpenAI — a ChatGPT Plus/Pro subscription, reached through the public OAuth
 * client the Codex CLI ships with.
 *
 * An account connects through the client's device sign-in by default: the
 * person enters a one-time code on OpenAI's own page and this gateway polls
 * for the grant, so nothing has to come back through the browser. The
 * browser flow remains for a workspace that does not allow device sign-in;
 * its consent redirects to the CLI's loopback callback
 * (`http://localhost:1455/auth/callback`), which answers only when Codex is
 * the thing listening, so the panel asks for the whole address bar and reads
 * `code` and `state` out of the query — a redirect the browser could not load
 * still carries both.
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
  type UsageReading,
  type UsageWindow,
} from './types';

const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
/** The loopback the Codex client is registered for. */
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const USAGE_URL = 'https://chatgpt.com/backend-api/codex/usage';
/**
 * The device-code sign-in `codex login --device-auth` runs: the code is asked
 * for and polled at the accounts API, entered by the person on the Codex
 * device page, and exchanged against the device callback as its redirect.
 */
const DEVICE_API_BASE = 'https://auth.openai.com/api/accounts';
const DEVICE_VERIFICATION_URL = 'https://auth.openai.com/codex/device';
const DEVICE_REDIRECT_URI = 'https://auth.openai.com/deviceauth/callback';
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
        tokenFailureCode(code, response.status),
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

  /** A device-authorization call; OpenAI's endpoints take a JSON body. */
  function postDevice(path: string, body: Record<string, string>) {
    return doFetch(`${DEVICE_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /**
   * Ask for a one-time code — the first half of `codex login --device-auth`.
   * The person enters it on OpenAI's own page; nothing comes back through
   * the browser, which is what lets a gateway that no browser can redirect to
   * connect an account at all.
   */
  async function beginDeviceAuthorization(): Promise<AuthorizationRequest> {
    let response: Response;
    try {
      response = await postDevice('/deviceauth/usercode', {
        client_id: clientId,
      });
    } catch (error) {
      throw new ProviderError(
        'openai',
        'authorization_failed',
        'The OpenAI device sign-in could not be reached.',
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new ProviderError(
        'openai',
        'authorization_failed',
        `The OpenAI device sign-in answered ${response.status}.`,
      );
    }
    const data = await readJsonRecord(response);
    const deviceAuthId = readString(data, 'device_auth_id');
    const userCode = readString(data, 'user_code');
    if (!deviceAuthId || !userCode) {
      throw new ProviderError(
        'openai',
        'authorization_failed',
        'The OpenAI device sign-in answered without a code.',
      );
    }
    // The interval arrives as a string ("5"); Codex falls back to five too.
    const interval = Number(data['interval']);
    return {
      flow: 'device',
      verificationUrl: DEVICE_VERIFICATION_URL,
      userCode,
      deviceAuthId,
      intervalSeconds: Number.isFinite(interval) && interval > 0 ? interval : 5,
      expiresAt: toIsoInstant(data['expires_at']),
    };
  }

  return {
    id: 'openai',
    cliCommand(accessToken) {
      return `CODEX_ACCESS_TOKEN=${accessToken} codex`;
    },

    /**
     * The device flow unless the browser one is asked for. The browser flow
     * redirects to Codex's own loopback (`localhost:1455`), which answers only
     * when Codex is the thing listening — so it always ends with the person
     * copying the address bar back — while the device flow finishes on its
     * own wherever the gateway runs. The browser flow stays for an account
     * whose workspace does not allow device sign-in.
     */
    async beginAuthorization(state, { preferBrowser }) {
      if (!preferBrowser) return beginDeviceAuthorization();

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
        flow: 'paste',
        authorizeUrl: `${AUTHORIZE_URL}?${params.toString()}`,
        codeVerifier: verifier,
        redirectUri: REDIRECT_URI,
        pasteStyle: 'redirect-url',
      };
    },

    /**
     * The second half of the device flow: has the person approved the code?
     *
     * OpenAI answers 403 (`deviceauth_authorization_pending`) — or 404 — until
     * they do, then 200 with an authorization code and the PKCE pair OpenAI
     * made for it, which exchange like any other code against the device
     * callback as the redirect. Any other answer is a refusal. A poll that
     * cannot reach OpenAI is still pending: the next one may.
     */
    async pollDeviceAuthorization({ deviceAuthId, userCode }) {
      let response: Response;
      try {
        response = await postDevice('/deviceauth/token', {
          device_auth_id: deviceAuthId,
          user_code: userCode,
        });
      } catch (error) {
        console.warn(
          '[ai-gateway] the OpenAI device poll could not be sent:',
          error instanceof Error ? error.message : error,
        );
        return { status: 'pending' };
      }
      if (response.status === 403 || response.status === 404) {
        return { status: 'pending' };
      }
      if (!response.ok) return { status: 'refused' };
      const data = await readJsonRecord(response);
      const code = readString(data, 'authorization_code');
      const codeVerifier = readString(data, 'code_verifier');
      if (!code || !codeVerifier) return { status: 'refused' };
      return {
        status: 'approved',
        code,
        codeVerifier,
        redirectUri: DEVICE_REDIRECT_URI,
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

    async fetchUsage({ accessToken, accountId }): Promise<UsageReading> {
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
      const data = await readJsonRecord(response);
      return {
        windows: parseOpenAiUsage(data),
        subscription: subscriptionFromPlanType(readString(data, 'plan_type')),
      };
    },
  };
}

/**
 * ChatGPT's plan id — `plus`, `pro`, `prolite`, `business` … — as a
 * subscription. ChatGPT sells no multiples within a plan, so there is no tier.
 */
function subscriptionFromPlanType(planType: string | null) {
  return planType ? { plan: planType, tier: null } : null;
}

/** Read the account's identity out of the id_token OpenAI just issued. */
export function identityFromIdToken(idToken: string): ProviderIdentity {
  const claims = decodeJwtClaims(idToken);
  const auth = readObject(claims, AUTH_CLAIM);
  return {
    email: readString(claims, 'email'),
    accountId: readString(auth, 'chatgpt_account_id'),
    subscription: subscriptionFromPlanType(
      readString(auth, 'chatgpt_plan_type'),
    ),
  };
}

/**
 * Map the Codex usage payload onto the shared windows.
 *
 * `rate_limit` carries a `primary_window` and a `secondary_window`, each with
 * a `used_percent`, the window's own length in `limit_window_seconds`, and the
 * rollover as both an absolute `reset_at` (epoch seconds) and a relative
 * `reset_after_seconds`. A plan that publishes one window answers `null` for
 * the other.
 *
 * The length decides which cap a window is rather than its name: the shorter
 * is the session cap and anything a day or longer is the weekly one. So a plan
 * whose two windows arrive in the other order reads correctly, and so does one
 * that publishes the weekly window alone.
 */
export function parseOpenAiUsage(
  data: Record<string, unknown>,
  now: Date = new Date(),
): UsageWindow[] {
  const limits = readObject(data, 'rate_limit');
  const entries = (['primary_window', 'secondary_window'] as const)
    .map((name) => readObject(limits, name))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  if (entries.length === 0) return [];

  const lengthOf = (entry: Record<string, unknown>): number | null => {
    const seconds = entry['limit_window_seconds'];
    return typeof seconds === 'number' && Number.isFinite(seconds)
      ? seconds
      : null;
  };
  // An unmeasured window sorts last and reads as the plan cap: the session one
  // is the short window, and a vendor that stopped saying how long it is has
  // taken away the only thing that could prove otherwise.
  const secondsOf = (entry: Record<string, unknown>): number =>
    lengthOf(entry) ?? Number.POSITIVE_INFINITY;
  // A day is the boundary the two windows sit either side of — five hours
  // against seven days — so it is what separates a session cap from a plan one.
  const weeklyThresholdSeconds = 24 * 60 * 60;
  const sorted = [...entries].sort((a, b) => secondsOf(a) - secondsOf(b));

  return sorted.map((entry, index) => ({
    kind:
      index === 0 && secondsOf(entry) < weeklyThresholdSeconds
        ? ('session' as const)
        : ('weekly' as const),
    label: null,
    utilization: toUtilization(entry['used_percent']),
    resetsAt:
      toIsoInstant(entry['reset_at']) ??
      resetsAtFromSeconds(entry['reset_after_seconds'], now),
    windowSeconds: lengthOf(entry),
  }));
}
