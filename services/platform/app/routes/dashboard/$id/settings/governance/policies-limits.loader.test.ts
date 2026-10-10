// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { memberContextQuery } from '@/app/lib/backend/org';
import { backendKey } from '@/app/lib/backend/query-keys';

// Policies & Limits is admin-only, yet its loader used to warm every policy
// the page's editors read for whoever opened it. On a cold deep link the
// member context is still in flight when the loader runs (TanStack runs the
// dashboard's loader beside it), so a member was asked for four admin-only
// policies and answered 403 four times (#3098). The loader runs here over
// the real adapter rows and a `fetch` stubbed as the governance door
// answers: admin-only types refuse a non-admin.

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  useRouterState: () => ({}),
}));
vi.mock('@/app/features/settings/governance/components/budget-editor', () => ({
  BudgetEditor: () => null,
}));
vi.mock(
  '@/app/features/settings/governance/components/conversation-routing-policy-editor',
  () => ({ ConversationRoutingPolicyEditor: () => null }),
);
vi.mock(
  '@/app/features/settings/governance/components/data-notice-policy-editor',
  () => ({ DataNoticePolicyEditor: () => null }),
);
vi.mock(
  '@/app/features/settings/governance/components/feature-flags-editor',
  () => ({ FeatureFlagsEditor: () => null }),
);
vi.mock(
  '@/app/features/settings/governance/components/personalization-policy-editor',
  () => ({ PersonalizationPolicyEditor: () => null }),
);
vi.mock(
  '@/app/features/settings/governance/components/retention-editor',
  () => ({ RetentionEditor: () => null }),
);
vi.mock(
  '@/app/features/settings/governance/components/skill-sharing-policy-editor',
  () => ({ SkillSharingPolicyEditor: () => null }),
);
vi.mock(
  '@/app/features/settings/governance/components/upload-policy-editor',
  () => ({ UploadPolicyEditor: () => null }),
);
vi.mock(
  '@/app/features/settings/governance/components/voice-output-policy-editor',
  () => ({ VoiceOutputPolicyEditor: () => null }),
);

import { Route } from './policies-limits';

type Role = 'member' | 'editor' | 'developer' | 'admin' | 'owner';

/** What the page's editors read that the governance door refuses a
 * non-admin (`backend/domains/governance/routes.ts`). */
const ADMIN_ONLY = [
  'budgets',
  'project_budgets',
  'retention_policy',
  'voice_output',
  'conversation_routing',
  'skill_sharing',
];
const MEMBER_READABLE = [
  'upload_policy',
  'feature_flags',
  'custom_instructions',
  'data_classification_notice',
];
const POLICY_PATH = '/api/app/governance/policies/';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function memberContext(role: Role) {
  return {
    status: 'ok' as const,
    memberId: 'm-1',
    organizationId: 'org-1',
    userId: 'u-1',
    role,
    createdAt: 0,
    displayName: undefined,
    isAdmin: role === 'admin' || role === 'owner',
  };
}

/** The backend as `role` meets it; `members/me` answers `memberMe`. */
function stubBackend(role: Role, memberMe?: Response) {
  const policyReads: string[] = [];
  const refusals: string[] = [];
  vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.href,
      'http://tale.test',
    );
    if (url.pathname === '/api/app/members/me') {
      return memberMe?.clone() ?? json(memberContext(role));
    }
    if (url.pathname.startsWith(POLICY_PATH)) {
      const policyType = url.pathname.slice(POLICY_PATH.length);
      policyReads.push(policyType);
      if (
        ADMIN_ONLY.includes(policyType) &&
        role !== 'admin' &&
        role !== 'owner'
      ) {
        refusals.push(policyType);
        return json({ error: 'FORBIDDEN' }, 403);
      }
      return json({ policy: null });
    }
    return json({ error: 'Not Found' }, 404);
  });
  return { policyReads, refusals };
}

/** The route's loader, as TanStack calls it — `preload` on a hover. */
async function runLoader(queryClient: QueryClient, preload = false) {
  const { loader } = Route as unknown as {
    loader: (args: {
      context: { queryClient: QueryClient };
      params: { id: string };
      preload: boolean;
    }) => Promise<unknown>;
  };
  await loader({ context: { queryClient }, params: { id: 'org-1' }, preload });
}

function withCachedRole(role: Role): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    memberContextQuery('org-1').queryKey,
    memberContext(role),
  );
  return queryClient;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('policies-limits loader', () => {
  it.each(['member', 'editor', 'developer'] as const)(
    "never asks for an admin-only policy on a %s's cold deep link",
    async (role) => {
      const backend = stubBackend(role);

      await runLoader(new QueryClient());

      expect(backend.refusals).toEqual([]);
      expect(backend.policyReads.filter((t) => ADMIN_ONLY.includes(t))).toEqual(
        [],
      );
    },
  );

  it("asks for nothing on a member's hover once the role is known", async () => {
    const backend = stubBackend('member');

    await runLoader(withCachedRole('member'), true);

    expect(backend.policyReads).toEqual([]);
  });

  it.each(['admin', 'owner'] as const)(
    'warms every policy for an %s on a cold deep link',
    async (role) => {
      const backend = stubBackend(role);
      const queryClient = new QueryClient();

      await runLoader(queryClient);

      expect([...backend.policyReads].toSorted()).toEqual(
        [...ADMIN_ONLY, ...MEMBER_READABLE].toSorted(),
      );
      for (const policyType of [...ADMIN_ONLY, ...MEMBER_READABLE]) {
        expect(
          queryClient.getQueryState(
            backendKey('org-1', 'governance_policy', policyType),
          )?.status,
        ).toBe('success');
      }
    },
  );

  it('warms every policy for an admin on a hover', async () => {
    const backend = stubBackend('admin');

    await runLoader(withCachedRole('admin'), true);

    expect([...backend.policyReads].toSorted()).toEqual(
      [...ADMIN_ONLY, ...MEMBER_READABLE].toSorted(),
    );
  });

  // No role to go on: a lapsed session (the session door's 401) or a caller
  // who is no member of the organization at all (403 ORG_FORBIDDEN). The
  // admin-only reads are skipped, and neither is a preload failure worth the
  // route's warning: the page's own reads meet the same answer.
  it.each([
    [
      'a lapsed session',
      json(
        {
          error:
            'Missing or invalid session — sign in, or send an API key as "Authorization: Bearer <key>" to the REST API under /api/v1',
          code: 'UNAUTHORIZED',
        },
        401,
      ),
    ],
    ['no membership', json({ error: 'ORG_FORBIDDEN' }, 403)],
  ])(
    'asks for no admin-only policy when the member context reads %s',
    async (_label, memberMe) => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const backend = stubBackend('member', memberMe);

      await expect(runLoader(new QueryClient())).resolves.toBeUndefined();

      expect(backend.policyReads.filter((t) => ADMIN_ONLY.includes(t))).toEqual(
        [],
      );
      expect(warn).not.toHaveBeenCalled();
    },
  );

  // Any other refusal of the member-context read is worth a diagnostic: the
  // admin-only reads are still skipped, and the route logs why.
  it('skips the admin-only policies and warns on any other member-context refusal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const backend = stubBackend(
      'member',
      json({ error: 'RBAC_FORBIDDEN' }, 403),
    );

    await expect(runLoader(new QueryClient())).resolves.toBeUndefined();

    expect(backend.policyReads.filter((t) => ADMIN_ONLY.includes(t))).toEqual(
      [],
    );
    expect(warn).toHaveBeenCalledWith(
      'Failed to preload policies-limits policies',
      expect.anything(),
    );
  });
});
