// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { SendButton } from '@tale/ui/send-button';
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ComposeEmailPane } from './compose-email-pane';
import type { AttachedFile } from './message-editor/types';

const emailConnectorsMock = vi.hoisted(() => ({
  error: undefined as unknown,
  retry: vi.fn(async () => undefined),
  current: [] as Array<{
    credentialId: string;
    slug: string;
    title: string;
    type: string;
    fromAddress?: string;
  }>,
}));

// The draft fields, as `usePersistedState` would hold them across mounts.
const persisted = vi.hoisted(() => new Map<string, string>());
const composeMock = vi.hoisted(() =>
  vi.fn(async (_args: Record<string, unknown>) => ({
    conversationId: 'c-new',
    messageId: 'm-new',
  })),
);

const navigateMock = vi.hoisted(() => vi.fn());
const editorSaveMock = vi.hoisted(() =>
  vi.fn(async (_message: string, _attachments?: AttachedFile[]) => {}),
);

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('../hooks/queries', () => ({
  useEmailConnectors: () => ({
    emailConnectors: emailConnectorsMock.current,
    isLoading: false,
    error: emailConnectorsMock.error,
    retry: emailConnectorsMock.retry,
  }),
}));

const generateUploadUrlMock = vi.hoisted(() =>
  vi.fn(async (_args: Record<string, unknown>) => '/api/app/files/upload'),
);

vi.mock('../hooks/mutations', () => ({
  useComposeEmailConversation: () => ({
    mutateAsync: composeMock,
    isPending: false,
  }),
  useGenerateUploadUrl: () => ({ mutateAsync: generateUploadUrlMock }),
}));

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({ members: [] }),
}));

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({ teams: [] }),
}));

vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({
    data: { role: 'admin' },
  }),
}));

vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ user: { userId: 'user-1' } }),
}));

vi.mock('@/app/hooks/use-persisted-state', async () => {
  const { useCallback, useState } = await import('react');
  return {
    usePersistedState: (key: string, initial: string) => {
      const [value, setValue] = useState(() => persisted.get(key) ?? initial);
      const set = useCallback(
        (next: string) => {
          persisted.set(key, next);
          setValue(next);
        },
        [key],
      );
      const clear = useCallback(() => {
        persisted.delete(key);
        setValue(initial);
      }, [key, initial]);
      return [value, set, clear] as const;
    },
  };
});

vi.mock('./contact-recipient-picker', () => ({
  ContactRecipientPicker: () => <div data-testid="recipient-picker" />,
}));

// Only the field-to-send mapping is isolated here. The real editor and upload
// failure/retry lifecycle are covered by inbox-upload-failure.browser.test.tsx.
vi.mock('@tale/ui/lazy-component', () => ({
  lazyComponent:
    () =>
    ({
      onSave,
      disabled,
      sendDisabledReason,
    }: {
      onSave: (message: string, attachments?: AttachedFile[]) => Promise<void>;
      disabled?: boolean;
      sendDisabledReason?: string;
    }) => {
      editorSaveMock.mockImplementation(onSave);
      return (
        <SendButton
          label="Send body"
          disabled={disabled}
          disabledReason={sendDisabledReason}
          onClick={() => void onSave('<p>Body</p>')}
        />
      );
    },
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
}));

const abilities = {
  admin: defineAbilityFor('admin'),
  member: defineAbilityFor('member'),
} as const;

function renderPane(role: keyof typeof abilities) {
  return render(
    <AbilityContext.Provider value={abilities[role]}>
      <ComposeEmailPane
        organizationId="org-1"
        onClose={vi.fn()}
        onSent={vi.fn()}
      />
    </AbilityContext.Provider>,
  );
}

describe('ComposeEmailPane — missing email connector', () => {
  beforeEach(() => {
    emailConnectorsMock.current = [];
    emailConnectorsMock.error = undefined;
    emailConnectorsMock.retry.mockClear();
    persisted.clear();
    navigateMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('preserves the draft when reading email connections fails', async () => {
    const draft = 'compose-user-1-org-1';
    persisted.set(`${draft}-mailbox`, 'cred-recruitment');
    persisted.set(`${draft}-sender`, 'billing@support.test');
    emailConnectorsMock.error = new Error('temporary failure');

    const view = renderPane('admin');

    expect(
      screen.getByRole('heading', { name: 'Email connection unavailable' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: "Can't send yet" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send body' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(persisted.get(`${draft}-mailbox`)).toBe('cred-recruitment');
    expect(persisted.get(`${draft}-sender`)).toBe('billing@support.test');
    expect(composeMock).not.toHaveBeenCalled();

    screen.getByRole('button', { name: 'Try again' }).click();
    expect(emailConnectorsMock.retry).toHaveBeenCalledTimes(1);

    emailConnectorsMock.error = undefined;
    emailConnectorsMock.current = [
      {
        credentialId: 'cred-general',
        slug: 'imap-smtp',
        title: 'General Support',
        type: 'imap_smtp',
        fromAddress: 'hello@support.test',
      },
      {
        credentialId: 'cred-recruitment',
        slug: 'imap-smtp',
        title: 'Recruitment Support',
        type: 'imap_smtp',
        fromAddress: 'jobs@support.test',
      },
    ];
    view.rerender(
      <AbilityContext.Provider value={abilities.admin}>
        <ComposeEmailPane
          organizationId="org-1"
          onClose={vi.fn()}
          onSent={vi.fn()}
        />
      </AbilityContext.Provider>,
    );
    expect(persisted.get(`${draft}-mailbox`)).toBe('cred-recruitment');
    expect(persisted.get(`${draft}-sender`)).toBe('billing@support.test');
  });

  it('shows a warning banner instead of a muted label', async () => {
    renderPane('admin');

    expect(
      screen.getByRole('heading', { name: "Can't send yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Connect an email inbox under Settings > Connectors/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open connector settings' }),
    ).toBeInTheDocument();
  });

  it('tells non-admins to ask an admin, without the settings CTA', () => {
    renderPane('member');

    expect(
      screen.getByRole('heading', { name: "Can't send yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ask an organization admin to connect an email inbox/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open connector settings' }),
    ).not.toBeInTheDocument();
  });

  it('passes axe with the warning banner shown', async () => {
    const { container } = renderPane('admin');
    await checkAccessibility(container);
  });
});

/**
 * One connector can hold several mailboxes. Compose sends from the one the
 * draft names, by credential; keyed by connector it sent from the default.
 */
describe('ComposeEmailPane — the mailbox', () => {
  const DRAFT = 'compose-user-1-org-1';
  const GENERAL = {
    credentialId: 'cred-general',
    slug: 'imap-smtp',
    title: 'General Support',
    type: 'imap_smtp',
    fromAddress: 'hello@support.test',
  };
  const RECRUITMENT = {
    credentialId: 'cred-recruitment',
    slug: 'imap-smtp',
    title: 'Recruitment Support',
    type: 'imap_smtp',
    fromAddress: 'jobs@support.test',
  };
  const GMAIL = {
    credentialId: 'cred-gmail',
    slug: 'gmail',
    title: 'Sales inbox',
    type: 'oauth',
  };

  beforeEach(() => {
    emailConnectorsMock.error = undefined;
    persisted.clear();
    persisted.set(`${DRAFT}-contact`, 'ct1');
    persisted.set(`${DRAFT}-subject`, 'Quote 7');
    composeMock.mockClear();
    generateUploadUrlMock.mockClear();
    editorSaveMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  async function send() {
    const button = screen.getByRole('button', { name: 'Send body' });
    expect(button).toBeEnabled();
    button.click();
    await vi.waitFor(() => expect(composeMock).toHaveBeenCalledTimes(1));
    return composeMock.mock.calls[0]?.[0];
  }

  function refetchFails(view: ReturnType<typeof renderPane>) {
    emailConnectorsMock.error = new Error('temporary failure');
    view.rerender(
      <AbilityContext.Provider value={abilities.admin}>
        <ComposeEmailPane
          organizationId="org-1"
          onClose={vi.fn()}
          onSent={vi.fn()}
        />
      </AbilityContext.Provider>,
    );
  }

  it('blocks Send after a failed refetch with populated mailbox data and announces why', async () => {
    emailConnectorsMock.current = [GENERAL, RECRUITMENT];
    persisted.set(`${DRAFT}-mailbox`, 'cred-recruitment');
    persisted.set(`${DRAFT}-sender`, 'billing@support.test');
    const view = renderPane('admin');
    expect(
      screen.getByRole('button', { name: 'Send body' }),
    ).not.toHaveAttribute('aria-disabled', 'true');

    refetchFails(view);

    const button = screen.getByRole('button', { name: 'Send body' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't load your email connections. Your draft is safe; try again.",
    );
    expect(
      screen.queryByText('Choose a contact, an inbox, and a subject to send.'),
    ).not.toBeInTheDocument();
    await view.user.click(button);
    await vi.waitFor(() =>
      expect(button).toHaveAccessibleDescription(
        "We couldn't load your email connections. Your draft is safe; try again.",
      ),
    );
    await view.user.keyboard('{Enter} ');
    expect(composeMock).not.toHaveBeenCalled();
    expect(generateUploadUrlMock).not.toHaveBeenCalled();
    expect(persisted.get(`${DRAFT}-mailbox`)).toBe('cred-recruitment');
    expect(persisted.get(`${DRAFT}-sender`)).toBe('billing@support.test');
    await checkAccessibility(view.container);

    emailConnectorsMock.error = undefined;
    view.rerender(
      <AbilityContext.Provider value={abilities.admin}>
        <ComposeEmailPane
          organizationId="org-1"
          onClose={vi.fn()}
          onSent={vi.fn()}
        />
      </AbilityContext.Provider>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await send()).toMatchObject({
      credentialId: 'cred-recruitment',
      from: 'billing@support.test',
    });
  });

  it.each([false, true])(
    'refuses the send handler after a failed refetch even if the control is bypassed (attachments: %s)',
    async (withAttachment) => {
      emailConnectorsMock.current = [GENERAL, RECRUITMENT];
      persisted.set(`${DRAFT}-mailbox`, 'cred-recruitment');
      persisted.set(`${DRAFT}-sender`, 'billing@support.test');
      const view = renderPane('admin');

      refetchFails(view);
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ storageId: 'blob-1' })),
        );

      await act(async () => {
        await expect(
          editorSaveMock(
            '<p>Body</p>',
            withAttachment
              ? [
                  {
                    id: 'attachment-1',
                    file: new File(['draft'], 'draft.txt', {
                      type: 'text/plain',
                    }),
                    type: 'document',
                  },
                ]
              : undefined,
          ),
        ).rejects.toThrow(
          "We couldn't load your email connections. Your draft is safe; try again.",
        );
      });
      expect(composeMock).not.toHaveBeenCalled();
      expect(generateUploadUrlMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(persisted.get(`${DRAFT}-mailbox`)).toBe('cred-recruitment');
      expect(persisted.get(`${DRAFT}-sender`)).toBe('billing@support.test');
      expect(persisted.get(`${DRAFT}-contact`)).toBe('ct1');
      expect(persisted.get(`${DRAFT}-subject`)).toBe('Quote 7');
    },
  );

  it('sends from the chosen mailbox, by its credential', async () => {
    emailConnectorsMock.current = [GENERAL, RECRUITMENT];
    persisted.set(`${DRAFT}-mailbox`, 'cred-recruitment');
    renderPane('admin');

    expect(await send()).toMatchObject({
      connectorName: 'imap-smtp',
      credentialId: 'cred-recruitment',
      from: 'jobs@support.test',
    });
  });

  it("resumes a draft that stored a connector on that connector's only mailbox", async () => {
    emailConnectorsMock.current = [GENERAL, RECRUITMENT, GMAIL];
    persisted.set(`${DRAFT}-inbox`, 'gmail');
    renderPane('admin');

    expect(await send()).toMatchObject({
      connectorName: 'gmail',
      credentialId: 'cred-gmail',
    });
    expect(persisted.has(`${DRAFT}-inbox`)).toBe(false);
  });

  it('drops the sender a vanished mailbox left behind', async () => {
    emailConnectorsMock.current = [GENERAL];
    persisted.set(`${DRAFT}-mailbox`, 'cred-removed');
    persisted.set(`${DRAFT}-sender`, 'billing@support.test');
    renderPane('admin');

    expect(await send()).toMatchObject({
      credentialId: 'cred-general',
      from: 'hello@support.test',
    });
  });
});
