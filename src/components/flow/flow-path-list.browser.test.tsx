import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { render, screen, waitFor } from '@/tests/utils/render';

import { Sheet } from '../overlays/sheet';
import {
  FlowPathList,
  type FlowPathListProps,
  type FlowPathListSection,
} from './flow-path-list';

import '../../globals.css';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

const SECTIONS: FlowPathListSection[] = [
  {
    id: 'paths',
    rows: [
      {
        id: 'p1',
        title: 'Path 1',
        meta: '6 of 6 nodes run',
        clauses: [{ id: 'urgent', label: 'Urgent: Yes', tone: 'positive' }],
      },
      {
        id: 'p2',
        title: 'Path 2',
        meta: '5 of 6 nodes run',
        clauses: [{ id: 'urgent', label: 'Urgent: No', tone: 'negative' }],
      },
    ],
  },
  {
    id: 'halts',
    title: 'Ends the run when it fails',
    rows: [
      { id: 'fetch', title: 'Fetch', pinnable: false },
      { id: 'merge', title: 'Merge', pinnable: false },
    ],
  },
];

function Harness({ onPin, onPreview, ...props }: Partial<FlowPathListProps>) {
  const [pinned, setPinned] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <div style={{ width: 320 }}>
      <button type="button">Before the list</button>
      <FlowPathList
        sections={SECTIONS}
        aria-label="Paths a run can take"
        pinnedId={pinned}
        previewId={preview}
        onPin={(id) => {
          setPinned(id);
          onPin?.(id);
        }}
        onPreview={(id) => {
          setPreview(id);
          onPreview?.(id);
        }}
        announce={(row) => `Showing ${row.title}`}
        {...props}
      />
      <p data-testid="preview">{preview ?? 'none'}</p>
    </div>
  );
}

const row = (name: RegExp) => screen.getByRole('button', { name });

describe('FlowPathList', () => {
  it('is one Tab stop that the arrows walk across every section', async () => {
    render(<Harness />);
    screen.getByRole('button', { name: 'Before the list' }).focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(row(/^Path 1/));
    expect(screen.getByTestId('preview')).toHaveTextContent('p1');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(row(/^Path 2/));
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(row(/^Merge/));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(row(/^Path 1/));
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(row(/^Path 1/));
    const tabbable = Array.from(
      document.querySelectorAll<HTMLElement>('[data-flow-path-row]'),
    ).filter((element) => element.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    await userEvent.tab();
    expect(screen.getByTestId('preview')).toHaveTextContent('none');
  });

  it('pins with Enter, says so once, and unpins with Escape or Show all', async () => {
    const onPin = vi.fn();
    render(<Harness onPin={onPin} />);
    screen.getByRole('button', { name: 'Before the list' }).focus();
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onPin).toHaveBeenLastCalledWith('p2');
    expect(row(/^Path 2/)).toHaveAttribute('aria-pressed', 'true');
    expect(row(/^Path 1/)).toHaveAttribute('aria-pressed', 'false');
    const status = screen.getByRole('status');
    await waitFor(() => expect(status).toHaveTextContent('Showing Path 2'));
    expect(status.querySelectorAll('span')).toHaveLength(1);
    // While a path is pinned the list claims Escape from a sheet around it.
    expect(
      document.querySelector('[data-slot="flow-path-list"]'),
    ).toHaveAttribute('data-claims-escape');

    // Unpinning shows every path again: the preview ends with the pin,
    // and focus stays where it was.
    await userEvent.keyboard('{Escape}');
    expect(onPin).toHaveBeenLastCalledWith(null);
    expect(row(/^Path 2/)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('preview')).toHaveTextContent('none');
    expect(document.activeElement).toBe(row(/^Path 2/));
    expect(
      document.querySelector('[data-slot="flow-path-list"]'),
    ).not.toHaveAttribute('data-claims-escape');
    // The next arrow key previews again.
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByTestId('preview')).toHaveTextContent('p1');

    await userEvent.click(row(/^Path 1/));
    await waitFor(() => expect(status).toHaveTextContent('Showing Path 1'));
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(onPin).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
    expect(document.activeElement).toBe(row(/^Path 1/));
    expect(screen.getByTestId('preview')).toHaveTextContent('none');
  });

  it('unpins with Escape from Show all and returns focus to the row', async () => {
    const onPin = vi.fn();
    render(<Harness onPin={onPin} />);
    await userEvent.click(row(/^Path 2/));
    await userEvent.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Show all' }),
    );
    await userEvent.keyboard('{Escape}');
    expect(onPin).toHaveBeenLastCalledWith(null);
    expect(document.activeElement).toBe(row(/^Path 2/));
    expect(screen.getByTestId('preview')).toHaveTextContent('none');
  });

  it('takes the first Escape in a sheet to unpin, and the next closes it', async () => {
    function InSheet() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <p>{open ? 'sheet open' : 'sheet closed'}</p>
          <Sheet
            open={open}
            onOpenChange={setOpen}
            title="Paths"
            description="Every way a run can go"
            side="bottom"
          >
            <Harness />
          </Sheet>
        </>
      );
    }
    render(<InSheet />);
    await userEvent.click(
      await screen.findByRole('button', { name: /^Path 2/ }),
    );
    expect(row(/^Path 2/)).toHaveAttribute('aria-pressed', 'true');
    await userEvent.keyboard('{Escape}');
    expect(row(/^Path 2/)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('sheet open')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.getByText('sheet closed')).toBeInTheDocument(),
    );
  });

  it('activates a row that is not a path instead of pinning it', async () => {
    const onActivate = vi.fn();
    const onPin = vi.fn();
    render(<Harness onActivate={onActivate} onPin={onPin} />);
    const merge = row(/^Merge/);
    expect(merge).not.toHaveAttribute('aria-pressed');
    await userEvent.click(merge);
    expect(onActivate).toHaveBeenCalledWith('merge');
    expect(onPin).not.toHaveBeenCalled();
    // Pointing previews it, as it does a path.
    await userEvent.hover(row(/^Fetch/));
    expect(screen.getByTestId('preview')).toHaveTextContent('fetch');
  });

  it('names each section and shows the empty words without rows', async () => {
    const { rerender } = render(<Harness />);
    expect(
      screen.getByRole('list', { name: 'Ends the run when it fails' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Paths a run can take' }),
    ).toBeInTheDocument();
    rerender(
      <Harness
        sections={[{ id: 'none', rows: [] }]}
        empty="Every run takes the same path."
      />,
    );
    expect(
      screen.getByText('Every run takes the same path.'),
    ).toBeInTheDocument();
  });

  it.each(['light', 'dark'])('passes axe (%s)', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = render(<Harness />);
    await userEvent.click(row(/^Path 2/));
    const result = await axe.run(container, {
      runOnly: ['wcag2a', 'wcag2aa'],
    });
    expect(result.violations).toEqual([]);
  });
});
