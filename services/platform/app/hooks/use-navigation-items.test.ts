import { describe, expect, it, vi, beforeEach } from 'vitest';

import { persistAutomationMemory } from '@/app/features/automations/lib/detail-memory';
import { persistProjectMemory } from '@/app/features/home/lib/project-memory';
import { persistKnowledgeTabMemory } from '@/app/features/knowledge/lib/knowledge-tab-memory';
import { renderHook } from '@/tests/utils/render';

// The two reads the Home entry's chip depends on: whether the organization
// has an inbox at all, and the unread count the chip carries.
const inbox = { hasInbox: true };
const unread: { data: number | undefined } = { data: undefined };
const unreadCalls: (string | undefined)[] = [];

vi.mock('@/app/features/conversations/hooks/use-inbox-availability', () => ({
  useInboxAvailability: () => inbox,
}));

// Who is looking (an author can read developer settings) and whether the
// organization runs a deployed organization automation.
const viewer = { canAuthor: true };
const automations = { hasLiveOrgAutomation: false };
const availabilityCalls: string[] = [];

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: (action: string, subject: string) =>
      action === 'read' && subject === 'developerSettings'
        ? viewer.canAuthor
        : true,
  }),
}));

vi.mock(
  '@/app/features/automations/hooks/use-automations-availability',
  () => ({
    useAutomationsAvailability: (organizationId: string) => {
      availabilityCalls.push(organizationId);
      return { isLoading: false, ...automations };
    },
  }),
);

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

// The rail resolves a remembered target off the CURRENT location — mutate
// this between assertions to move "where the user is" without a real router.
const mockLocation = { pathname: '/dashboard/org-1/chat' };

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => mockLocation,
}));

const { useNavigationItems } = await import('./use-navigation-items');

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
  viewer.canAuthor = true;
  automations.hasLiveOrgAutomation = false;
  availabilityCalls.length = 0;
  inbox.hasInbox = true;
  unread.data = undefined;
  unreadCalls.length = 0;
  mockLocation.pathname = '/dashboard/org-1/chat';
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
});

describe('the Automations entry', () => {
  const labels = () => items().primary.map((item) => item.label);

  it('always shows for people who build automations', () => {
    viewer.canAuthor = true;
    automations.hasLiveOrgAutomation = false;
    expect(labels()).toContain('automations');
  });

  it('stays hidden for everyone else while nothing is live for them', () => {
    viewer.canAuthor = false;
    automations.hasLiveOrgAutomation = false;
    expect(labels()).toEqual(['home', 'knowledge']);
  });

  it('shows for everyone once a deployed organization automation runs', () => {
    viewer.canAuthor = false;
    automations.hasLiveOrgAutomation = true;
    expect(labels()).toEqual(['home', 'knowledge', 'automations']);
  });

  it('skips the availability read for authors, who see it regardless', () => {
    viewer.canAuthor = true;
    items();
    expect(availabilityCalls.length).toBeGreaterThan(0);
    expect(availabilityCalls.every((id) => id === '')).toBe(true);
  });

  it('asks about the active organization for everyone else', () => {
    viewer.canAuthor = false;
    items();
    expect(availabilityCalls).toContain('org-1');
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
    ]) {
      expect(item?.isActivePath?.(path), path).toBe(false);
    }
  });

  it('starts a fresh chat when clicked while already in Home', () => {
    expect(homeItem()?.reentrySearch).toEqual({ new: true });
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

describe('the Home nav entry — reopening a project', () => {
  it('resolves to the last project visited, arriving from outside Home', () => {
    mockLocation.pathname = '/dashboard/org-1/documents';
    persistProjectMemory('org-1', '/dashboard/org-1/projects/proj-1/files');

    const item = homeItem();
    expect(item?.to).toBe('/dashboard/org-1/projects/proj-1/files');
    expect(item?.state).toEqual({ navRestore: true });
  });

  it('leaves chat as the target while already inside Home', () => {
    mockLocation.pathname = '/dashboard/org-1/chat';
    persistProjectMemory('org-1', '/dashboard/org-1/projects/proj-1/files');

    const item = homeItem();
    expect(item?.to).toBe('/dashboard/$id/chat');
    expect(item?.state).toBeUndefined();
  });

  it('falls back to chat when no project was ever visited', () => {
    mockLocation.pathname = '/dashboard/org-1/documents';

    const item = homeItem();
    expect(item?.to).toBe('/dashboard/$id/chat');
    expect(item?.state).toBeUndefined();
  });
});

describe('the Knowledge nav entry', () => {
  it('opens Documents by default', () => {
    expect(knowledgeItem()?.to).toBe('/dashboard/$id/documents');
  });

  it('reopens the last tab visited, arriving from outside Knowledge', () => {
    persistKnowledgeTabMemory('org-1', 'websites');
    expect(knowledgeItem()?.to).toBe('/dashboard/$id/websites');
  });

  it('stays on Documents while already inside Knowledge', () => {
    mockLocation.pathname = '/dashboard/org-1/websites';
    persistKnowledgeTabMemory('org-1', 'products');

    expect(knowledgeItem()?.to).toBe('/dashboard/$id/documents');
  });
});

describe('the Automations nav entry', () => {
  it('opens the list by default', () => {
    expect(automationsItem()?.to).toBe('/dashboard/$id/automations');
  });

  it('reopens the last automation page visited, arriving from outside Automations', () => {
    persistAutomationMemory(
      'org-1',
      '/dashboard/org-1/automations/billing__dunning/runs',
    );

    const item = automationsItem();
    expect(item?.to).toBe('/dashboard/org-1/automations/billing__dunning/runs');
    expect(item?.state).toEqual({ navRestore: true });
  });

  it('stays on the list while already inside Automations', () => {
    mockLocation.pathname =
      '/dashboard/org-1/automations/billing__dunning/runs';
    persistAutomationMemory(
      'org-1',
      '/dashboard/org-1/automations/billing__dunning/runs',
    );

    const item = automationsItem();
    expect(item?.to).toBe('/dashboard/$id/automations');
    expect(item?.state).toBeUndefined();
  });
});
