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
    slug: string;
    title: string;
    type: string;
    fromAddress?: string;
  }>,
}));

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
    mutateAsync: vi.fn(),
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

vi.mock('@/app/hooks/use-persisted-state', () => ({
  usePersistedState: (_key: string, initial: string) => {
    return [initial, vi.fn(), vi.fn()] as const;
  },
}));

vi.mock('./contact-recipient-picker', () => ({
  ContactRecipientPicker: () => <div data-testid="recipient-picker" />,
}));

vi.mock('@tale/ui/lazy-component', () => ({
  lazyComponent: () => () => <div data-testid="message-editor" />,
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
