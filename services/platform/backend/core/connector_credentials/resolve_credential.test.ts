// @vitest-environment node

/**
 * The core resolver: the seam the mailbox sync and the sandbox's credential
 * broker read a connector credential through. It never mints or renews a
 * token, so it hands out no GitHub App token at all — neither a header nor a
 * secret binding — whatever the envelope holds [CCRED-R18]; every other
 * method resolves as it always has.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../lib/ctx';
import { encryptSecret } from '../lib/secret_box';

vi.mock('../lib/handler_names', () => ({
  internal: {
    connector_credentials: {
      queries: {
        resolveCredentialRefInternal: 'resolveCredentialRefInternal',
      },
    },
  },
}));

import { resolveConnectorCredential } from './resolve_credential';

const TOKEN = 'ghs_installationTokenValue0123456789';
const PAT = 'ghp_personalAccessToken0123';
const APP = {
  appId: 4242,
  clientId: 'Iv23liExample',
  slug: 'tale-acme',
  // The shape of a PEM key, not a key: nothing is signed here.
  privateKey:
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAsecretkeymaterial0123456789\n-----END RSA PRIVATE KEY-----\n',
  installation: {
    id: 777,
    account: 'acme',
    accountType: 'Organization',
    repositorySelection: 'selected',
  },
};

/** A ctx whose credential lookup finds `row`. */
function ctxFinding(row: Record<string, unknown>) {
  const runQuery = vi.fn(async (_ref: unknown, _args: unknown) => row);
  return { ctx: { runQuery } as unknown as ActionCtx, runQuery };
}

function credentialRow(
  authMethod: string,
  envelope: Record<string, unknown>,
): Record<string, unknown> {
  return {
    _id: `cred_${authMethod}`,
    organizationId: 'org_1',
    connectorSlug: 'github',
    authMethod,
    name: 'GitHub',
    encryptedData: encryptSecret(JSON.stringify(envelope)),
    status: 'active',
  };
}

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolving a connector credential without freshening it', () => {
  it.each([
    ['a live token', Date.now() + 3_600_000],
    ['a token that expires within the minute', Date.now() + 30_000],
    ['an expired token', Date.now() - 1],
  ])(
    '[CCRED-R18] hands out no GitHub App token, whatever the envelope holds: %s',
    async (_case, expiresAt) => {
      const { ctx, runQuery } = ctxFinding(
        credentialRow('github-app', {
          ...APP,
          accessToken: TOKEN,
          expiresAt,
        }),
      );
      const resolved = await resolveConnectorCredential(ctx, {
        organizationId: 'org_1',
        connectorSlug: 'github',
      });
      expect(resolved).toEqual({
        credentialId: 'cred_github-app',
        connectorSlug: 'github',
        authMethod: 'github-app',
        secrets: {},
        config: {},
      });
      expect(JSON.stringify(resolved)).not.toContain(TOKEN);
      expect(runQuery).toHaveBeenCalledWith('resolveCredentialRefInternal', {
        organizationId: 'org_1',
        connectorSlug: 'github',
      });
    },
  );

  it("still injects a person's token for the same connector", async () => {
    const { ctx } = ctxFinding(credentialRow('bearer', { token: PAT }));
    expect(
      await resolveConnectorCredential(ctx, {
        organizationId: 'org_1',
        connectorSlug: 'github',
        credentialRef: 'GitHub',
      }),
    ).toEqual({
      credentialId: 'cred_bearer',
      connectorSlug: 'github',
      authMethod: 'bearer',
      secrets: { token: PAT, accessToken: PAT },
      config: {},
      authHeader: `Bearer ${PAT}`,
    });
  });
});
