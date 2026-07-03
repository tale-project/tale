// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

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

describe('WorkflowTemplateGrid', () => {
  const defaultProps = {
    organizationId: 'org-123',
    selectedSlug: null,
    onSelectSlug: vi.fn(),
    installingSlug: null,
  };

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

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<WorkflowTemplateGrid {...defaultProps} />);
      await checkAccessibility(container);
    });
  });
});
