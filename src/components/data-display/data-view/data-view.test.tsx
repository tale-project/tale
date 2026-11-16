import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import type { SchemaTreeSchema } from '../../../data/infer-schema';
import { DataView, ShapeView } from './data-view';

const OUTPUT = {
  summary: 'Login fails on Safari',
  score: 7,
  labels: [{ name: 'bug' }, { name: 'ui', color: 'red' }],
};

const EXPECTED: SchemaTreeSchema = {
  type: 'object',
  required: ['summary', 'score'],
  properties: {
    summary: { type: 'string' },
    score: { type: 'number' },
    labels: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, color: { type: 'string' } },
      },
    },
  },
};

describe('DataView', () => {
  it('shows the values, then the shape, from one switch', async () => {
    const { user } = render(<DataView value={OUTPUT} aria-label="Returned" />);
    expect(screen.getByRole('group', { name: 'Returned' })).toBeInTheDocument();
    expect(screen.getByRole('tree', { name: 'Returned' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Shape' }));
    expect(screen.queryByRole('tree')).toBeNull();
    const fields = screen.getByRole('list', { name: 'Returned' });
    expect(within(fields).getByText('labels')).toBeInTheDocument();
    expect(within(fields).getByText('color')).toBeInTheDocument();
    expect(
      within(fields).getByText(/optional · in 1 of 2 items/),
    ).toBeInTheDocument();
  });

  it('follows a host that controls the mode', async () => {
    const onModeChange = vi.fn();
    const { user } = render(
      <DataView
        value={OUTPUT}
        aria-label="Returned"
        mode="shape"
        onModeChange={onModeChange}
      />,
    );
    expect(screen.queryByRole('tree')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Values' }));
    expect(onModeChange).toHaveBeenCalledWith('values');
  });

  it('says "Nothing recorded" without a value, or the host’s words', () => {
    const { rerender } = render(
      <DataView value={undefined} aria-label="Received" />,
    );
    expect(screen.getByText('Nothing recorded')).toBeInTheDocument();
    rerender(
      <DataView
        value={undefined}
        aria-label="Received"
        empty="Its input appears when it finishes"
      />,
    );
    expect(
      screen.getByText('Its input appears when it finishes'),
    ).toBeInTheDocument();
  });

  it('says whether the value matches the expected shape', async () => {
    const { user, rerender } = render(
      <DataView
        value={OUTPUT}
        aria-label="Returned"
        expected={EXPECTED}
        expectedLabel="From the analysis of v4"
      />,
    );
    expect(screen.getByText('Matches the expected shape')).toBeInTheDocument();
    expect(screen.getByText(/From the analysis of v4/)).toBeInTheDocument();
    rerender(
      <DataView
        value={{ summary: 3, extra: true }}
        aria-label="Returned"
        expected={EXPECTED}
      />,
    );
    expect(
      screen.getByText('Differs from the expected shape in 3 fields'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Compare' }));
    const fields = screen.getByRole('list', { name: 'Returned' });
    expect(
      within(fields).getByText(/not the expected kind/),
    ).toBeInTheDocument();
    expect(
      within(fields).getByText(/not in the expected shape/),
    ).toBeInTheDocument();
    expect(
      within(fields).getByText(/expected, but not there/),
    ).toBeInTheDocument();
  });

  it('copies the value as JSON and says so', async () => {
    const { user } = render(<DataView value={OUTPUT} aria-label="Returned" />);
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByRole('button', { name: 'Copy JSON' }));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(OUTPUT, null, 2));
    const statuses = within(
      screen.getByRole('group', { name: 'Returned' }),
    ).getAllByRole('status');
    expect(statuses.map((status) => status.textContent)).toContain('Copied');
  });

  it('hides the switch and toolbar when the host asks', () => {
    render(
      <DataView
        value={OUTPUT}
        aria-label="Returned"
        showModeSwitch={false}
        toolbar={{ copy: false }}
      />,
    );
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy JSON' })).toBeNull();
  });

  it('shows what was cut and its recorded size', () => {
    render(
      <DataView
        value={{ body: 'Lorem' }}
        aria-label="Received"
        recorded={{
          elided: [{ pointer: '/body', kind: 'string', dropped: 40 }],
          bytes: 2048,
        }}
      />,
    );
    expect(screen.getByText('+40 characters not kept')).toBeInTheDocument();
    expect(screen.getByText('2 KB recorded')).toBeInTheDocument();
  });

  it('opens the same view full screen', async () => {
    const { user } = render(
      <DataView
        value={OUTPUT}
        aria-label="Returned"
        toolbar={{ fullScreen: { title: 'Score returned' } }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Open full screen' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Score returned',
    });
    expect(within(dialog).getByRole('tree')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Close full screen' }),
    ).toBeInTheDocument();
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <DataView value={OUTPUT} aria-label="Returned" expected={EXPECTED} />,
    );
    await checkAccessibility(container);
  });
});

describe('ShapeView', () => {
  it('lists the fields of the value, how often items hold them', () => {
    render(<ShapeView value={OUTPUT} aria-label="Shape" />);
    const fields = screen.getByRole('list', { name: 'Shape' });
    expect(within(fields).getByText('summary')).toBeInTheDocument();
    expect(within(fields).getByText(/in 1 of 2 items/)).toBeInTheDocument();
  });
});
