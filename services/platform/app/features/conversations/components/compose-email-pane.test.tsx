// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ComposeEmailPane } from './compose-email-pane';

const emailConnectorsMock = vi.hoisted(() => ({
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

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('../hooks/queries', () => ({
  useEmailConnectors: () => ({
    emailConnectors: emailConnectorsMock.current,
    isLoading: false,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useComposeEmailConversation: () => ({
    mutateAsync: composeMock,
    isPending: false,
  }),
  useGenerateUploadUrl: () => ({ mutateAsync: vi.fn() }),
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

// The body editor, reduced to its send gesture.
vi.mock('@tale/ui/lazy-component', () => ({
  lazyComponent:
    () =>
    ({
      onSave,
      disabled,
    }: {
      onSave: (message: string) => Promise<void>;
      disabled?: boolean;
    }) => (
      <button
        type="button"
        disabled={disabled}
        onClick={() => void onSave('<p>Body</p>')}
      >
        Send body
      </button>
    ),
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
    persisted.clear();
    navigateMock.mockReset();
  });

  afterEach(() => {
    cleanup();
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
    persisted.clear();
    persisted.set(`${DRAFT}-contact`, 'ct1');
    persisted.set(`${DRAFT}-subject`, 'Quote 7');
    composeMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  async function send() {
    const button = screen.getByRole('button', { name: 'Send body' });
    expect(button).toBeEnabled();
    button.click();
    await vi.waitFor(() => expect(composeMock).toHaveBeenCalledTimes(1));
    return composeMock.mock.calls[0]?.[0];
  }

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
