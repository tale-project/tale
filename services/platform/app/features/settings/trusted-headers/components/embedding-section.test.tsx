import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import {
  EmbeddingSection,
  embeddingConfigFrom,
  parseOriginLines,
} from './embedding-section';

/**
 * The embedding card: the switch saves the policy at once, the origin list
 * saves only once every line is an admissible origin, and a member sees the
 * state without being able to move it. Rendered with the real English
 * catalog.
 */

const { policyState, saveMock, toastMock } = vi.hoisted(() => ({
  policyState: { current: null as null | { config: unknown } },
  saveMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
  toast: toastMock,
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useGovernancePolicy: () => ({ data: policyState.current, isLoading: false }),
}));

vi.mock('@/app/features/settings/governance/hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({
    mutate: saveMock,
    mutateAsync: saveMock,
    isPending: false,
  }),
}));

const abilities = {
  admin: defineAbilityFor('admin'),
  member: defineAbilityFor('member'),
};

function renderCard(role: 'admin' | 'member' = 'admin') {
  return render(
    <AbilityContext.Provider value={abilities[role]}>
      <EmbeddingSection organizationId="org-1" />
    </AbilityContext.Provider>,
  );
}

beforeEach(() => {
  policyState.current = {
    config: { enabled: true, frameAncestors: ['https://portal.example'] },
  };
  saveMock.mockReset().mockResolvedValue(null);
  toastMock.mockReset();
});

describe('embeddingConfigFrom / parseOriginLines', () => {
  it('reads the closed default for a missing or malformed policy', () => {
    expect(embeddingConfigFrom(null)).toEqual({
      enabled: false,
      frameAncestors: [],
    });
    expect(embeddingConfigFrom({ enabled: 'yes' })).toEqual({
      enabled: false,
      frameAncestors: [],
    });
  });

  it('trims, drops blanks and deduplicates the typed lines', () => {
    expect(
      parseOriginLines(
        ' https://a.example \n\nhttps://b.example\r\nhttps://a.example\n',
      ),
    ).toEqual(['https://a.example', 'https://b.example']);
  });
});

describe('EmbeddingSection', () => {
  it('shows the stored state and origins, accessibly', async () => {
    const { container } = renderCard();

    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
    expect(
      screen.getByRole('textbox', { name: 'Allowed origins' }),
    ).toHaveValue('https://portal.example');
    expect(screen.getByRole('button', { name: 'Save origins' })).toBeDisabled();

    await checkAccessibility(container);
  });

  it('flips the switch through the policy write, keeping the origins', async () => {
    renderCard();

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith({
        organizationId: 'org-1',
        policyType: 'embedding',
        config: { enabled: false, frameAncestors: ['https://portal.example'] },
      }),
    );
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Embedding settings saved' }),
    );
  });

  it('refuses to save a line that is not an admissible origin', () => {
    renderCard();

    fireEvent.change(screen.getByRole('textbox', { name: 'Allowed origins' }), {
      target: { value: 'https://portal.example\nnot an origin' },
    });

    expect(screen.getByText(/Enter https origins only/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save origins' })).toBeDisabled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('saves a valid, deduplicated origin list', async () => {
    renderCard();

    fireEvent.change(screen.getByRole('textbox', { name: 'Allowed origins' }), {
      target: {
        value:
          'https://portal.example\n https://app.example \nhttps://app.example',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save origins' }));

    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith({
        organizationId: 'org-1',
        policyType: 'embedding',
        config: {
          enabled: true,
          frameAncestors: ['https://portal.example', 'https://app.example'],
        },
      }),
    );
  });

  it('shows a member the state with every control disabled', () => {
    renderCard('member');

    expect(screen.getByRole('switch')).toBeDisabled();
    expect(
      screen.getByRole('textbox', { name: 'Allowed origins' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save origins' })).toBeDisabled();
  });
});
