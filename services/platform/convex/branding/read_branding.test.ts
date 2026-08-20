import { describe, expect, it, vi, beforeEach } from 'vitest';

// Regression coverage for #3019: a stale bookmark/tab keeps requesting a
// deleted organization's branding until the dashboard bounces it away — and
// `readBranding` is deliberately pre-auth, so any client can hold a dead id.
// A terminal slug miss must therefore serve the platform `default` bucket
// (the same result an org without a branding file gets), not reject with an
// uncaught `OrgSlugUnresolvableError`. Transient lookup failures still
// propagate so retry layers keep seeing them.

const mockOrgIdentityFromId = vi.fn();
vi.mock('../lib/helpers/org_slug', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/helpers/org_slug')>();
  return {
    ...mod,
    orgIdentityFromId: (...args: unknown[]) => mockOrgIdentityFromId(...args),
  };
});

const mockReadJsonFile = vi.fn();
vi.mock('../lib/file_io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/file_io')>();
  return {
    ...mod,
    readJsonFile: (...args: unknown[]) => mockReadJsonFile(...args),
  };
});

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    action: (config: Record<string, unknown>) => config,
  };
});

const { OrgSlugUnresolvableError } = await import('../lib/helpers/org_slug');

// oxlint-disable-next-line typescript/no-explicit-any -- builders mocked to identity (third-party gap per AGENTS.md)
type Handler = { handler: (...args: unknown[]) => Promise<any> };

async function loadReadBranding(): Promise<Handler> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  const mod = (await import('./file_actions')) as unknown as Record<
    string,
    Handler
  >;
  return mod.readBranding;
}

const DELETED_ORG_ID = 'jh7csd7ks8740bza6qsxbz6sph7yegh2';
const ctx = {} as unknown;

/** Every case below ends in the "no branding file on disk" read. */
function mockBrandingFileMissing(): void {
  mockReadJsonFile.mockResolvedValue({
    ok: false,
    error: 'not_found',
    message: 'ENOENT',
  });
}

/** The on-disk path the handler asked `readJsonFile` for. */
function readPath(): string {
  return String(mockReadJsonFile.mock.calls[0]?.[0]);
}

describe('readBranding on a deleted organization (#3019)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TALE_CONFIG_DIR = '/tmp/tale-branding-read-test';
  });

  it('serves the default bucket when the org id no longer resolves', async () => {
    mockOrgIdentityFromId.mockRejectedValue(
      new OrgSlugUnresolvableError(DELETED_ORG_ID, 'no_row'),
    );
    mockBrandingFileMissing();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { handler } = await loadReadBranding();
    const result = await handler(ctx, { organizationId: DELETED_ORG_ID });

    expect(result).toEqual({
      appName: undefined,
      logoUrl: null,
      faviconLightUrl: null,
      faviconDarkUrl: null,
      hash: '',
    });
    expect(readPath()).toContain('/default/');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('still propagates a transient resolution failure', async () => {
    mockOrgIdentityFromId.mockRejectedValue(
      new Error('betterAuth adapter unavailable'),
    );
    mockBrandingFileMissing();

    const { handler } = await loadReadBranding();

    await expect(
      handler(ctx, { organizationId: DELETED_ORG_ID }),
    ).rejects.toThrow('betterAuth adapter unavailable');
    expect(mockReadJsonFile).not.toHaveBeenCalled();
  });

  it('keeps resolving a live organization to its own bucket', async () => {
    mockOrgIdentityFromId.mockResolvedValue({ slug: 'acme', name: 'Acme AG' });
    mockBrandingFileMissing();

    const { handler } = await loadReadBranding();
    const result = await handler(ctx, { organizationId: 'org_live' });

    expect(result).toEqual({
      appName: 'Acme AG',
      logoUrl: null,
      faviconLightUrl: null,
      faviconDarkUrl: null,
      hash: '',
    });
    expect(readPath()).toContain('/acme/');
  });

  it('reads the default bucket when no organization is in scope', async () => {
    mockBrandingFileMissing();

    const { handler } = await loadReadBranding();
    const result = await handler(ctx, {});

    expect(mockOrgIdentityFromId).not.toHaveBeenCalled();
    expect(readPath()).toContain('/default/');
    expect(result).toEqual({
      appName: undefined,
      logoUrl: null,
      faviconLightUrl: null,
      faviconDarkUrl: null,
      hash: '',
    });
  });
});
