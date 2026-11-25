import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { PropertyDivider, PropertyList, PropertyRow } from './property-list';

function Panel() {
  return (
    <PropertyList as="aside" aria-label="Details">
      <PropertyRow label="Status">
        <button type="button">In progress</button>
      </PropertyRow>
      <PropertyDivider />
      <PropertyRow
        label="Labels"
        stacked
        trailing={
          <button type="button" aria-label="Manage labels">
            ⚙
          </button>
        }
      >
        <span>Launch</span>
      </PropertyRow>
    </PropertyList>
  );
}

describe('PropertyList', () => {
  it('renders the landmark it is asked for, rows 16px apart', () => {
    render(<Panel />);
    const panel = screen.getByRole('complementary', { name: 'Details' });
    expect(panel).toHaveClass('flex', 'flex-col', 'gap-4');
  });

  it('forwards its ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(<PropertyList ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

describe('PropertyRow', () => {
  it('sets the label in a fixed column beside its value', () => {
    render(
      <PropertyRow label="Due date">
        <span>Oct 12</span>
      </PropertyRow>,
    );
    const label = screen.getByText('Due date');
    expect(label).toHaveClass('w-20', 'shrink-0', 'min-h-7');
    expect(label.parentElement).toHaveClass('flex-row', 'min-h-7', 'shrink-0');
    expect(label.nextElementSibling).toContainElement(
      screen.getByText('Oct 12'),
    );
  });

  // A German compound is longer than the 80px column: it wraps there rather
  // than painting over its own control.
  it('wraps a long label inside its column', () => {
    render(
      <PropertyRow label="Fälligkeitsdatum">
        <span>12. Okt.</span>
      </PropertyRow>,
    );
    expect(screen.getByText('Fälligkeitsdatum')).toHaveClass(
      'wrap-anywhere',
      'hyphens-auto',
    );
  });

  it('stacks the label above a wrapping control, with its trailing action', () => {
    render(<Panel />);
    const label = screen.getByText('Labels');
    const head = label.parentElement!;
    expect(head).toContainElement(
      screen.getByRole('button', { name: 'Manage labels' }),
    );
    expect(head.parentElement).toHaveClass('flex-col');
    expect(head.nextElementSibling).toContainElement(
      screen.getByText('Launch'),
    );
  });

  it('stacks from md up only, in the label column below it', () => {
    render(
      <PropertyRow label="Repeat" stacked="md">
        <span>Weekly</span>
      </PropertyRow>,
    );
    const head = screen.getByText('Repeat').parentElement!;
    expect(head).toHaveClass('w-20', 'md:w-auto');
    expect(head.parentElement).toHaveClass('flex-row', 'md:flex-col');
  });

  it('puts a trailing action at the end of a row', () => {
    render(
      <PropertyRow label="Reviewer" trailing={<span>trailing</span>}>
        <span>Grace Hopper</span>
      </PropertyRow>,
    );
    const row = screen.getByText('Reviewer').parentElement!;
    expect(row.lastElementChild).toHaveTextContent('trailing');
  });

  it('passes className and data attributes through', () => {
    render(
      <PropertyRow label="Status" className="extra" data-field="status">
        <span>To do</span>
      </PropertyRow>,
    );
    const row = screen.getByText('Status').parentElement!;
    expect(row).toHaveClass('extra');
    expect(row).toHaveAttribute('data-field', 'status');
  });
});

describe('PropertyDivider', () => {
  it('is a decorative hairline', () => {
    const { container } = render(<PropertyDivider />);
    const divider = container.querySelector('[aria-hidden="true"]');
    expect(divider).toHaveClass('border-t');
  });
});

describe('accessibility', () => {
  it('passes axe audit', async () => {
    const { container } = render(<Panel />);
    await checkAccessibility(container);
  });
});
