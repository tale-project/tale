import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { MessageMetadata } from '../hooks/queries';
import { MessageInfoDialog } from './message-info-dialog';

// Migrated from the `chat-features` E2E "message info dialog surfaces the seeded
// model name": the dialog renders `metadata.model` directly from its props (the
// E2E only gated the model assertion behind mock-LLM mode because in live mode
// the id is provider-dependent — i.e. it was always asserting prop-driven
// render, not a backend round-trip). The only query it makes (voice usage) is
// mocked away; everything else is pure render, so this belongs at the component
// tier.
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: undefined, isLoading: false }),
}));

// ViewDialog (the dialog shell) reads the org id from the router for its error
// boundary; outside a RouterProvider that hook throws, so stub it like the
// other dialog component tests do.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const metadata = {
  model: 'e2e-chat-model',
  provider: 'mock-provider',
} as MessageMetadata;

describe('MessageInfoDialog', () => {
  it('surfaces the model id from metadata when open', async () => {
    const { container } = render(
      <MessageInfoDialog
        isOpen={true}
        onOpenChange={vi.fn()}
        messageId="msg-abc123"
        timestamp={new Date('2026-01-01T00:00:00Z')}
        metadata={metadata}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Message information')).toBeInTheDocument();
    // The "Model" field renders the metadata model id in a badge.
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('e2e-chat-model')).toBeInTheDocument();

    await checkAccessibility(container);
  });

  it('renders the no-metadata fallback when metadata is absent', () => {
    render(
      <MessageInfoDialog
        isOpen={true}
        onOpenChange={vi.fn()}
        messageId="msg-abc123"
        timestamp={new Date('2026-01-01T00:00:00Z')}
      />,
    );

    expect(screen.getByText('Message information')).toBeInTheDocument();
    expect(screen.queryByText('e2e-chat-model')).not.toBeInTheDocument();
  });
});
