import { Mail } from 'lucide-react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility, expectFocusable } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Button, LinkButton } from './button';

vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef(
    (
      {
        to,
        children,
        preload: _preload,
        ...props
      }: { to: string; children: React.ReactNode; preload?: string | false },
      ref: React.ForwardedRef<HTMLAnchorElement>,
    ) => (
      <a ref={ref} href={to} {...props}>
        {children}
      </a>
    ),
  ),
}));

describe('Button', () => {
  describe('rendering', () => {
    it('renders with default props', () => {
      render(<Button>Click me</Button>);
      expect(
        screen.getByRole('button', { name: /click me/i }),
      ).toBeInTheDocument();
    });

    it('renders with icon', () => {
      render(<Button icon={Mail}>Send</Button>);
      const button = screen.getByRole('button', { name: /send/i });
      expect(button.querySelector('svg')).toBeInTheDocument();
    });

    it('renders loading state with spinner', () => {
      render(<Button isLoading>Loading</Button>);
      const button = screen.getByRole('button', { name: /loading/i });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button.querySelector('.animate-spin')).toBeInTheDocument();
    });
  });

  describe('variants', () => {
    it.each([
      'primary',
      'destructive',
      'success',
      'secondary',
      'ghost',
      'link',
    ] as const)('renders %s variant', (variant) => {
      render(<Button variant={variant}>Button</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });
  });

  describe('sizes', () => {
    it.each(['default', 'sm', 'icon', 'icon-sm'] as const)(
      'renders %s size',
      (size) => {
        // `title` names the icon size (the type requires icon buttons to be
        // labeled) and is harmless on the others.
        render(
          <Button size={size} title="Button">
            Button
          </Button>,
        );
        expect(screen.getByRole('button')).toBeInTheDocument();
      },
    );
  });

  describe('title (icon-button label + tooltip)', () => {
    it('uses `title` as the accessible name and drops the native title', () => {
      render(
        <Button size="icon" title="Zoom in">
          <Mail className="size-4" />
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Zoom in' });
      expect(button).toBeInTheDocument();
      // No duplicate native browser tooltip.
      expect(button).not.toHaveAttribute('title');
    });

    it('lets an explicit aria-label override the title for the name', () => {
      render(
        <Button size="icon" title="tooltip text" aria-label="real label">
          <Mail className="size-4" />
        </Button>,
      );
      expect(
        screen.getByRole('button', { name: 'real label' }),
      ).toBeInTheDocument();
    });

    it('does not let `title` override a text button’s name from children', () => {
      // For non-icon buttons the accessible name comes from the children; the
      // `title` only drives the tooltip, never the name.
      render(<Button title="tooltip text">Save</Button>);
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'tooltip text' })).toBeNull();
    });

    it('shows a tooltip on focus, sourced from `title`', async () => {
      const { user } = render(
        <Button size="icon" title="Zoom in">
          <Mail className="size-4" />
        </Button>,
      );
      await user.tab();
      // Radix opens the tooltip on trigger focus; content carries role=tooltip.
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toHaveTextContent('Zoom in');
    });

    it('prefers explicit `tooltip` content over `title` for the visible tip', async () => {
      const { user } = render(
        <Button size="icon" title="aria name" tooltip="Rich tip">
          <Mail className="size-4" />
        </Button>,
      );
      // The accessible name still comes from `title`.
      expect(
        screen.getByRole('button', { name: 'aria name' }),
      ).toBeInTheDocument();
      await user.tab();
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toHaveTextContent('Rich tip');
    });

    it('renders no tooltip trigger when used as a Slot (asChild)', () => {
      // A Slot is typically another overlay's trigger; wrapping it in a tooltip
      // trigger would break that composition, so the tooltip is suppressed.
      render(
        <Button asChild title="tooltip text">
          <a href="/test">Link</a>
        </Button>,
      );
      const link = screen.getByRole('link', { name: 'Link' });
      // The Slot collapses onto the anchor; no extra tooltip-trigger button.
      expect(link).toBeInTheDocument();
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('passes axe audit for an icon button named via `title`', async () => {
      const { container } = render(
        <Button size="icon" title="Zoom in">
          <Mail className="size-4" />
        </Button>,
      );
      await checkAccessibility(container);
    });
  });

  describe('interactions', () => {
    it('calls onClick when clicked', async () => {
      const handleClick = vi.fn();
      const { user } = render(<Button onClick={handleClick}>Click me</Button>);

      await user.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('does not call onClick when disabled', async () => {
      const handleClick = vi.fn();
      const { user } = render(
        <Button onClick={handleClick} disabled>
          Click me
        </Button>,
      );

      await user.click(screen.getByRole('button'));
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('does not call onClick when loading', async () => {
      const handleClick = vi.fn();
      const { user } = render(
        <Button onClick={handleClick} isLoading>
          Click me
        </Button>,
      );

      await user.click(screen.getByRole('button'));
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('responds to keyboard Enter', async () => {
      const handleClick = vi.fn();
      const { user } = render(
        <Button onClick={handleClick}>Press Enter</Button>,
      );

      const button = screen.getByRole('button');
      button.focus();
      await user.keyboard('{Enter}');
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('responds to keyboard Space', async () => {
      const handleClick = vi.fn();
      const { user } = render(
        <Button onClick={handleClick}>Press Space</Button>,
      );

      const button = screen.getByRole('button');
      button.focus();
      await user.keyboard(' ');
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('collapseLabel', () => {
    it('keeps an accessible name when the label is collapsed', () => {
      render(
        <Button icon={Mail} collapseLabel>
          Send
        </Button>,
      );
      // Label is visually hidden on mobile (sr-only) but stays the a11y name.
      expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
    });

    it('wraps the label so it is hidden below sm and shown from sm', () => {
      render(
        <Button icon={Mail} collapseLabel>
          Send
        </Button>,
      );
      const label = screen.getByText('Send');
      expect(label).toHaveClass('sr-only', 'sm:not-sr-only');
    });

    it('passes axe audit when collapsed', async () => {
      const { container } = render(
        <Button icon={Mail} collapseLabel>
          Send
        </Button>,
      );
      await checkAccessibility(container);
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Button>Accessible Button</Button>);
      await checkAccessibility(container);
    });

    it('is focusable', () => {
      render(<Button>Focus me</Button>);
      const button = screen.getByRole('button');
      expectFocusable(button);
    });

    it('has visible focus ring class', () => {
      render(<Button>Focus me</Button>);
      const button = screen.getByRole('button');
      expect(button.className).toContain('focus-visible:ring-1');
    });

    it('disabled button has disabled attribute', () => {
      render(<Button disabled>Disabled</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('disabled');
    });

    it('loading button has aria-busy', () => {
      render(<Button isLoading>Loading</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    });

    it('loading button has aria-disabled', () => {
      render(<Button isLoading>Loading</Button>);
      expect(screen.getByRole('button')).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });

    it('icon has aria-hidden', () => {
      render(<Button icon={Mail}>Send</Button>);
      const button = screen.getByRole('button');
      const svg = button.querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('press animation', () => {
    it('has press animation classes', () => {
      render(<Button>Press me</Button>);
      const button = screen.getByRole('button');
      expect(button.className).toContain('active:scale-[0.97]');
    });

    it('disabled button does not scale on press', () => {
      render(<Button disabled>Disabled</Button>);
      const button = screen.getByRole('button');
      expect(button.className).toContain('disabled:active:scale-100');
    });
  });
});

describe('LinkButton', () => {
  it('renders as a link', () => {
    render(<LinkButton href="/test">Go to test</LinkButton>);
    const link = screen.getByRole('link', { name: /go to test/i });
    expect(link).toHaveAttribute('href', '/test');
  });

  it('renders with icon', () => {
    render(
      <LinkButton href="/test" icon={Mail}>
        Send
      </LinkButton>,
    );
    const link = screen.getByRole('link');
    expect(link.querySelector('svg')).toBeInTheDocument();
  });

  it('icon has aria-hidden', () => {
    render(
      <LinkButton href="/test" icon={Mail}>
        Send
      </LinkButton>,
    );
    const link = screen.getByRole('link');
    const svg = link.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('passes accessibility audit', async () => {
    const { container } = render(<LinkButton href="/test">Link</LinkButton>);
    await checkAccessibility(container);
  });
});
