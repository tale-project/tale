import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedActor } from '@/app/features/tasks/hooks/use-actor-directory';
import type { ReturnsOf } from '@/app/lib/backend/contract';
import { i18n } from '@/lib/i18n/i18n';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
  type ShippedLocale,
} from '@/tests/utils/lapsed-session';
import { render, screen } from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { SharedChatView } from './shared-chat-view';

/**
 * The byline names who shared the chat from the organization's member
 * directory. Someone it no longer lists — they left the organization — is a
 * former member, in a sentence of the reader's language; before it has
 * answered the name is a placeholder. Their raw user id is never shown
 * (#3788). The directory stands in with the answers the real one gives.
 */

const SHARER = 'pTqO7Cn7D9MmBLjW1v2p9yne5Ed1BxOb';

const directory = vi.hoisted(() => ({
  sharer: undefined as ResolvedActor | undefined,
}));

vi.mock(
  '@/app/features/tasks/hooks/use-actor-directory',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/features/tasks/hooks/use-actor-directory')
    >()),
    useActorDirectory: () => ({ resolveActor: () => directory.sharer }),
  }),
);

type SharedThread = NonNullable<ReturnsOf<'chat/threads:getSharedThread'>>;

const SHARED = /^GET \/api\/app\/chat\/threads\/shared\/share-1\?orgId=org-1$/;
const SNAPSHOT: SharedThread = {
  threadId: 'thread-1',
  title: 'Q3 board summary',
  sharedBy: SHARER,
  sharedAt: Date.UTC(2026, 9, 28, 9, 30),
  agentSlug: undefined,
  messages: [],
};

const FORMER_BYLINE: Record<ShippedLocale, RegExp> = {
  en: /^Shared by a former member on /,
  de: /^Geteilt von einem ehemaligen Mitglied am /,
  fr: /^Partagé par un ancien membre le /,
};

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard/org-1/chat/shared/share-1');
  backend = syntheticBackend();
  backend.on(SHARED, () => Response.json(SNAPSHOT));
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

async function renderShared() {
  const view = render(
    <QueryClientProvider client={client}>
      <SharedChatView organizationId="org-1" shareToken="share-1" />
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: SNAPSHOT.title });
  return view;
}

describe('SharedChatView — who shared it', () => {
  it.each(SHIPPED_LOCALES)(
    'says a former member shared it, never their id (%s)',
    async (locale) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      directory.sharer = {
        type: 'user',
        id: SHARER,
        name: i18n.t('formerMember', { ns: 'common' }),
        isAgent: false,
        standing: 'former',
      };
      const { container } = await renderShared();

      expect(screen.getByText(FORMER_BYLINE[locale])).toBeInTheDocument();
      expect(container.innerHTML).not.toContain(SHARER);
    },
  );

  it('holds a placeholder for the name until the directory answers', async () => {
    directory.sharer = {
      type: 'user',
      id: SHARER,
      name: '',
      isAgent: false,
      standing: 'pending',
    };
    const { container } = await renderShared();

    expect(screen.queryByText(/Shared by/)).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain(SHARER);
  });

  it('names a member who shared it', async () => {
    directory.sharer = {
      type: 'user',
      id: SHARER,
      name: 'Mara Keller',
      isAgent: false,
    };
    await renderShared();

    expect(screen.getByText(/^Shared by Mara Keller on /)).toBeInTheDocument();
  });
});
