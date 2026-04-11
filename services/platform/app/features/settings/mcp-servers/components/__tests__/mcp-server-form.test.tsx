import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { McpServerForm } from '../mcp-server-form';

describe('McpServerForm', () => {
  it('renders all connection fields', () => {
    render(<McpServerForm onSubmit={vi.fn()} />);

    expect(screen.getByPlaceholderText('my-mcp-server')).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
  });

  it('shows URL field for HTTP transport', () => {
    render(<McpServerForm onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/url/i)).toBeInTheDocument();
  });

  it('renders submit button', () => {
    render(<McpServerForm onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('renders cancel button when onCancel provided', () => {
    render(<McpServerForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('does not render cancel button when onCancel not provided', () => {
    render(<McpServerForm onSubmit={vi.fn()} />);
    expect(
      screen.queryByRole('button', { name: /cancel/i }),
    ).not.toBeInTheDocument();
  });

  it('disables submit button when isSubmitting', () => {
    render(<McpServerForm onSubmit={vi.fn()} isSubmitting />);
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
  });

  describe('accessibility', () => {
    it('passes axe audit for empty form', async () => {
      const { container } = render(<McpServerForm onSubmit={vi.fn()} />);
      await checkAccessibility(container);
    });

    it('passes axe audit with cancel button', async () => {
      const { container } = render(
        <McpServerForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      );
      await checkAccessibility(container);
    });
  });
});
