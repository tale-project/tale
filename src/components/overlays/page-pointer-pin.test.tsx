import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

import { Dialog } from '../dialog/dialog';
import { Popover } from './popover';

// A modal makes the page inert with `pointer-events: none` on <body>, an
// inherited property: every element of the page was restyled when a modal
// opened and again when it closed (#3974). While an overlay modal is open the
// app root carries `pointer-events: auto` itself, so the body's change stops
// there. These pin the order that makes it free: the root is pinned before
// the body turns inert, and unpinned only after the body is live again.

let root: HTMLElement;
let log: string[];
let observer: MutationObserver;

function describeStyle(element: HTMLElement): string {
  const name = element === document.body ? 'body' : element.id;
  return `${name}:${element.style.pointerEvents || 'inherit'}`;
}

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  log = [];
  observer = new MutationObserver((records) => {
    for (const record of records) {
      const entry = describeStyle(record.target as HTMLElement);
      if (log.at(-1) !== entry) log.push(entry);
    }
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['style'],
  });
  observer.observe(root, { attributes: true, attributeFilter: ['style'] });
});

afterEach(() => {
  observer.disconnect();
  root.remove();
  document.body.style.pointerEvents = '';
});

function Modal({ open, nested = false }: { open: boolean; nested?: boolean }) {
  return (
    <Dialog open={open} onOpenChange={vi.fn()} title="Task details">
      <p>Details</p>
      <Dialog open={nested} onOpenChange={vi.fn()} title="Confirmation">
        <p>Sure?</p>
      </Dialog>
    </Dialog>
  );
}

describe('PagePointerPin', () => {
  it('pins the page root before the body turns inert, and unpins after it is live again', async () => {
    const { rerender } = render(<Modal open />, { container: root });
    await waitFor(() => expect(document.body.style.pointerEvents).toBe('none'));
    expect(root.style.pointerEvents).toBe('auto');

    rerender(<Modal open={false} />);
    await waitFor(() => {
      expect(document.body.style.pointerEvents).toBe('');
      expect(root.style.pointerEvents).toBe('');
    });

    expect(log.indexOf('root:auto')).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('root:auto')).toBeLessThan(log.indexOf('body:none'));
    expect(log.lastIndexOf('body:inherit')).toBeLessThan(
      log.lastIndexOf('root:inherit'),
    );
  });

  it('holds the pin until the last stacked modal is gone', async () => {
    const { rerender } = render(<Modal open nested />, { container: root });
    await waitFor(() => expect(root.style.pointerEvents).toBe('auto'));

    rerender(<Modal open />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(root.style.pointerEvents).toBe('auto');

    rerender(<Modal open={false} />);
    await waitFor(() => expect(root.style.pointerEvents).toBe(''));
  });

  it('leaves the page inert around a layer without an overlay', async () => {
    render(
      <Popover
        open
        onOpenChange={vi.fn()}
        trigger={<button type="button">Pick</button>}
      >
        <button type="button">Ready</button>
      </Popover>,
      { container: root },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(root.style.pointerEvents).toBe('');
  });
});
