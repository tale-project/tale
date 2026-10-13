import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { PermissionSummary } from './permission-summary';

const ITEMS = [
  { label: 'Read automations', allowed: true },
  {
    label: 'Edit automations',
    allowed: false,
    detail: 'Your role in Acme does not allow this.',
  },
  { label: 'Run automations', allowed: true, detail: 'Test runs only.' },
] as const;

describe('PermissionSummary', () => {
  it('lists each permission with its state in words, ahead of the label', () => {
    render(<PermissionSummary title="What it can do" items={ITEMS} />);
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Allowed: Read automations',
      'Not allowed: Edit automationsYour role in Acme does not allow this.',
      'Allowed: Run automationsTest runs only.',
    ]);
  });

  it('draws a check for what is allowed and a dash for what is not, as decoration', () => {
    const { container } = render(<PermissionSummary items={ITEMS} />);
    const icons = [...container.querySelectorAll('li > svg')];
    expect(icons.map((icon) => icon.getAttribute('aria-hidden'))).toEqual([
      'true',
      'true',
      'true',
    ]);
    expect(
      icons.map((icon) => icon.classList.contains('lucide-check')),
    ).toEqual([true, false, true]);
    expect(
      icons.map((icon) => icon.classList.contains('lucide-minus')),
    ).toEqual([false, true, false]);
  });

  it('names the list by its title, and leaves it unnamed without one', () => {
    const { rerender } = render(
      <PermissionSummary title="What it can do" items={ITEMS} />,
    );
    expect(
      screen.getByRole('list', { name: 'What it can do' }),
    ).toBeInTheDocument();
    rerender(<PermissionSummary items={ITEMS} />);
    expect(screen.getByRole('list')).not.toHaveAccessibleName();
    expect(screen.queryByText('What it can do')).not.toBeInTheDocument();
  });

  it('shows the footer under the list and nothing when there is none', () => {
    const { rerender } = render(
      <PermissionSummary items={ITEMS} footer="Limited by your role." />,
    );
    expect(screen.getByText('Limited by your role.')).toBeInTheDocument();
    rerender(<PermissionSummary items={ITEMS} />);
    expect(screen.queryByText('Limited by your role.')).not.toBeInTheDocument();
  });

  it('mutes what is not allowed and keeps what is allowed at full strength', () => {
    render(<PermissionSummary items={ITEMS} />);
    const [read, edit] = screen.getAllByRole('listitem');
    expect(read?.querySelector('span.text-foreground')).not.toBeNull();
    expect(edit?.querySelector('span.text-muted-foreground')).not.toBeNull();
    expect(edit?.querySelector('span.text-foreground')).toBeNull();
  });

  it('is an empty list, not a missing one, when it holds nothing', () => {
    render(<PermissionSummary title="Nothing yet" items={[]} />);
    expect(within(screen.getByRole('list')).queryAllByRole('listitem')).toEqual(
      [],
    );
  });

  it('forwards its ref and the attributes a host sets, such as a live region', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <PermissionSummary
        ref={ref}
        items={ITEMS}
        aria-live="polite"
        className="max-w-xs"
        data-testid="summary"
      />,
    );
    expect(ref.current).toBe(screen.getByTestId('summary'));
    expect(ref.current).toHaveAttribute('aria-live', 'polite');
    expect(ref.current).toHaveClass('max-w-xs', 'rounded-lg', 'border');
  });

  it('passes an accessibility audit', async () => {
    const view = render(
      <PermissionSummary
        title="What it can do"
        items={ITEMS}
        footer="Limited by your role."
      />,
    );
    await checkAccessibility(view);
  });
});
