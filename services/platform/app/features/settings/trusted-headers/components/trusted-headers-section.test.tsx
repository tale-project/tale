import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import type { TrustedHeadersView } from '@/lib/shared/schemas/trusted_headers';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { TrustedHeadersSection } from './trusted-headers-section';

/**
 * The card's contract: the switch and ceiling write through the settings
 * mutation, a key is minted through the dialog and its plaintext shown once,
 * a revoke asks first and names the key, and a visitor without the
 * orgSettings ability sees the state without being able to move it. Rendered
 * with the real English catalog, so the copy the tests name is the copy an
 * admin reads.
 */

const { viewState, setSettingsMock, createKeyMock, revokeKeyMock, toastMock } =
  vi.hoisted(() => ({
    viewState: { current: undefined as TrustedHeadersView | undefined },
    setSettingsMock: vi.fn(),
    createKeyMock: vi.fn(),
    revokeKeyMock: vi.fn(),
    toastMock: vi.fn(),
  }));

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
  toast: toastMock,
}));

vi.mock('../hooks/use-trusted-headers', () => ({
  useTrustedHeaders: () => ({ data: viewState.current }),
  useSetTrustedHeaderSettings: () => ({
    mutate: setSettingsMock,
    mutateAsync: setSettingsMock,
    isPending: false,
  }),
  useCreateTrustedHeaderKey: () => ({
    mutate: createKeyMock,
    mutateAsync: createKeyMock,
    isPending: false,
  }),
  useRevokeTrustedHeaderKey: () => ({
    mutate: revokeKeyMock,
    mutateAsync: revokeKeyMock,
    isPending: false,
  }),
}));

const view: TrustedHeadersView = {
  enabled: true,
  maxAssertedRole: 'editor',
  keys: [
    {
      id: 'key-1',
      name: 'Portal proxy',
      tokenPrefix: 'thk_1234abcd…',
      createdAt: Date.UTC(2026, 8, 18, 9, 0, 0),
      createdBy: 'admin-1',
      lastUsedAt: null,
    },
  ],
  headers: {
    key: 'Remote-Internal-Secret',
    email: 'Remote-Email',
    name: 'Remote-Name',
    role: 'Remote-Role',
    teams: 'Remote-Teams',
  },
};

const abilities = {
  admin: defineAbilityFor('admin'),
  member: defineAbilityFor('member'),
};

function renderCard(role: 'admin' | 'member' = 'admin') {
  return render(
    <AbilityContext.Provider value={abilities[role]}>
      <TrustedHeadersSection organizationId="org-1" />
    </AbilityContext.Provider>,
  );
}

/** The section's own "Create key" action — the dialog's submit shares the label. */
function createKeyAction(): HTMLElement {
  const buttons = screen.getAllByRole('button', { name: 'Create key' });
  const action = buttons[0];
  if (action === undefined) throw new Error('no Create key action');
  return action;
}

beforeEach(() => {
  viewState.current = view;
  setSettingsMock.mockReset();
  createKeyMock.mockReset().mockResolvedValue({
    id: 'key-2',
    key: 'thk_the-plaintext-shown-once',
    tokenPrefix: 'thk_the-plai…',
  });
  revokeKeyMock.mockReset().mockResolvedValue(null);
  toastMock.mockReset();
  window.__ENV__ = { SITE_URL: 'https://tale.example.com', BASE_PATH: '' };
});

describe('TrustedHeadersSection', () => {
  it('shows the state, the door address, the header names and the keys, accessibly', async () => {
    const { container } = renderCard();

    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(
      screen.getByText(
        'https://tale.example.com/api/trusted-headers/authenticate',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Remote-Email')).toBeInTheDocument();
    expect(screen.getByText('Portal proxy')).toBeInTheDocument();
    expect(screen.getByText('thk_1234abcd…')).toBeInTheDocument();
    expect(screen.getByText('Never used')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
    // The plaintext is never part of the listing.
    expect(container.textContent).not.toContain('thk_the-plaintext');

    await checkAccessibility(container);
  });

  it('flips the switch through the settings write, keeping the ceiling', () => {
    renderCard();

    fireEvent.click(screen.getByRole('switch'));

    expect(setSettingsMock).toHaveBeenCalledWith({
      organizationId: 'org-1',
      enabled: false,
      maxAssertedRole: 'editor',
    });
  });

  it('mints a key from the dialog and shows the plaintext exactly once', async () => {
    renderCard();

    fireEvent.click(createKeyAction());
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Name/), {
      target: { value: '  Portal proxy 2 ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));

    await waitFor(() =>
      expect(createKeyMock).toHaveBeenCalledWith({
        organizationId: 'org-1',
        name: 'Portal proxy 2',
      }),
    );
    expect(
      await screen.findByText('thk_the-plaintext-shown-once'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Copy this key now/)).toBeInTheDocument();
    // The field is labelled with the header the proxy sends the key in, so
    // the person leaves with "header: value" rather than a bare secret.
    expect(within(dialog).getByText(view.headers.key)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Bearer/)).not.toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Key created' }),
    );
  });

  it('asks before revoking, naming the key, then revokes it', async () => {
    renderCard();

    fireEvent.click(
      screen.getByRole('button', { name: 'Revoke: Portal proxy' }),
    );
    expect(await screen.findByText('Revoke this key?')).toBeInTheDocument();
    expect(
      screen.getByText(/Portal proxy/, { selector: 'p, div' }),
    ).toBeTruthy();
    const confirmButtons = screen.getAllByRole('button', { name: 'Revoke' });
    const confirm = confirmButtons[confirmButtons.length - 1];
    if (confirm === undefined) throw new Error('no confirm button');
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(revokeKeyMock).toHaveBeenCalledWith({
        organizationId: 'org-1',
        keyId: 'key-1',
      }),
    );
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Key revoked' }),
    );
  });

  it('shows a member the state with every control disabled', () => {
    renderCard('member');

    expect(screen.getByRole('switch')).toBeDisabled();
    expect(createKeyAction()).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Revoke: Portal proxy' }),
    ).toBeDisabled();
  });

  it('says so when the organization holds the maximum number of keys', () => {
    const [first] = view.keys;
    if (first === undefined) throw new Error('fixture has no key');
    viewState.current = {
      ...view,
      keys: Array.from({ length: 10 }, (_, index) => ({
        ...first,
        id: `key-${index}`,
        name: `Proxy ${index}`,
      })),
    };
    renderCard();

    expect(screen.getByText(/maximum of 10 keys/)).toBeInTheDocument();
    expect(createKeyAction()).toBeDisabled();
  });
});
