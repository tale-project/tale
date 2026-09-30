// @vitest-environment node

/**
 * The gateway's setup token, from both ends: the token the gateway image's
 * entrypoint hands the gateway (`services/sandbox-llm-gateway/docker-
 * entrypoint.sh`, run under /bin/sh with only its final `exec` swapped for a
 * stub that prints what the gateway would get), and the platform's own
 * bootstrap (`applyGatewayConfig`) against a gateway started with that
 * token. The gateway is a management plane scripted after maximhq/bifrost
 * transports/v2.2.4, the pinned image: it reads the token trimmed, and an
 * empty one as none; it creates its first admin account only for a request
 * whose `auth_config.setup_token` matches, else 403; once an admin exists it
 * ignores the token and wants Basic auth on /api/*.
 *
 * The one policy: the token is the admin password, always. An explicit
 * BIFROST_SETUP_TOKEN on the container is replaced (the platform never sends
 * one), so a fresh gateway is claimable by the platform whatever the
 * container was given, and by nobody when it was given no password.
 */

import { spawnSync } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const ENTRYPOINT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../sandbox-llm-gateway/docker-entrypoint.sh',
);
const UPSTREAM_EXEC = 'exec /app/docker-entrypoint.sh "$@"';

const scratch = mkdtempSync(path.join(tmpdir(), 'tale-gateway-entrypoint-'));
const next = path.join(scratch, 'next');
writeFileSync(
  next,
  '#!/bin/sh\nprintf "%s" "${BIFROST_SETUP_TOKEN-<unset>}"\n',
  { mode: 0o755 },
);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Synthetic secrets that meet the pinned gateway's password policy.
const PASSWORD = 'Synthetic-Admin-Pw-2026!';
const OTHER_TOKEN = 'Explicit-Setup-Token-7#';

/** What the image's entrypoint hands the gateway for this container
 * environment. */
function containerStart(env: Record<string, string>): {
  token: string;
  notice: string;
  status: number | null;
} {
  const script = readFileSync(ENTRYPOINT, 'utf8');
  expect(script.split(UPSTREAM_EXEC)).toHaveLength(2);
  const run = spawnSync(
    '/bin/sh',
    ['-c', script.replace(UPSTREAM_EXEC, `exec "${next}" "$@"`)],
    { env: { PATH: '/usr/bin:/bin', ...env }, encoding: 'utf8' },
  );
  return { token: run.stdout, notice: run.stderr, status: run.status };
}

interface Admin {
  username: string;
  password: string;
}

/** A gateway started with `setupToken` (BIFROST_SETUP_TOKEN), holding
 * `admin` when its store already has one. */
function gatewayStartedWith(setupToken: string, admin: Admin | null) {
  // lib/config.go resolveSetupToken: trimmed, "" = none configured.
  const configured = setupToken.trim();
  let bootstrapToken = admin === null && configured !== '' ? configured : null;
  let stored = admin;
  const answer = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the client passes a plain header record
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const route = new URL(String(url)).pathname;
      if (
        stored !== null &&
        headers.authorization !==
          `Basic ${Buffer.from(`${stored.username}:${stored.password}`).toString('base64')}`
      ) {
        return answer(401, { error: { message: 'Unauthorized' } });
      }
      if (route === '/api/config' && method === 'GET') {
        return answer(200, {
          client_config: {},
          // Left out until an admin exists (handlers/config.go getConfig).
          ...(stored === null
            ? {}
            : {
                auth_config: {
                  admin_username: { value: stored.username },
                  admin_password: { value: '<redacted>' },
                  is_enabled: true,
                },
              }),
        });
      }
      if (route === '/api/config' && method === 'PUT') {
        const body = JSON.parse(
          typeof init?.body === 'string' ? init.body : '{}',
        ) as {
          auth_config?: {
            is_enabled?: boolean;
            admin_username?: string;
            admin_password?: string;
            setup_token?: string;
          };
        };
        const auth = body.auth_config;
        if (auth?.is_enabled === true) {
          // handlers/config.go: the first admin only for the token,
          // compared in constant time (AuthMiddleware.CheckBootstrapToken).
          if (stored === null) {
            const offered = Buffer.from(auth.setup_token ?? '');
            const expected = Buffer.from(bootstrapToken ?? '');
            if (
              bootstrapToken === null ||
              offered.length !== expected.length ||
              !timingSafeEqual(offered, expected)
            ) {
              return answer(403, {
                error: {
                  message:
                    'a valid setup token is required to create the initial admin account',
                },
              });
            }
          }
          if ((auth.admin_password ?? '') !== '') {
            stored = {
              username: auth.admin_username ?? '',
              password: auth.admin_password ?? '',
            };
          }
          bootstrapToken = null;
        }
        return answer(200, { status: 'success' });
      }
      return answer(404, { error: { message: 'not found' } });
    }),
  );
  return { admin: () => stored };
}

/** The platform's bootstrap of that gateway, with its admin password. */
async function platformClaims(): Promise<void> {
  vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', PASSWORD);
  vi.resetModules();
  const { applyGatewayConfig } = await import('./llm_gateway_admin');
  await applyGatewayConfig();
}

describe('the setup token the gateway image hands the gateway', () => {
  it('is the admin password', () => {
    expect(
      containerStart({ SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD: PASSWORD }),
    ).toEqual({ token: PASSWORD, notice: '', status: 0 });
  });

  it('is the admin password even when the container carries another token, which it names as ignored without its value', () => {
    const started = containerStart({
      SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD: PASSWORD,
      BIFROST_SETUP_TOKEN: OTHER_TOKEN,
    });
    expect(started.status).toBe(0);
    expect(started.token).toBe(PASSWORD);
    expect(started.notice).toContain('ignoring BIFROST_SETUP_TOKEN');
    expect(started.notice).not.toContain(OTHER_TOKEN);
    expect(started.notice).not.toContain(PASSWORD);
  });

  it('keeps quiet about an explicit token equal to the password', () => {
    expect(
      containerStart({
        SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD: PASSWORD,
        BIFROST_SETUP_TOKEN: PASSWORD,
      }),
    ).toEqual({ token: PASSWORD, notice: '', status: 0 });
  });

  it('reads the password the way the platform does: the pre-rename name only when the current one is not set at all', () => {
    expect(containerStart({ LLM_GATEWAY_ADMIN_PASSWORD: PASSWORD }).token).toBe(
      PASSWORD,
    );
    // A blank current name is the platform's "not set" (it refuses to manage
    // the gateway); the gateway then admits no admin at all.
    expect(
      containerStart({
        SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD: '',
        LLM_GATEWAY_ADMIN_PASSWORD: PASSWORD,
      }).token,
    ).toBe('');
  });

  it('is empty without a password, however the container set BIFROST_SETUP_TOKEN', () => {
    expect(containerStart({}).token).toBe('');
    expect(containerStart({ BIFROST_SETUP_TOKEN: OTHER_TOKEN }).token).toBe('');
  });
});

describe('the platform claims a fresh gateway with that token', () => {
  it.each([
    ['the password alone', { SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD: PASSWORD }],
    [
      'a different explicit BIFROST_SETUP_TOKEN',
      {
        SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD: PASSWORD,
        BIFROST_SETUP_TOKEN: OTHER_TOKEN,
      },
    ],
    [
      'an explicit BIFROST_SETUP_TOKEN equal to the password',
      {
        SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD: PASSWORD,
        BIFROST_SETUP_TOKEN: PASSWORD,
      },
    ],
    ['the pre-rename password name', { LLM_GATEWAY_ADMIN_PASSWORD: PASSWORD }],
  ])('given %s', async (_given, env) => {
    const gateway = gatewayStartedWith(containerStart(env).token, null);
    await expect(platformClaims()).resolves.toBeUndefined();
    expect(gateway.admin()).toEqual({ username: 'admin', password: PASSWORD });
  });

  it('cannot claim, and nor can anyone, a gateway started without the password', async () => {
    const gateway = gatewayStartedWith(
      containerStart({ BIFROST_SETUP_TOKEN: OTHER_TOKEN }).token,
      null,
    );
    await expect(platformClaims()).rejects.toThrow(
      'llm-gateway apply config failed (403)',
    );
    expect(gateway.admin()).toBeNull();
  });
});

describe('a gateway that already has its admin', () => {
  it.each([
    [
      'a different explicit BIFROST_SETUP_TOKEN',
      {
        SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD: PASSWORD,
        BIFROST_SETUP_TOKEN: OTHER_TOKEN,
      },
    ],
    ['no password, so no token', {}],
  ])(
    'takes the platform’s configuration after a restart with %s',
    async (_given, env) => {
      const gateway = gatewayStartedWith(containerStart(env).token, {
        username: 'admin',
        password: PASSWORD,
      });
      await expect(platformClaims()).resolves.toBeUndefined();
      expect(gateway.admin()).toEqual({
        username: 'admin',
        password: PASSWORD,
      });
    },
  );
});
