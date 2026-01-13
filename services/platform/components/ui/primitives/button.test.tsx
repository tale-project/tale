import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/utils/render';
import { checkAccessibility, expectFocusable } from '@/test/utils/a11y';
import { Button, LinkButton } from './button';
import { Mail } from 'lucide-react';

describe('Button', () => {
  describe('rendering', () => {
    it('renders with default props', () => {
      render(<Button>Click me</Button>);
      expect(
        screen.getByRole('button', { name: /click me/i })
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
      'default',
      'destructive',
      'success',
      'outline',
      'secondary',
      'ghost',
      'link',
      'primary',
    ] as const)('renders %s variant', (variant) => {
      render(<Button variant={variant}>Button</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });
  });

  describe('sizes', () => {
    it.each(['default', 'sm', 'lg', 'icon'] as const)(
      'renders %s size',
      (size) => {
        render(<Button size={size}>Button</Button>);
        expect(screen.getByRole('button')).toBeInTheDocument();
      }
    );
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
        </Button>
      );

      await user.click(screen.getByRole('button'));
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('does not call onClick when loading', async () => {
      const handleClick = vi.fn();
      const { user } = render(
        <Button onClick={handleClick} isLoading>
          Click me
        </Button>
      );

      await user.click(screen.getByRole('button'));
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('responds to keyboard Enter', async () => {
      const handleClick = vi.fn();
      const { user } = render(
        <Button onClick={handleClick}>Press Enter</Button>
      );

      const button = screen.getByRole('button');
      button.focus();
      await user.keyboard('{Enter}');
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('responds to keyboard Space', async () => {
      const handleClick = vi.fn();
      const { user } = render(
        <Button onClick={handleClick}>Press Space</Button>
      );

      const button = screen.getByRole('button');
      button.focus();
      await user.keyboard(' ');
      expect(handleClick).toHaveBeenCalledTimes(1);
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
        'true'
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
      </LinkButton>
    );
    const link = screen.getByRole('link');
    expect(link.querySelector('svg')).toBeInTheDocument();
  });

  it('icon has aria-hidden', () => {
    render(
      <LinkButton href="/test" icon={Mail}>
        Send
      </LinkButton>
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
