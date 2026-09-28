// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

const { mockNavigate, mockToast } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mockNavigate,
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast }),
}));

import { ShareChatDialog } from './share-chat-dialog';

const ORG = 'org-1';
const THREAD = 'thread-1';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The three share routes over one stored row, answered the way the backend
 * answers them — so a share or a revocation is read back by the status
 * refetch it triggers, exactly as in the app. `statusFails` makes every
 * status read a 503 (every retry included) until it is cleared.
 */
function fakeShareBackend(initial: {
  isShared: boolean;
  shareToken: string | null;
}) {
  const row = { ...initial };
  const control = {
    statusFails: false,
    statusHangs: false,
    unshareRefused: false,
    shareRefused: false,
  };
  const requests: string[] = [];
  const fetchSpy = vi
    .spyOn(window, 'fetch')
    .mockImplementation(async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        'http://localhost',
      );
      const method = init?.method ?? 'GET';
      requests.push(`${method} ${url.pathname}`);
      const threadPath = `/api/app/chat/threads/${THREAD}`;
      if (url.pathname.endsWith(`${threadPath}/share-status`)) {
        if (control.statusHangs) return new Promise<Response>(() => {});
        if (control.statusFails) {
          return json(503, { error: 'service unavailable' });
        }
        return json(200, {
          isShared: row.isShared,
          shareToken: row.shareToken,
          sharedAt: row.isShared ? 1_717_000_000_000 : null,
          isShareable: true,
        });
      }
      if (method === 'POST' && url.pathname.endsWith(`${threadPath}/unshare`)) {
        if (control.unshareRefused) return json(200, { ok: false });
        row.isShared = false;
        return json(200, { ok: true });
      }
      if (method === 'POST' && url.pathname.endsWith(`${threadPath}/share`)) {
        if (control.shareRefused) {
          return json(404, { error: 'thread not found' });
        }
        row.isShared = true;
        row.shareToken ??= 'tok-new';
        return json(200, { shareToken: row.shareToken });
      }
      return json(404, { error: `unstubbed ${method} ${url.pathname}` });
    });
  const statusReads = () =>
    requests.filter((r) => r.startsWith('GET ') && r.endsWith('/share-status'))
      .length;
  const writes = () => requests.filter((r) => r.startsWith('POST '));
  return { row, control, requests, statusReads, writes, fetchSpy };
}

function renderDialog() {
  // The app's read policy retries a transport or server fault three times
  // before the read settles as failed; no backoff here.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 3, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ShareChatDialog
        open
        onOpenChange={() => {}}
        organizationId={ORG}
        threadId={THREAD}
        viewThreadId={THREAD}
      />
    </QueryClientProvider>,
  );
}

const keepPrivate = () => screen.getByRole('radio', { name: /Keep private/ });
/** The copy control is named by the URL it shows and copies. */
const copyLinkButton = () =>
  screen.queryByRole('button', { name: /\/chat\/shared\// });
const organizationLink = () =>
  screen.getByRole('radio', { name: /Share with organization/ });

/**
 * A physical key press: Radix moves the roving focus — and with it the
 * check — in a task after keydown, while the key is still down.
 */
async function press(user: UserEvent, key: string) {
  await user.keyboard(`{${key}>}`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await user.keyboard(`{/${key}}`);
}

let savedEnv: typeof window.__ENV__;

beforeEach(() => {
  savedEnv = window.__ENV__;
  window.__ENV__ = { SITE_URL: 'http://localhost:3000', BASE_PATH: '' };
  mockToast.mockClear();
  mockNavigate.mockClear();
});

afterEach(() => {
  window.__ENV__ = savedEnv;
  vi.restoreAllMocks();
});

describe('ShareChatDialog — the sharing status it reads', () => {
  it('claims neither option while the status loads', async () => {
    const backend = fakeShareBackend({ isShared: true, shareToken: 'tok-1' });
    backend.control.statusHangs = true;
    renderDialog();

    await waitFor(() => expect(backend.statusReads()).toBe(1));
    // Masked in place: the radios leave the accessibility tree, unchecked,
    // and the region announces the load once.
    const radios = screen.getAllByRole('radio', { hidden: true });
    expect(radios).toHaveLength(2);
    for (const radio of radios) expect(radio).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(copyLinkButton()).not.toBeInTheDocument();
  });

  it('reads a failed status as unknown: nothing checked, nothing revocable, Try again recovers', async () => {
    // #3717: the chat IS shared; only the status read fails, on every retry.
    const backend = fakeShareBackend({ isShared: true, shareToken: 'tok-1' });
    backend.control.statusFails = true;
    const { user } = renderDialog();

    // Let every retry settle before judging what the dialog claims.
    await waitFor(() => expect(backend.statusReads()).toBe(4));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Privacy is not asserted, and no choice is offered against the unknown.
    expect(keepPrivate()).not.toBeChecked();
    expect(organizationLink()).not.toBeChecked();
    expect(keepPrivate()).toBeDisabled();
    expect(organizationLink()).toBeDisabled();
    expect(copyLinkButton()).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Create share link' }),
    ).not.toBeInTheDocument();
    await user.click(keepPrivate());
    expect(backend.writes()).toEqual([]);
    expect(backend.row.isShared).toBe(true);

    // The failure is visible, says what is at stake, and offers the way out.
    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent("Couldn't load the sharing status");
    expect(notice).toHaveTextContent(
      'This chat may still be shared with your organization.',
    );
    expect(backend.statusReads()).toBe(4);

    // Recovery: the next read answers, and the real state is on screen.
    backend.control.statusFails = false;
    await user.click(within(notice).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(organizationLink()).toBeChecked());
    expect(keepPrivate()).not.toBeChecked();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(copyLinkButton()).toHaveTextContent(
      'http://localhost:3000/dashboard/org-1/chat/shared/tok-1',
    );

    // …and a revocation is now a real one.
    await user.click(keepPrivate());
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({ title: 'Sharing stopped' }),
    );
    expect(backend.writes()).toEqual([
      `POST /api/app/chat/threads/${THREAD}/unshare`,
    ]);
    expect(backend.row.isShared).toBe(false);
    expect(keepPrivate()).toBeChecked();
  });

  it('passes the accessibility audit in the unknown state', async () => {
    const backend = fakeShareBackend({ isShared: true, shareToken: 'tok-1' });
    backend.control.statusFails = true;
    const { baseElement } = renderDialog();
    await screen.findByRole('alert');
    await checkAccessibility(baseElement);
  });
});

describe('ShareChatDialog — sharing and revoking', () => {
  it('creates a link, and offers Try again when the share is refused', async () => {
    const backend = fakeShareBackend({ isShared: false, shareToken: null });
    backend.control.shareRefused = true;
    const { user } = renderDialog();

    await waitFor(() => expect(keepPrivate()).toBeChecked());
    await user.click(organizationLink());
    expect(organizationLink()).toBeChecked();
    expect(backend.writes()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Create share link' }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Couldn't share chat",
        variant: 'destructive',
      }),
    );
    expect(organizationLink()).toBeChecked();
    expect(backend.row.isShared).toBe(false);

    backend.control.shareRefused = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(copyLinkButton()).toBeInTheDocument());
    expect(copyLinkButton()).toHaveTextContent(
      'http://localhost:3000/dashboard/org-1/chat/shared/tok-new',
    );
    expect(organizationLink()).toBeChecked();
    expect(
      screen.queryByRole('button', { name: 'Create share link' }),
    ).not.toBeInTheDocument();
    expect(backend.row.isShared).toBe(true);
  });

  it('keeps the organization link checked when a revocation is refused', async () => {
    const backend = fakeShareBackend({ isShared: true, shareToken: 'tok-1' });
    backend.control.unshareRefused = true;
    const { user } = renderDialog();

    await waitFor(() => expect(organizationLink()).toBeChecked());
    await user.click(keepPrivate());
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Couldn't stop sharing",
        variant: 'destructive',
      }),
    );
    expect(organizationLink()).toBeChecked();
    expect(keepPrivate()).not.toBeChecked();
    expect(backend.row.isShared).toBe(true);
    expect(copyLinkButton()).toBeVisible();
  });
});

describe('ShareChatDialog — the copied link (#3718)', () => {
  it.each([
    {
      deployment: 'a root deployment',
      env: { SITE_URL: 'http://localhost:3000', BASE_PATH: '' },
      statusPath: `/api/app/chat/threads/${THREAD}/share-status`,
      link: 'http://localhost:3000/dashboard/org-1/chat/shared/tok-1',
    },
    {
      deployment: 'a subpath deployment',
      env: { SITE_URL: 'http://localhost:3000', BASE_PATH: '/audit-prefix' },
      statusPath: `/audit-prefix/api/app/chat/threads/${THREAD}/share-status`,
      link: 'http://localhost:3000/audit-prefix/dashboard/org-1/chat/shared/tok-1',
    },
    {
      deployment: 'a SITE_URL written with a trailing slash',
      env: { SITE_URL: 'http://localhost:3000/', BASE_PATH: '/audit-prefix' },
      statusPath: `/audit-prefix/api/app/chat/threads/${THREAD}/share-status`,
      link: 'http://localhost:3000/audit-prefix/dashboard/org-1/chat/shared/tok-1',
    },
  ])(
    'copies the snapshot URL on $deployment',
    async ({ env, statusPath, link }) => {
      window.__ENV__ = env;
      const backend = fakeShareBackend({ isShared: true, shareToken: 'tok-1' });
      const { user } = renderDialog();

      await waitFor(() => expect(copyLinkButton()).toBeInTheDocument());
      const copy = copyLinkButton()!;
      expect(backend.requests).toContain(`GET ${statusPath}`);
      expect(copy).toHaveTextContent(link);
      await user.click(copy);
      await expect(navigator.clipboard.readText()).resolves.toBe(link);
    },
  );
});

describe('ShareChatDialog — the access picker from the keyboard (#3719)', () => {
  it('is one tab stop whose arrow keys move the choice', async () => {
    const backend = fakeShareBackend({ isShared: false, shareToken: null });
    const { user } = renderDialog();
    await waitFor(() => expect(keepPrivate()).toBeChecked());

    // Tab enters the group on its checked option…
    screen.getByRole('button', { name: 'Close' }).focus();
    await user.tab();
    expect(keepPrivate()).toHaveFocus();

    // …an arrow moves focus AND the choice, both directions…
    await press(user, 'ArrowDown');
    expect(organizationLink()).toHaveFocus();
    expect(organizationLink()).toBeChecked();
    await press(user, 'ArrowUp');
    expect(keepPrivate()).toHaveFocus();
    expect(keepPrivate()).toBeChecked();
    await press(user, 'ArrowRight');
    expect(organizationLink()).toBeChecked();
    await press(user, 'ArrowLeft');
    expect(keepPrivate()).toBeChecked();

    // …and the next Tab leaves the group instead of visiting the sibling.
    await press(user, 'ArrowDown');
    await user.tab();
    expect(
      screen.getByRole('button', { name: 'Create share link' }),
    ).toHaveFocus();
    await user.tab({ shift: true });
    expect(organizationLink()).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(backend.writes()).toEqual([]);
  });

  it('revokes from the keyboard and keeps focus through the pending and refused states', async () => {
    const backend = fakeShareBackend({ isShared: true, shareToken: 'tok-1' });
    backend.control.unshareRefused = true;
    const { user } = renderDialog();
    await waitFor(() => expect(organizationLink()).toBeChecked());

    screen.getByRole('button', { name: 'Close' }).focus();
    await user.tab();
    expect(organizationLink()).toHaveFocus();

    // A refused revocation: the check returns to the live link, focus stays
    // on the option the reader acted on.
    await press(user, 'ArrowUp');
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Couldn't stop sharing",
        variant: 'destructive',
      }),
    );
    expect(organizationLink()).toBeChecked();
    expect(keepPrivate()).toHaveFocus();

    // Space on the focused option tries again, and this time it lands.
    backend.control.unshareRefused = false;
    await user.keyboard(' ');
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({ title: 'Sharing stopped' }),
    );
    expect(keepPrivate()).toBeChecked();
    expect(keepPrivate()).toHaveFocus();
    expect(backend.row.isShared).toBe(false);
  });
});
