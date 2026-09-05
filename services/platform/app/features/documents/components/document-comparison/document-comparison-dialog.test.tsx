import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// The dialog pre-fills its "Existing" pickers from the bounded hub listing.
// Before this test the listing carried no truncation signal, so a hub with
// more documents than the bound offered the newest ones as if they were all
// of them. The hook now reports `truncated`; the dialog must say so.
const listing = {
  documents: [] as never[],
  truncated: false,
  isLoading: false,
};

vi.mock('../../hooks/queries', () => ({
  useDocuments: () => listing,
}));
vi.mock('../../hooks/use-document-comparison', () => ({
  useDocumentComparison: () => ({
    compare: vi.fn(),
    result: null,
    error: null,
    isPending: false,
    reset: vi.fn(),
  }),
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

import { DocumentComparisonDialog } from './document-comparison-dialog';

const NOTICE =
  'Only the newest documents are listed here. Upload the file to compare an older one.';

describe('DocumentComparisonDialog', () => {
  it('says nothing about the bound when the hub listing is complete', () => {
    listing.truncated = false;
    render(
      <DocumentComparisonDialog
        open
        onOpenChange={vi.fn()}
        organizationId="org-1"
      />,
    );
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('tells the user the picker holds only the newest documents when cut', () => {
    listing.truncated = true;
    render(
      <DocumentComparisonDialog
        open
        onOpenChange={vi.fn()}
        organizationId="org-1"
      />,
    );
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });
});
