// @vitest-environment node

/**
 * The branding door as the Branding page drives it: who may read and change
 * the branding behind a session, and what a save hands the writer. The
 * writer itself — the bytes on disk, the compare-and-set, the audit row —
 * is `service.test.ts`'s; here it is a double that records its calls.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { member, readBrandingConfig, saveBranding } = vi.hoisted(() => ({
  // The role the mocked organization gate grants.
  member: { role: 'admin' },
  readBrandingConfig: vi.fn(),
  saveBranding: vi.fn(),
}));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  readBrandingConfig,
  saveBranding,
}));

vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(async () => 'acme'),
}));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'ada@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: member.role } as never);
      await next();
    },
}));

import { ConfigurationError } from '../../core/lib/config_store/precondition';
import { createBrandingRoutes } from './routes.ts';

function app() {
  return createBrandingRoutes({ sql: {} as never, auth: {} as never });
}

async function save(body: unknown): Promise<Response> {
  return await app().request('/save?orgId=o1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const HASH = 'a'.repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  member.role = 'admin';
  saveBranding.mockResolvedValue({ hash: HASH });
  readBrandingConfig.mockResolvedValue({
    config: { accentColor: '#112233' },
    hash: HASH,
  });
});

describe('who may change the branding [BRAND-R5]', () => {
  it.each(['developer', 'editor', 'member'])(
    'refuses a %s, naming the capability, before anything is read or saved',
    async (role) => {
      member.role = role;
      for (const response of [
        await save({ accentColor: '#445566' }),
        await app().request('/config?orgId=o1'),
      ]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
          error: 'ORG_FORBIDDEN',
          message: `Role "${role}" lacks the org-settings capability required to modify branding.`,
        });
      }
      expect(saveBranding).not.toHaveBeenCalled();
      expect(readBrandingConfig).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'admin'])(
    'lets an %s save, handing the writer the fields, the hash and who saved',
    async (role) => {
      member.role = role;
      const response = await save({
        accentColor: '#445566',
        logoFilename: 'logo.png',
        expectedHash: HASH,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ hash: HASH });
      expect(saveBranding).toHaveBeenCalledWith(
        expect.anything(),
        'acme',
        { accentColor: '#445566', logoFilename: 'logo.png' },
        HASH,
        { organizationId: 'o1', userId: 'u1', email: 'ada@example.test' },
      );
    },
  );
});

describe('the branding door', () => {
  it('reads the stored branding with its hash', async () => {
    const response = await app().request('/config?orgId=o1');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      config: { accentColor: '#112233' },
      hash: HASH,
    });
    expect(readBrandingConfig).toHaveBeenCalledWith('acme');
  });

  it("answers a writer's refusal with its code, sentence and status", async () => {
    saveBranding.mockRejectedValue(
      new ConfigurationError(
        'CONFIG_VERSION_CONFLICT',
        'Configuration changed since it was reviewed.',
      ),
    );
    const response = await save({
      accentColor: '#445566',
      expectedHash: HASH,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'CONFIG_VERSION_CONFLICT',
      message: 'Configuration changed since it was reviewed.',
    });
  });
});
