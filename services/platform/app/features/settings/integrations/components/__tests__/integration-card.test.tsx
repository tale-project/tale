// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Code } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntegrationCard } from '../integration-card';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/app/components/ui/data-display/image', () => ({
  // oxlint-disable-next-line jsx-a11y/alt-text -- test mock, alt is passed via props spread
  Image: (props: Record<string, unknown>) => <img alt="" {...props} />,
}));

afterEach(cleanup);

describe('IntegrationCard', () => {
  it('renders title and description', () => {
    render(
      <IntegrationCard
        title="Shopify"
        description="Sync products from Shopify."
      />,
    );
    expect(screen.getByText('Shopify')).toBeInTheDocument();
    expect(screen.getByText('Sync products from Shopify.')).toBeInTheDocument();
  });

  it('shows "Connected" badge when active', () => {
    render(
      <IntegrationCard title="Shopify" description="Sync products." isActive />,
    );
    expect(
      screen.getByText('integrations.badge.connected'),
    ).toBeInTheDocument();
  });

  it('shows "Connect" badge when not active', () => {
    render(<IntegrationCard title="GitHub" description="Sync repos." />);
    expect(screen.getByText('integrations.badge.connect')).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(
      <IntegrationCard
        title="Shopify"
        description="Sync products."
        onClick={handleClick}
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it('calls onClick on Enter key press', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(
      <IntegrationCard
        title="Shopify"
        description="Sync products."
        onClick={handleClick}
      />,
    );
    screen.getByRole('button').focus();
    await user.keyboard('{Enter}');
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it('renders custom icon', () => {
    const { container } = render(
      <IntegrationCard
        title="Custom"
        description="Custom integration."
        icon={Code}
      />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders iconUrl as image when provided', () => {
    render(
      <IntegrationCard
        title="GitHub"
        description="Sync repos."
        iconUrl="https://example.com/github.svg"
      />,
    );
    const img = screen.getByRole('img', { name: 'GitHub' });
    expect(img).toHaveAttribute('src', 'https://example.com/github.svg');
  });

  it('disables button when disabled prop is true', () => {
    const handleClick = vi.fn();
    render(
      <IntegrationCard
        title="Shopify"
        description="Installing..."
        disabled
        onClick={handleClick}
      />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
