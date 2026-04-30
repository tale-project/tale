// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen, waitFor } from '@/test/utils/render';

import { WorkflowTemplateGrid } from './workflow-template-grid';

const mockInstallWorkflow = vi.fn();
const mockInvalidateWorkflows = vi.fn();

vi.mock('../hooks/file-mutations', () => ({
  useInstallWorkflow: () => ({
    mutateAsync: mockInstallWorkflow,
  }),
  useInvalidateWorkflows: () => mockInvalidateWorkflows,
}));

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
    onTemplateInstalled: vi.fn(),
  };

  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mockInstallWorkflow.mockResolvedValue(undefined);
    mockInvalidateWorkflows.mockResolvedValue(undefined);
  });

  it('renders template buttons', () => {
    render(<WorkflowTemplateGrid {...defaultProps} />);

    expect(screen.getByLabelText('Welcome Flow')).toBeInTheDocument();
    expect(screen.getByLabelText('Order Processing')).toBeInTheDocument();
  });

  it('calls onTemplateInstalled on successful install', async () => {
    const { user } = render(<WorkflowTemplateGrid {...defaultProps} />);

    await user.click(screen.getByLabelText('Welcome Flow'));

    await waitFor(() => {
      expect(mockInstallWorkflow).toHaveBeenCalledWith({
        organizationId: 'org-123',
        workflowSlug: 'general/welcome',
      });
    });

    await waitFor(() => {
      expect(defaultProps.onTemplateInstalled).toHaveBeenCalledWith(
        'general/welcome',
      );
    });
  });

  it('shows error with technical detail from first line of message', async () => {
    mockInstallWorkflow.mockRejectedValueOnce(
      new Error(
        "EACCES: permission denied, mkdir '/app/data/workflows/.history'\n    at Object.mkdirSync (node:fs:123)\n    at someFn",
      ),
    );

    const { user } = render(<WorkflowTemplateGrid {...defaultProps} />);

    await user.click(screen.getByLabelText('Welcome Flow'));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent('EACCES: permission denied');
      expect(alert).not.toHaveTextContent('at Object.mkdirSync');
    });

    expect(defaultProps.onTemplateInstalled).not.toHaveBeenCalled();
  });

  it('shows stringified detail for non-Error exceptions', async () => {
    mockInstallWorkflow.mockRejectedValueOnce('raw string error');

    const { user } = render(<WorkflowTemplateGrid {...defaultProps} />);

    await user.click(screen.getByLabelText('Welcome Flow'));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent('raw string error');
    });

    expect(defaultProps.onTemplateInstalled).not.toHaveBeenCalled();
  });

  it('clears error when retrying a template install', async () => {
    mockInstallWorkflow.mockRejectedValueOnce(new Error('server error'));

    const { user } = render(<WorkflowTemplateGrid {...defaultProps} />);

    await user.click(screen.getByLabelText('Welcome Flow'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    mockInstallWorkflow.mockResolvedValueOnce(undefined);
    await user.click(screen.getByLabelText('Welcome Flow'));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<WorkflowTemplateGrid {...defaultProps} />);
      await checkAccessibility(container);
    });
  });
});
