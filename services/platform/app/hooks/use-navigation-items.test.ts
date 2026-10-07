import { describe, expect, it, vi, beforeEach } from 'vitest';

import { defineAbilityFor } from '@/lib/permissions/ability';
import { renderHook } from '@/tests/utils/render';

// The two reads the Home entry's chip depends on: whether the organization
// has an inbox at all, and the unread count the chip carries.
const inbox = {
  get showInbox() {
    return this.hasInbox;
  },
  hasInbox: true,
};
const unread: { data: number | undefined } = { data: undefined };
const unreadCalls: (string | undefined)[] = [];

vi.mock('@/app/features/conversations/hooks/use-inbox-availability', () => ({
  useInboxAvailability: () => inbox,
}));

// Who is looking: the real ability of that platform role.
const viewer = { role: 'developer' };

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => defineAbilityFor(viewer.role),
}));

// Whatever the organization runs: here a deployed organization-wide
// automation, which must not bring the entry back for anyone else.
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({
    data: [
      { name: 'mail-sync', latest: 1, projectIds: [], deployedVersion: 1 },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/app/features/conversations/hooks/queries', () => ({
  useUnreadConversationCount: (organizationId: string | undefined) => {
    unreadCalls.push(organizationId);
    return unread;
  },
}));

// `t(key, vars)` echoes the key with its count so an assertion can tell the
// badge's label apart from every other translated string.
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars && 'count' in vars ? `${key}:${String(vars.count)}` : key,
  }),
}));

vi.mock('@tale/ui/use-is-mac', () => ({ useIsMac: () => false }));

const { isItemActive, useNavigationItems } =
  await import('./use-navigation-items');

function items() {
  const { result } = renderHook(() => useNavigationItems('org-1'));
  return result.current;
}

function homeItem() {
  return items().primary.find((item) => item.label === 'home');
}

function knowledgeItem() {
  return items().primary.find((item) => item.label === 'knowledge');
}

function automationsItem() {
  return items().primary.find((item) => item.label === 'automations');
}

beforeEach(() => {
  viewer.role = 'developer';
  inbox.hasInbox = true;
  unread.data = undefined;
  unreadCalls.length = 0;
  window.localStorage.clear();
});

describe('the rail', () => {
  it('lists the working sections, with Settings pinned to the foot', () => {
    const { primary, pinned } = items();
    expect(primary.map((item) => item.label)).toEqual([
      'home',
      'knowledge',
      'automations',
    ]);
    expect(pinned.map((item) => item.label)).toEqual(['userSettings']);
  });

  // A tile is a request for the section, never a replay of a place in it —
  // the same page every time, whatever was open there before. The places an
  // earlier build remembered are planted in storage, where browsers still
  // keep them: no tile may read them.
  it("opens every section's first page", () => {
    window.localStorage.setItem(
      'tale.platform.automations.org-1.lastPath',
      '/dashboard/org-1/automations/billing__dunning/runs',
    );
    window.localStorage.setItem(
      'tale.platform.home.org-1.lastProjectPath',
      '/dashboard/org-1/projects/proj-1/files',
    );
    window.localStorage.setItem(
      'tale.platform.knowledge.org-1.lastTab',
      'websites',
    );

    const { primary, pinned } = items();
    expect(
      [...primary, ...pinned].map(({ label, to, params, search }) => ({
        label,
        to,
        params,
        search,
      })),
    ).toEqual([
      {
        label: 'home',
        to: '/dashboard/$id/chat',
        params: { id: 'org-1' },
        search: { new: true },
      },
      {
        label: 'knowledge',
        to: '/dashboard/$id/documents',
        params: { id: 'org-1' },
        search: undefined,
      },
      {
        label: 'automations',
        to: '/dashboard/$id/automations',
        params: { id: 'org-1' },
        search: undefined,
      },
      {
        label: 'userSettings',
        to: '/dashboard/$id/settings',
        params: { id: 'org-1' },
        search: undefined,
      },
    ]);
    for (const item of [...primary, ...pinned]) {
      expect(item, item.label).not.toHaveProperty('state');
    }
  });
});

describe('the Automations entry', () => {
  const labels = () => items().primary.map((item) => item.label);

  it.each(['owner', 'admin', 'developer'])('shows for the %s role', (role) => {
    viewer.role = role;
    expect(labels()).toEqual(['home', 'knowledge', 'automations']);
  });

  it.each(['editor', 'member'])('never shows for the %s role', (role) => {
    viewer.role = role;
    expect(labels()).toEqual(['home', 'knowledge']);
  });
});

describe('the Home nav entry', () => {
  it('opens the chat and lights up on every Home route', () => {
    const item = homeItem();
    expect(item?.to).toBe('/dashboard/$id/chat');
    for (const path of [
      '/dashboard/org-1/chat',
      '/dashboard/org-1/chat/thread-1',
      '/dashboard/org-1/projects',
      '/dashboard/org-1/projects/p-1/tasks/board',
      // The project's Automations tab is the project's own page.
      '/dashboard/org-1/projects/p-1/automations',
      '/dashboard/org-1/tasks/t-1',
      '/dashboard/org-1/conversations/open',
    ]) {
      expect(item?.isActivePath?.(path), path).toBe(true);
    }
    for (const path of [
      '/dashboard/org-1/documents',
      '/dashboard/org-1/automations',
      '/dashboard/org-1/settings/account',
      // A shared-chat snapshot is a standalone reading page.
      '/dashboard/org-1/chat/shared/token-1',
      // An automation opened inside a project is Automations' page.
      '/dashboard/org-1/projects/p-1/automations/intake',
      '/dashboard/org-1/projects/p-1/automations/intake/editor',
      '/dashboard/org-1/projects/p-1/automations/intake/runs/r-1',
    ]) {
      expect(item?.isActivePath?.(path), path).toBe(false);
    }
  });

  it('always opens a fresh chat, never the last one', () => {
    const item = homeItem();
    expect(item?.to).toBe('/dashboard/$id/chat');
    expect(item?.search).toEqual({ new: true });
  });

  it('carries the unread inbox count as its badge', () => {
    unread.data = 3;
    const item = homeItem();
    expect(item?.badge).toBe(3);
    expect(item?.badgeLabel).toBe('aria.unreadConversations:3');
  });

  it('rests at zero while the count is still loading', () => {
    // `undefined` is "not read yet", not "none" — the tile must render bare
    // rather than flash a chip, and `badge: undefined` would drop the label.
    unread.data = undefined;
    expect(homeItem()?.badge).toBe(0);
  });

  it('reports nothing to show when the queue is clear', () => {
    unread.data = 0;
    expect(homeItem()?.badge).toBe(0);
  });

  it('skips the count read when the organization has no inbox', () => {
    inbox.hasInbox = false;
    expect(homeItem()?.badge).toBe(0);
    expect(unreadCalls).toEqual([undefined]);
  });

  it('asks for the count scoped to the active organization', () => {
    homeItem();
    expect(unreadCalls).toEqual(['org-1']);
  });
});

describe('the Knowledge nav entry', () => {
  it('opens Documents and lights up on every Knowledge tab', () => {
    const item = knowledgeItem();
    expect(item?.to).toBe('/dashboard/$id/documents');
    for (const path of [
      '/dashboard/org-1/documents',
      '/dashboard/org-1/knowledge-entries',
      '/dashboard/org-1/websites',
      '/dashboard/org-1/products',
      '/dashboard/org-1/contacts',
    ]) {
      expect(item && isItemActive(item, path), path).toBe(true);
    }
    expect(item && isItemActive(item, '/dashboard/org-1/chat')).toBe(false);
  });
});

describe('the Automations nav entry', () => {
  it('opens the list', () => {
    expect(automationsItem()?.to).toBe('/dashboard/$id/automations');
  });

  it('lights up on an automation opened inside a project', () => {
    const item = automationsItem();
    for (const path of [
      '/dashboard/org-1/automations',
      '/dashboard/org-1/automations/intake/runs',
      '/dashboard/org-1/projects/p-1/automations/intake',
      '/dashboard/org-1/projects/p-1/automations/intake/editor',
      '/dashboard/org-1/projects/p-1/automations/intake/runs/r-1',
    ]) {
      expect(item && isItemActive(item, path), path).toBe(true);
    }
    for (const path of [
      // The project's own Automations tab stays Home's.
      '/dashboard/org-1/projects/p-1/automations',
      '/dashboard/org-1/projects/p-1/tasks/board',
      '/dashboard/org-1/documents',
      '/dashboard/org-1/automationsx',
      '/dashboard/org-2/projects/p-1/automations/intake',
    ]) {
      expect(item && isItemActive(item, path), path).toBe(false);
    }
  });
});
