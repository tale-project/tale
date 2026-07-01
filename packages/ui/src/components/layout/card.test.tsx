import { describe, expect, it } from 'vitest';

import { checkAccessibility, expectFocusable } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardGrid,
  CardHeader,
  CardMedia,
  CardTitle,
  cardVariants,
} from './card';

describe('Card', () => {
  describe('rendering', () => {
    it('renders children', () => {
      render(<Card>Body</Card>);
      expect(screen.getByText('Body')).toBeInTheDocument();
    });

    it('composes header/title/description/content/footer', () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Title</CardTitle>
            <CardDescription>Description</CardDescription>
          </CardHeader>
          <CardContent>Content</CardContent>
          <CardFooter>
            <button type="button">Action</button>
          </CardFooter>
        </Card>,
      );
      expect(
        screen.getByRole('heading', { level: 3, name: 'Title' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Description')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Action' }),
      ).toBeInTheDocument();
    });

    it('applies the caller className over variant classes', () => {
      const { container } = render(<Card className="custom-class">x</Card>);
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('variants', () => {
    it.each(['none', 'sm', 'md', 'lg', 'xl'] as const)(
      'maps padding=%s',
      (padding) => {
        const cls = cardVariants({ padding });
        const expected = {
          none: null,
          sm: 'p-3',
          md: 'p-4',
          lg: 'p-5',
          xl: 'p-6',
        }[padding];
        if (expected) expect(cls).toContain(expected);
      },
    );

    it('maps radius=xl', () => {
      expect(cardVariants({ radius: 'xl' })).toContain('rounded-xl');
    });

    it('adds hover/focus affordances when interactive', () => {
      expect(cardVariants({ interactive: true })).toContain(
        'hover:border-border-strong',
      );
    });
  });

  describe('asChild', () => {
    it('renders as the child element and stays focusable', () => {
      render(
        <Card asChild interactive padding="none">
          <button type="button">Open</button>
        </Card>,
      );
      const button = screen.getByRole('button', { name: 'Open' });
      expectFocusable(button);
    });
  });

  describe('CardMedia', () => {
    it('renders its child glyph', () => {
      render(
        <CardMedia>
          <span data-testid="glyph" />
        </CardMedia>,
      );
      expect(screen.getByTestId('glyph')).toBeInTheDocument();
    });
  });

  describe('CardGrid', () => {
    it('renders a container-query-responsive grid of children', () => {
      const { container } = render(
        <CardGrid>
          <Card>a</Card>
          <Card>b</Card>
        </CardGrid>,
      );
      // Outer element establishes the query container; the inner element is the
      // grid whose columns scale with that container's width.
      expect(container.firstChild).toHaveClass('@container');
      expect(container.querySelector('.grid')).toHaveClass(
        '@xl:grid-cols-2',
        '@7xl:grid-cols-4',
      );
    });
  });

  describe('accessibility', () => {
    it('passes axe audit (composed card)', async () => {
      const { container } = render(
        <Card>
          <CardHeader>
            <CardTitle>Title</CardTitle>
            <CardDescription>Description</CardDescription>
          </CardHeader>
          <CardContent>
            <p>Card content</p>
          </CardContent>
        </Card>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit (interactive button card)', async () => {
      const { container } = render(
        <Card asChild interactive padding="none">
          <button type="button">Open project</button>
        </Card>,
      );
      await checkAccessibility(container);
    });
  });
});
