// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { SendButton } from '@tale/ui/send-button';
import { act, cleanup } from '@testing-library/react';
import { useTransition } from 'react';
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
// What the editor reports when its send rejects (it keeps the body and toasts).
const editorSendFailedMock = vi.hoisted(() => vi.fn());

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
  ContactRecipientPicker: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="recipient-picker" data-disabled={disabled || undefined} />
  ),
}));

// Only the field-to-send mapping is isolated here. The real editor and upload
// failure/retry lifecycle are covered by inbox-upload-failure.browser.test.tsx.
// Its send gesture is kept as the real one: onSave runs inside the editor's
// send transition, where React holds a plain state update until the send ends.
function EditorSendGesture({
  onSave,
  disabled,
  sendDisabledReason,
}: {
  onSave: (message: string, attachments?: AttachedFile[]) => Promise<void>;
  disabled?: boolean;
  sendDisabledReason?: string;
}) {
  const [isSending, startSendingTransition] = useTransition();
  editorSaveMock.mockImplementation(onSave);
  return (
    <SendButton
      label="Send body"
      disabled={disabled}
      disabledReason={sendDisabledReason}
      sending={isSending}
      onClick={() =>
        startSendingTransition(async () => {
          try {
            await onSave('<p>Body</p>');
          } catch (error) {
            editorSendFailedMock(error);
          }
        })
      }
    />
  );
}

vi.mock('@tale/ui/lazy-component', () => ({
  lazyComponent: () => EditorSendGesture,
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
}));

const abilities = {
  admin: defineAbilityFor('admin'),
  member: defineAbilityFor('member'),
} as const;

// A send that rejects is reported by the editor; only a test that makes one
// fail on purpose may leave a report behind (it clears it once checked).
beforeEach(() => {
  editorSendFailedMock.mockClear();
});

afterEach(() => {
  expect(editorSendFailedMock).not.toHaveBeenCalled();
});

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

/**
 * The request carries the draft as it was when Send was pressed, and a success
 * clears the draft. Edits made while the send is in flight would be neither
 * sent nor kept, so the draft stays frozen until the send settles (#3898).
 */
describe('ComposeEmailPane — a send in flight', () => {
  const DRAFT = 'compose-user-1-org-1';
  const SENDING = 'Sending… The draft is locked until the send finishes.';

  beforeEach(() => {
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
    persisted.clear();
    persisted.set(`${DRAFT}-contact`, 'ct1');
    persisted.set(`${DRAFT}-mailbox`, 'cred-recruitment');
    persisted.set(`${DRAFT}-subject`, 'Quote 7');
    // Drop a held send a failed test left queued, then answer at once again.
    composeMock.mockReset();
    composeMock.mockImplementation(async () => ({
      conversationId: 'c-new',
      messageId: 'm-new',
    }));
    generateUploadUrlMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  function renderCompose(onSent = vi.fn()) {
    return render(
      <AbilityContext.Provider value={abilities.admin}>
        <ComposeEmailPane
          organizationId="org-1"
          onClose={vi.fn()}
          onSent={onSent}
        />
      </AbilityContext.Provider>,
    );
  }

  function holdSend() {
    let settle = {
      resolve: (_value: { conversationId: string; messageId: string }) => {},
      reject: (_error: Error) => {},
    };
    composeMock.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          settle = { resolve, reject };
        }),
    );
    return {
      succeed: () =>
        act(async () => {
          settle.resolve({ conversationId: 'c-new', messageId: 'm-new' });
        }),
      fail: () =>
        act(async () => {
          settle.reject(new Error('Mail server unavailable'));
        }),
    };
  }

  async function pressSend(view: ReturnType<typeof renderCompose>) {
    await view.user.click(screen.getByRole('button', { name: 'Send body' }));
    await vi.waitFor(() => expect(composeMock).toHaveBeenCalledTimes(1));
    return composeMock.mock.calls[0]?.[0];
  }

  it('keeps the draft read-only while it sends, so the success clears only what was sent', async () => {
    const onSent = vi.fn();
    const send = holdSend();
    const view = renderCompose(onSent);

    expect(await pressSend(view)).toMatchObject({ subject: 'Quote 7' });

    const subject = screen.getByRole('textbox', { name: /Subject/ });
    await view.user.type(subject, ' — newer unsent correction');
    expect(subject).toHaveValue('Quote 7');
    expect(persisted.get(`${DRAFT}-subject`)).toBe('Quote 7');
    expect(subject).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(SENDING);

    expect(screen.getByRole('textbox', { name: /From/ })).toBeDisabled();
    expect(screen.getByTestId('recipient-picker')).toHaveAttribute(
      'data-disabled',
      'true',
    );
    expect(screen.getByLabelText('Assign to')).toBeDisabled();
    expect(screen.getByLabelText(/Inbox/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
    await checkAccessibility(view.container);

    await send.succeed();

    expect(onSent).toHaveBeenCalledWith('c-new');
    expect(composeMock).toHaveBeenCalledTimes(1);
    expect(persisted.has(`${DRAFT}-subject`)).toBe(false);
    expect(persisted.has(`${DRAFT}-contact`)).toBe(false);
    expect(persisted.get(`${DRAFT}-mailbox`) ?? '').toBe('');
  });

  it('hands the draft back, editable, when the send fails', async () => {
    const onSent = vi.fn();
    const send = holdSend();
    const view = renderCompose(onSent);
    // Mounted before it speaks, so assistive tech hears the change.
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();

    await pressSend(view);
    const subject = screen.getByRole('textbox', { name: /Subject/ });
    expect(subject).toBeDisabled();
    expect(status).toHaveTextContent(SENDING);

    await send.fail();

    expect(editorSendFailedMock).toHaveBeenCalledTimes(1);
    editorSendFailedMock.mockClear();
    expect(onSent).not.toHaveBeenCalled();
    expect(subject).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeEnabled();
    expect(status).toBeEmptyDOMElement();
    expect(persisted.get(`${DRAFT}-subject`)).toBe('Quote 7');
    expect(persisted.get(`${DRAFT}-contact`)).toBe('ct1');
    await view.user.type(subject, ' (revised)');
    expect(persisted.get(`${DRAFT}-subject`)).toBe('Quote 7 (revised)');
  });

  it('freezes the draft from the first upload on', async () => {
    let failUpload = (_error: Error) => {};
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((_resolve, reject) => {
          failUpload = reject;
        }),
    );
    const view = renderCompose();

    let sent: Promise<void> = Promise.resolve();
    act(() => {
      sent = editorSaveMock('<p>Body</p>', [
        {
          id: 'attachment-1',
          file: new File(['draft'], 'draft.txt', { type: 'text/plain' }),
          type: 'document',
        },
      ]);
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const subject = screen.getByRole('textbox', { name: /Subject/ });
    expect(subject).toBeDisabled();
    await view.user.type(subject, ' — newer unsent correction');
    expect(persisted.get(`${DRAFT}-subject`)).toBe('Quote 7');

    await act(async () => {
      failUpload(new Error('Upload refused'));
      await expect(sent).rejects.toThrow('Upload refused');
    });

    expect(composeMock).not.toHaveBeenCalled();
    expect(subject).toBeEnabled();
    expect(persisted.get(`${DRAFT}-subject`)).toBe('Quote 7');
  });

  it('clears the sent draft and opens the conversation after a plain send', async () => {
    const onSent = vi.fn();
    const view = renderCompose(onSent);

    expect(await pressSend(view)).toMatchObject({
      contactId: 'ct1',
      credentialId: 'cred-recruitment',
      subject: 'Quote 7',
    });

    await vi.waitFor(() => expect(onSent).toHaveBeenCalledWith('c-new'));
    expect(persisted.has(`${DRAFT}-subject`)).toBe(false);
    expect(persisted.has(`${DRAFT}-contact`)).toBe(false);
    expect(persisted.get(`${DRAFT}-mailbox`) ?? '').toBe('');
  });
});
