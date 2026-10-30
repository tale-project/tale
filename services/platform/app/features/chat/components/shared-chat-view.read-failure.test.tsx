import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReturnsOf } from '@/app/lib/backend/contract';
import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  LAPSED_SESSION_ANSWER,
  SESSION_ENDED,
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
  type ShippedLocale,
} from '@/tests/utils/lapsed-session';
import {
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { SharedChatView } from './shared-chat-view';

// The byline names the sharer from the organization's member directory,
// which this suite is not about: the directory is stood in.
vi.mock(
  '@/app/features/tasks/hooks/use-actor-directory',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/features/tasks/hooks/use-actor-directory')
    >()),
    useActorDirectory: () => ({
      resolveActor: () => ({ name: 'Mara Keller' }),
    }),
  }),
);

// The retries make four attempts before a failure settles; on a loaded
// runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #4535: every failed read of a shared chat said the share was withdrawn —
// "This shared chat is no longer available." — with no way to ask again, so
// a lost connection, a server fault or an ended session read the same as a
// link its owner took down. The whole read lane runs for real here — the
// view's query, `sharedThreadQuery`, `backendFetch` and react-query's retries
// (four attempts for a failure that carries no structured payload, as the
// app's client makes) — against a closed synthetic transport, so the same
// mounted view can be watched failing and recovering.

type SharedThread = NonNullable<ReturnsOf<'chat/threads:getSharedThread'>>;

const SHARED = /^GET \/api\/app\/chat\/threads\/shared\/share-1\?orgId=org-1$/;

const QUESTION = 'Summarize the Q3 numbers for the board.';
const SNAPSHOT: SharedThread = {
  threadId: 'thread-1',
  title: 'Q3 board summary',
  sharedBy: 'user-mara',
  sharedAt: Date.UTC(2026, 9, 28, 9, 30),
  agentSlug: undefined,
  messages: [
    {
      id: 'm1',
      role: 'user',
      parts: [{ type: 'text', text: QUESTION }],
      sequence: 0,
      model: undefined,
      providerSlug: undefined,
      blockedReason: undefined,
      error: undefined,
      createdAt: Date.UTC(2026, 9, 28, 9, 0),
    },
    {
      id: 'm2',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Revenue grew 12% over Q2.' }],
      sequence: 1,
      model: 'model-a',
      providerSlug: 'provider-a',
      blockedReason: undefined,
      error: undefined,
      createdAt: Date.UTC(2026, 9, 28, 9, 1),
    },
  ],
};
const snapshot = () => Response.json(SNAPSHOT);
/** The door's answer for a link that serves nothing — unknown, withdrawn or
 * trashed (`backend/domains/chat/routes.ts`). */
const notFound = () => Response.json({ error: 'not found' }, { status: 404 });
/** The organization door's refusal of a reader outside the organization
 * (`backend/auth/org.ts`). */
const notAMember = () =>
  Response.json(
    {
      error: 'ORG_FORBIDDEN',
      message: 'Not a member of organization org-1',
    },
    { status: 403 },
  );
/** A server fault: the door answered, but with neither the share nor a
 * refusal. */
const serverError = () =>
  Response.json({ error: 'Internal Server Error' }, { status: 500 });
/** The session door's answer once the session has ended. */
const sessionEnded = () =>
  Response.json(LAPSED_SESSION_ANSWER.body, {
    status: LAPSED_SESSION_ANSWER.status,
  });

/** The view's own sentences in each shipped locale — the catalog entries it
 * must read, pinned here so a missing translation fails. */
const NOT_FOUND: Record<ShippedLocale, string> = {
  en: 'This shared chat is no longer available.',
  de: 'Dieser geteilte Chat ist nicht mehr verfügbar.',
  fr: "Ce chat partagé n'est plus disponible.",
};
const LOAD_FAILED: Record<ShippedLocale, string> = {
  en: "Couldn't load this shared chat.",
  de: 'Dieser geteilte Chat konnte nicht geladen werden.',
  fr: 'Impossible de charger ce chat partagé.',
};
const REFRESH_FAILED: Record<ShippedLocale, string> = {
  en: "Couldn't refresh this shared chat. The messages shown may be out of date.",
  de: 'Dieser geteilte Chat konnte nicht aktualisiert werden. Die angezeigten Nachrichten sind möglicherweise veraltet.',
  fr: "Impossible d'actualiser ce chat partagé. Les messages affichés peuvent être obsolètes.",
};
const TRY_AGAIN: Record<ShippedLocale, string> = {
  en: 'Try again',
  de: 'Erneut versuchen',
  fr: 'Réessayer',
};

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard/org-1/chat/shared/share-1');
  backend = syntheticBackend();
  // No backoff between the attempts; their count is react-query's default,
  // which the app's client keeps for a failure without a structured payload.
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function renderShared() {
  return render(
    <QueryClientProvider client={client}>
      <SharedChatView organizationId="org-1" shareToken="share-1" />
    </QueryClientProvider>,
  );
}

const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const sharedView = () =>
  screen.getByRole('region', {
    name: i18n.t('share.sharedChat', { ns: 'chat' }),
  });
const snapshotTitle = () =>
  screen.queryByRole('heading', { name: SNAPSHOT.title });

describe('SharedChatView when its read fails', { timeout: 30_000 }, () => {
  it('names a lost connection as a failed read with its cause and Try again, never as a withdrawn link, and recovers in place', async () => {
    backend.on(SHARED, () => {
      throw new TypeError('Failed to fetch');
    });
    const { user } = renderShared();

    const alert = await screen.findByRole('alert');
    // Four attempts, then the failure — not the withdrawn link's answer.
    expect(backend.count(SHARED)).toBe(4);
    expect(alert).toHaveTextContent(LOAD_FAILED.en);
    expect(alert).toHaveTextContent(
      i18n.t('errors.connectionLost', { ns: 'common' }),
    );
    expect(screen.queryByText(NOT_FOUND.en)).toBeNull();
    expect(snapshotTitle()).toBeNull();

    // The same mounted view recovers on Try again, with no reload.
    backend.on(SHARED, snapshot);
    await user.click(within(alert).getByRole('button', { name: tryAgain() }));
    expect(
      await screen.findByRole('heading', { name: SNAPSHOT.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(backend.count(SHARED)).toBe(5);
    // The focused Try again went with the alert: its focus lands on the
    // shared chat, not on the page.
    await waitFor(() => expect(sharedView()).toHaveFocus());
  });

  it('names a server fault (500) as a failed read, and Try again asks again', async () => {
    backend.on(SHARED, serverError);
    const { user } = renderShared();

    const alert = await screen.findByRole('alert');
    expect(backend.count(SHARED)).toBe(4);
    // A fault says nothing about itself the reader could use: the sentence
    // stands alone, beside Try again.
    expect(within(alert).getByText(LOAD_FAILED.en)).toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND.en)).toBeNull();

    // Try again asks the door again — four attempts more — and a failure
    // that stands keeps the same notice.
    const retry = within(alert).getByRole('button', { name: tryAgain() });
    await user.click(retry);
    await waitFor(() => expect(backend.count(SHARED)).toBe(8));
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
    expect(screen.getByRole('alert')).toBe(alert);
    expect(alert).toHaveTextContent(LOAD_FAILED.en);

    backend.on(SHARED, snapshot);
    await user.click(retry);
    expect(
      await screen.findByRole('heading', { name: SNAPSHOT.title }),
    ).toBeInTheDocument();
    expect(backend.count(SHARED)).toBe(9);
  });

  it('names an ended session as a failed read that says so', async () => {
    backend.on(SHARED, sessionEnded);
    renderShared();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LOAD_FAILED.en);
    expect(alert).toHaveTextContent(SESSION_ENDED.en);
    expect(
      within(alert).getByRole('button', { name: tryAgain() }),
    ).toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND.en)).toBeNull();
  });

  it('keeps a focused Try again focused, and busy, while the retry runs and fails again', async () => {
    backend.on(SHARED, () => serviceUnavailable());
    const { user } = renderShared();
    const alert = await screen.findByRole('alert');
    const retry = within(alert).getByRole('button', { name: tryAgain() });

    // Hold the retry's first attempt so the busy state can be read.
    let release: () => void = () => undefined;
    backend.on(
      SHARED,
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(serviceUnavailable());
        }),
    );
    await user.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
    // While it runs, the failure stays named: no skeleton over it, and no
    // withdrawn link.
    expect(screen.getByRole('alert')).toBe(alert);
    expect(screen.queryByText(NOT_FOUND.en)).toBeNull();
    expect(retry).toHaveFocus();

    backend.on(SHARED, () => serviceUnavailable());
    release();
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
    expect(screen.getByRole('alert')).toHaveTextContent(LOAD_FAILED.en);
    expect(retry).toHaveFocus();
  });

  it('keeps an unknown or withdrawn link (404) as no longer available, with no Try again', async () => {
    backend.on(SHARED, notFound);
    renderShared();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(NOT_FOUND.en);
    expect(alert).not.toHaveTextContent(LOAD_FAILED.en);
    expect(screen.queryByRole('button', { name: tryAgain() })).toBeNull();
    // An answer, not a failure: asked once, never again.
    expect(backend.count(SHARED)).toBe(1);
  });

  it('reads a link refused to a reader outside the organization (403) as no longer available too', async () => {
    backend.on(SHARED, notAMember);
    renderShared();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(NOT_FOUND.en);
    expect(alert).not.toHaveTextContent(LOAD_FAILED.en);
    expect(screen.queryByRole('button', { name: tryAgain() })).toBeNull();
    expect(backend.count(SHARED)).toBe(1);
  });

  it('keeps the snapshot through a failed refresh and says it may be out of date', async () => {
    backend.on(SHARED, snapshot);
    const { user } = renderShared();
    await screen.findByRole('heading', { name: SNAPSHOT.title });

    // A background refresh (a chat-thread hint, the tab regaining focus)
    // fails.
    backend.on(SHARED, () => serviceUnavailable());
    void client.invalidateQueries();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(REFRESH_FAILED.en);
    expect(alert).not.toHaveTextContent(LOAD_FAILED.en);
    expect(screen.queryByText(NOT_FOUND.en)).toBeNull();
    expect(snapshotTitle()).toBeInTheDocument();
    expect(screen.getByText(QUESTION)).toBeInTheDocument();

    // A retry that answers takes the notice away, and hands the focus on
    // Try again to the shared chat.
    backend.on(SHARED, snapshot);
    await user.click(within(alert).getByRole('button', { name: tryAgain() }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(snapshotTitle()).toBeInTheDocument();
    await waitFor(() => expect(sharedView()).toHaveFocus());
  });

  it('shows a link withdrawn while it is open as no longer available', async () => {
    backend.on(SHARED, snapshot);
    renderShared();
    await screen.findByRole('heading', { name: SNAPSHOT.title });

    backend.on(SHARED, notFound);
    void client.invalidateQueries();
    expect(await screen.findByRole('alert')).toHaveTextContent(NOT_FOUND.en);
    expect(snapshotTitle()).toBeNull();
    expect(screen.queryByRole('button', { name: tryAgain() })).toBeNull();
  });

  it('keeps the first read quiet: no failure and no withdrawn link while it runs', async () => {
    let release: () => void = () => undefined;
    backend.on(
      SHARED,
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(snapshot());
        }),
    );
    renderShared();

    await waitFor(() => expect(backend.count(SHARED)).toBe(1));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(NOT_FOUND.en)).toBeNull();
    expect(snapshotTitle()).toBeNull();

    release();
    expect(
      await screen.findByRole('heading', { name: SNAPSHOT.title }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each(SHIPPED_LOCALES)(
    'names a failed read and a failed refresh, and Try again, in the reader’s language (%s)',
    async (locale) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      backend.on(SHARED, () => serviceUnavailable());
      const { user } = renderShared();

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(LOAD_FAILED[locale]);
      expect(alert).not.toHaveTextContent(NOT_FOUND[locale]);
      backend.on(SHARED, snapshot);
      await user.click(
        within(alert).getByRole('button', { name: TRY_AGAIN[locale] }),
      );
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());

      backend.on(SHARED, () => serviceUnavailable());
      void client.invalidateQueries();
      const refresh = await screen.findByRole('alert');
      expect(refresh).toHaveTextContent(REFRESH_FAILED[locale]);
      expect(
        within(refresh).getByRole('button', { name: TRY_AGAIN[locale] }),
      ).toBeInTheDocument();

      backend.on(SHARED, notFound);
      await user.click(
        within(refresh).getByRole('button', { name: TRY_AGAIN[locale] }),
      );
      expect(await screen.findByText(NOT_FOUND[locale])).toBeInTheDocument();
    },
  );

  it('passes axe audit in its failed state', async () => {
    backend.on(SHARED, () => serviceUnavailable());
    const { container } = renderShared();
    await screen.findByRole('alert');
    await checkAccessibility(container);
  });
});
