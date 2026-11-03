import { RESTORE_FOCUS_LOST_EVENT } from '@tale/ui/use-restore-focus';
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';

import { rowMarker, useRowFocusRescue } from './use-row-focus-rescue';

function Rows({ ids, empty = false }: { ids: number[]; empty?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useRowFocusRescue(root);
  return (
    <div ref={root} role="region" aria-label="List" tabIndex={-1}>
      {empty ? (
        <button type="button">Add</button>
      ) : (
        <ul>
          {ids.map((id) => (
            <li key={id} {...rowMarker(id)}>
              <a href={`/${id}`}>Row {id}</a>
              <button type="button" disabled>
                Disabled {id}
              </button>
              <button type="button">Menu {id}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What a dialog does when the row it was opened from is gone. */
function loseFocus(from: Element) {
  const event = new CustomEvent(RESTORE_FOCUS_LOST_EVENT, {
    bubbles: true,
    cancelable: true,
  });
  from.dispatchEvent(event);
  return event;
}

describe('useRowFocusRescue', () => {
  it('moves the focus to the row that took the lost one’s place', () => {
    const { rerender } = render(<Rows ids={[3, 2, 1]} />);
    screen.getByRole('button', { name: 'Menu 2' }).focus();

    rerender(<Rows ids={[3, 1]} />);
    const event = loseFocus(screen.getByRole('list'));

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole('link', { name: 'Row 1' })).toHaveFocus();
  });

  it('remembers the row from a press, for a menu that opens without taking the focus', () => {
    const { rerender } = render(<Rows ids={[3, 2, 1]} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Menu 2' }));

    rerender(<Rows ids={[3, 1]} />);
    loseFocus(screen.getByRole('list'));

    expect(screen.getByRole('link', { name: 'Row 1' })).toHaveFocus();
  });

  it('remembers the row from a key pressed in it', () => {
    const { rerender } = render(<Rows ids={[3, 2, 1]} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Menu 3' }), {
      key: 'Enter',
    });

    rerender(<Rows ids={[2, 1]} />);
    loseFocus(screen.getByRole('list'));

    expect(screen.getByRole('link', { name: 'Row 2' })).toHaveFocus();
  });

  it('moves to the row before it when the last row was the lost one', () => {
    const { rerender } = render(<Rows ids={[3, 2, 1]} />);
    screen.getByRole('button', { name: 'Menu 1' }).focus();

    rerender(<Rows ids={[3, 2]} />);
    loseFocus(screen.getByRole('list'));

    expect(screen.getByRole('link', { name: 'Row 2' })).toHaveFocus();
  });

  it('lands on the first control a reader can use: not on a disabled one', () => {
    render(<Rows ids={[1]} />);
    loseFocus(screen.getByRole('list'));

    expect(screen.getByRole('link', { name: 'Row 1' })).toHaveFocus();
  });

  it('goes to the first control of the list when no row is left', () => {
    const { rerender } = render(<Rows ids={[1]} />);
    screen.getByRole('button', { name: 'Menu 1' }).focus();

    rerender(<Rows ids={[]} empty />);
    const event = loseFocus(screen.getByRole('region'));

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole('button', { name: 'Add' })).toHaveFocus();
  });

  it('leaves the focus to the list itself when it has nothing to focus', () => {
    const { rerender } = render(<Rows ids={[1]} />);

    rerender(<Rows ids={[]} empty />);
    screen.getByRole('button', { name: 'Add' }).remove();
    const event = loseFocus(screen.getByRole('region'));

    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves alone a loss another part of the page already answered', () => {
    render(<Rows ids={[2, 1]} />);
    const outside = document.createElement('button');
    document.body.append(outside);
    const list = screen.getByRole('list');
    list.addEventListener(RESTORE_FOCUS_LOST_EVENT, (event) => {
      event.preventDefault();
      outside.focus();
    });
    // The page's own handler runs first, being nearer the event.
    const event = loseFocus(list);

    expect(event.defaultPrevented).toBe(true);
    expect(outside).toHaveFocus();
    outside.remove();
  });
});
