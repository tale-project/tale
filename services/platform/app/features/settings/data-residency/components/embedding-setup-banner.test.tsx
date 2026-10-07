// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// The banner reports a broken knowledge base, so it must be a polite `status`
// live region like its dashboard siblings — an assertive `alert` would
// interrupt screen-reader users on every page of the shell.

const { mockState, useOrgKnowledgeEmbedding, useProviderCredentials } =
  vi.hoisted(() => ({
    mockState: {
      canRead: true,
      abilityLoading: false,
      embedding: undefined as unknown,
      embeddingError: false,
      credentials: undefined as unknown,
    },
    useOrgKnowledgeEmbedding: vi.fn(),
    useProviderCredentials: vi.fn(),
  }));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => mockState.canRead,
    cannot: () => !mockState.canRead,
  }),
  useAbilityLoading: () => mockState.abilityLoading,
}));

vi.mock('../hooks/queries', () => ({ useOrgKnowledgeEmbedding }));

vi.mock('@/app/features/settings/providers/hooks/queries', () => ({
  useProviderCredentials,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import { EmbeddingSetupBanner } from './embedding-setup-banner';

/** The state the banner exists for: a provider is stored, no model is set. */
function readyToNudge() {
  mockState.canRead = true;
  mockState.abilityLoading = false;
  mockState.embedding = { configured: false };
  mockState.embeddingError = false;
  mockState.credentials = [{ id: 'cred-1' }];
}

beforeEach(() => {
  vi.clearAllMocks();
  useOrgKnowledgeEmbedding.mockImplementation(() => ({
    data: mockState.embedding,
    isError: mockState.embeddingError,
  }));
  useProviderCredentials.mockImplementation(() => ({
    data: mockState.credentials,
  }));
});

describe('EmbeddingSetupBanner', () => {
  it('points a provider-configured org at the embedding model it still needs', async () => {
    readyToNudge();

    render(<EmbeddingSetupBanner organizationId="org-1" />);

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('Knowledge search is off');
    const link = screen.getByRole('link', {
      name: 'Choose an embedding model',
    });
    expect(link).toHaveAttribute(
      'href',
      '/dashboard/$id/settings/data-residency',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('goes away once a model is configured', () => {
    readyToNudge();
    mockState.embedding = { configured: true };

    render(<EmbeddingSetupBanner organizationId="org-1" />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stays quiet before a provider exists', () => {
    readyToNudge();
    // Nothing to choose a model with yet, and the setup wizard is already
    // asking for a provider — a second nudge here is noise on an empty org.
    mockState.credentials = [];

    render(<EmbeddingSetupBanner organizationId="org-1" />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  // E-05: both reads are admin doors; a member mounting the shell used to
  // fire two 403s on every dashboard page before the ability gate ran.
  it('stays quiet for a reader who cannot open the settings page, without asking the server', () => {
    readyToNudge();
    mockState.canRead = false;

    render(<EmbeddingSetupBanner organizationId="org-1" />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(useOrgKnowledgeEmbedding).not.toHaveBeenCalled();
    expect(useProviderCredentials).not.toHaveBeenCalled();
  });

  it('says nothing while the state is still unknown', () => {
    readyToNudge();
    // Loading, then failed: neither is evidence of a missing model, and
    // "knowledge search is off" on an unknown state is worse than silence.
    mockState.embedding = undefined;
    render(<EmbeddingSetupBanner organizationId="org-1" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    mockState.embedding = { configured: false };
    mockState.embeddingError = true;
    render(<EmbeddingSetupBanner organizationId="org-2" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('waits for the ability to resolve before deciding — or reading', () => {
    readyToNudge();
    mockState.abilityLoading = true;

    render(<EmbeddingSetupBanner organizationId="org-1" />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(useOrgKnowledgeEmbedding).not.toHaveBeenCalled();
    expect(useProviderCredentials).not.toHaveBeenCalled();
  });
});
