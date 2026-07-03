import { ConvexError } from 'convex/values';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Regression coverage for #2044: every branding write flows through
// `requireBrandingAdmin`, which must gate on the `write orgSettings`
// capability. Only owner/admin hold it; all other roles (notably `developer`,
// which carries `can('write','all')`) must be rejected with `ORG_FORBIDDEN`.
// `requireBrandingAdmin` is internal, so we drive it through the exported
// `saveImage` action.

const mockRequireOrgMembershipById = vi.fn();
vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: (...args: unknown[]) =>
    mockRequireOrgMembershipById(...args),
}));

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    action: (config: Record<string, unknown>) => config,
  };
});

// oxlint-disable-next-line typescript/no-explicit-any -- builders mocked to identity (third-party gap per AGENTS.md)
type Handler = { handler: (...args: unknown[]) => Promise<any> };

async function loadSaveImage(): Promise<Handler> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  const mod = (await import('./file_actions')) as unknown as Record<
    string,
    Handler
  >;
  return mod.saveImage;
}

function mockMember(role: string): void {
  mockRequireOrgMembershipById.mockResolvedValue({
    orgSlug: 'acme',
    userId: 'user_1',
    email: 'caller@example.com',
    member: { role },
  });
}

function errorCode(err: unknown): string | undefined {
  if (err instanceof ConvexError) {
    const data = err.data;
    if (typeof data === 'object' && data !== null && 'code' in data) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexError data shape is { code, message }
      return (data as { code?: string }).code;
    }
  }
  return undefined;
}

describe('branding requireBrandingAdmin authorization (#2044)', () => {
  beforeEach(() => {
    mockRequireOrgMembershipById.mockReset();
  });

  // An invalid image type makes the allowed roles fail *after* the gate
  // (proving they cleared it) instead of writing to the filesystem.
  const INVALID_TYPE = 'not-a-real-image-type';
  const ctx = {} as unknown;

  it.each(['developer', 'editor', 'member', 'disabled'])(
    'rejects %s with ORG_FORBIDDEN',
    async (role) => {
      mockMember(role);
      const { handler } = await loadSaveImage();
      const err = await handler(ctx, {
        organizationId: 'org_1',
        type: INVALID_TYPE,
        base64: '',
        mimeType: 'image/png',
      }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('ORG_FORBIDDEN');
    },
  );

  it.each(['owner', 'admin'])(
    'allows %s past the auth gate (fails later on image type, not ORG_FORBIDDEN)',
    async (role) => {
      mockMember(role);
      const { handler } = await loadSaveImage();
      const err = await handler(ctx, {
        organizationId: 'org_1',
        type: INVALID_TYPE,
        base64: '',
        mimeType: 'image/png',
      }).then(
        () => null,
        (e: unknown) => e,
      );
      // Owner/admin clear the capability gate; the invalid image type then
      // fails with IMAGE_TYPE_INVALID (not ORG_FORBIDDEN) — proving the role
      // was not rejected at the gate.
      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('IMAGE_TYPE_INVALID');
      expect(errorCode(err)).not.toBe('ORG_FORBIDDEN');
    },
  );
});
