import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { McpServerForm } from './mcp-server-form';

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

  it('rejects a malformed URL and does not submit', async () => {
    const onSubmit = vi.fn();
    const { user } = render(<McpServerForm onSubmit={onSubmit} />);

    await user.type(screen.getByPlaceholderText('my-mcp-server'), 'my-server');
    await user.type(screen.getByLabelText(/display name/i), 'My Server');
    await user.type(screen.getByLabelText(/url/i), 'not-a-url');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits when the URL is a valid http(s) URL', async () => {
    const onSubmit = vi.fn();
    const { user } = render(<McpServerForm onSubmit={onSubmit} />);

    await user.type(screen.getByPlaceholderText('my-mcp-server'), 'my-server');
    await user.type(screen.getByLabelText(/display name/i), 'My Server');
    await user.type(screen.getByLabelText(/url/i), 'https://example.com/mcp');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/mcp' }),
    );
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
