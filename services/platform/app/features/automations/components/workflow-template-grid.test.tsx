// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { WorkflowTemplateGrid } from './workflow-template-grid';

vi.mock('../hooks/file-queries', () => ({
  useListWorkflows: () => ({
    workflows: [
      {
        slug: 'general/welcome',
        name: 'Welcome Flow',
        description: 'A welcome template',
      },
      {
        slug: 'shopify/order',
        name: 'Order Processing',
        description: 'Process orders',
      },
    ],
    isLoading: false,
  }),
}));

const mockCanWrite = vi.fn(() => true);
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => mockCanWrite(),
    cannot: () => !mockCanWrite(),
  }),
}));

describe('WorkflowTemplateGrid', () => {
  const defaultProps = {
    organizationId: 'org-123',
    selectedSlug: null,
    onSelectSlug: vi.fn(),
    installingSlug: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCanWrite.mockReturnValue(true);
  });

  it('renders template cards', () => {
    render(<WorkflowTemplateGrid {...defaultProps} />);

    expect(screen.getByLabelText('Welcome Flow')).toBeInTheDocument();
    expect(screen.getByLabelText('Order Processing')).toBeInTheDocument();
  });

  it('calls onSelectSlug when a card is clicked', async () => {
    const onSelectSlug = vi.fn();
    const { user } = render(
      <WorkflowTemplateGrid {...defaultProps} onSelectSlug={onSelectSlug} />,
    );

    await user.click(screen.getByLabelText('Welcome Flow'));

    expect(onSelectSlug).toHaveBeenCalledWith('general/welcome');
  });

  it('disables all cards while a template is installing', () => {
    render(
      <WorkflowTemplateGrid
        {...defaultProps}
        installingSlug="general/welcome"
      />,
    );

    expect(screen.getByLabelText('Order Processing')).toBeDisabled();
  });

  it('disables cards for read-only roles that cannot write', () => {
    mockCanWrite.mockReturnValue(false);
    render(<WorkflowTemplateGrid {...defaultProps} />);

    expect(screen.getByLabelText('Welcome Flow')).toBeDisabled();
    expect(screen.getByLabelText('Order Processing')).toBeDisabled();
  });

  describe('search filtering', () => {
    it('filters templates by name', () => {
      render(<WorkflowTemplateGrid {...defaultProps} searchQuery="welcome" />);

      expect(screen.getByLabelText('Welcome Flow')).toBeInTheDocument();
      expect(
        screen.queryByLabelText('Order Processing'),
      ).not.toBeInTheDocument();
    });

    it('filters templates by description', () => {
      render(<WorkflowTemplateGrid {...defaultProps} searchQuery="process" />);

      expect(screen.getByLabelText('Order Processing')).toBeInTheDocument();
      expect(screen.queryByLabelText('Welcome Flow')).not.toBeInTheDocument();
    });

    it('shows the search-specific empty state when nothing matches', () => {
      render(<WorkflowTemplateGrid {...defaultProps} searchQuery="zzzznope" />);

      expect(
        screen.getByText('No automations match your search.'),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText('Welcome Flow')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<WorkflowTemplateGrid {...defaultProps} />);
      await checkAccessibility(container);
    });
  });
});
