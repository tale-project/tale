import { Bot } from 'lucide-react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ConnectionIdentity } from './connection-identity';

function Picture({ className }: { className?: string }) {
  return (
    <ConnectionIdentity
      label="Claude Code connecting to Tale"
      from={<Bot data-testid="from" />}
      to={<span data-testid="to">T</span>}
      className={className}
    />
  );
}

describe('ConnectionIdentity', () => {
  it('is one picture, named by its label', () => {
    render(<Picture />);
    expect(
      screen.getByRole('img', { name: 'Claude Code connecting to Tale' }),
    ).toBeInTheDocument();
  });

  it('shows both marks, the first on the left, as decoration', () => {
    render(<Picture />);
    const from = screen.getByTestId('from');
    const to = screen.getByTestId('to');
    expect(
      from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    for (const mark of [from, to]) {
      expect(mark.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('joins the marks with a dashed line that draws once, and a link glyph', () => {
    const { container } = render(<Picture />);
    const line = container.querySelector('.animate-connection-reveal');
    expect(line).toHaveClass('border-dashed', 'border-t');
    expect(line?.nextElementSibling?.querySelector('svg')).toHaveClass(
      'lucide-link2',
    );
  });

  it('forwards its ref and class, and keeps the label it was given', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <ConnectionIdentity
        ref={ref}
        label="Cursor connecting to Tale"
        from="C"
        to="T"
        className="mb-4"
        data-testid="picture"
      />,
    );
    expect(ref.current).toBe(screen.getByTestId('picture'));
    expect(ref.current).toHaveClass('mb-4', 'flex', 'justify-center');
    expect(ref.current).toHaveAttribute('role', 'img');
    expect(ref.current).toHaveAttribute(
      'aria-label',
      'Cursor connecting to Tale',
    );
  });

  it('passes an accessibility audit', async () => {
    const view = render(<Picture />);
    await checkAccessibility(view);
  });
});
