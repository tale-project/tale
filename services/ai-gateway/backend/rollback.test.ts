/**
 * A roll back is a documented operation — ops' runbook for this deployment is
 * "dispatch the workflow with the previous version" — so a document this
 * version writes has to stay readable by the release before it. That release
 * refuses any document that does not match its schema, and refusing it serves
 * nothing at all: no panel, no tokens. The schema below is 0.5.53's, as it
 * shipped; the test writes a document the way this version does and asks the
 * old one to read it.
 */

import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createAccountService } from './accounts';
import { createTokenCipher } from './crypto';
import type { Provider } from './providers/types';
import { createFileAccountStore } from './store';

const PROVIDER_IDS = ['anthropic', 'openai'] as const;

/** 0.5.53's `backend/store.ts` document schema, copied as it shipped. */
const previousRelease = z.object({
  version: z.literal(1),
  accounts: z.array(
    z.object({
      id: z.string().min(1),
      provider: z.enum(PROVIDER_IDS),
      label: z.string(),
      accountEmail: z.string().nullable(),
      accountId: z.string().nullable(),
      plan: z.string().nullable(),
      accessToken: z.string(),
      refreshToken: z.string(),
      expiresAt: z.string().nullable(),
      scopes: z.string().nullable(),
      status: z.enum(['active', 'expired', 'error']),
      createdAt: z.string(),
      lastRefreshedAt: z.string().nullable(),
      usage: z
        .object({
          windows: z.array(
            z.object({
              kind: z.enum(['session', 'weekly', 'scoped']),
              label: z.string().nullable(),
              utilization: z.number().nullable(),
              resetsAt: z.string().nullable(),
              windowSeconds: z.number().nullable().default(null),
            }),
          ),
          checkedAt: z.string(),
        })
        .nullable(),
    }),
  ),
  pending: z.array(
    z.object({
      state: z.string().min(1),
      provider: z.enum(PROVIDER_IDS),
      codeVerifier: z.string().min(1),
      redirectUri: z.string().min(1),
      targetAccountId: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

/** Just enough of a vendor to connect one account and start a device code. */
function provider(id: 'anthropic' | 'openai'): Provider {
  return {
    id,
    cliCommand: () => '',
    beginAuthorization: (state, { preferBrowser }) =>
      Promise.resolve(
        id === 'openai' && !preferBrowser
          ? {
              flow: 'device',
              verificationUrl: 'https://example.test/device',
              userCode: 'ABCD-EFGH',
              deviceAuthId: 'device-1',
              intervalSeconds: 5,
              expiresAt: '2026-09-24T10:15:00.000Z',
            }
          : {
              flow: 'paste',
              authorizeUrl: `https://example.test/authorize?state=${state}`,
              codeVerifier: 'verifier',
              redirectUri: 'https://example.test/callback',
              pasteStyle: 'code',
            },
      ),
    parseCallback: (pasted) => ({ code: pasted, state: null }),
    exchangeCode: () =>
      Promise.resolve({
        tokens: {
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          expiresAt: '2026-09-25T10:00:00.000Z',
          scopes: 'scope',
        },
        identity: {
          email: 'you@example.com',
          accountId: null,
          subscription: { plan: 'max', tier: '20x' },
        },
      }),
    refresh: () => Promise.reject(new Error('not needed here')),
    fetchUsage: () =>
      Promise.resolve({
        windows: [
          {
            kind: 'weekly',
            label: null,
            utilization: 57,
            resetsAt: '2026-09-26T17:00:00.000Z',
            windowSeconds: 604_800,
          },
        ],
        subscription: null,
      }),
  };
}

describe('the account document, read by the release before this one', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ai-gateway-rollback-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('parses, accounts and waiting device codes alike', async () => {
    const service = createAccountService({
      store: createFileAccountStore({ dataDir: dir }),
      providers: {
        anthropic: provider('anthropic'),
        openai: provider('openai'),
      },
      cipher: createTokenCipher(randomBytes(32)),
      tokenRefreshSkewSeconds: 300,
      usageMinIntervalSeconds: 180,
      now: () => new Date('2026-09-24T10:00:00.000Z'),
    });

    // One account connected with everything this version adds to a row —
    // a plan, a reading, the identity clock — and one device code waiting.
    const { state } = await service.beginAuthorization({
      provider: 'anthropic',
    });
    await service.completeAuthorization({ state, pasted: 'code-1' });
    await service.beginAuthorization({ provider: 'openai' });

    const raw: unknown = JSON.parse(
      await readFile(join(dir, 'accounts.json'), 'utf8'),
    );
    const read = previousRelease.safeParse(raw);
    expect(read.error?.issues ?? []).toEqual([]);
    expect(read.data?.accounts[0]?.plan).toBeNull();
  });
});
