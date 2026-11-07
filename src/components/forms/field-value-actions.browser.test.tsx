import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { Skeletonize } from '../feedback/skeleton-context';
import { Input } from './input';
import { Textarea } from './textarea';

import '../../globals.css';

// Real-Chromium coverage of what jsdom cannot see: where the buttons of a
// field sit, whether its edge moves for them, and what the browser does with
// a masked value. A column of values in a form must end on one line.
afterEach(async () => {
  cleanup();
  await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: false });
});

function box(element: Element) {
  return element.getBoundingClientRect();
}

describe('the buttons inside a field (real layout)', () => {
  it('draw inside the field, on its right edge, and leave every field in a column as wide as the others', () => {
    render(
      <div className="flex w-96 flex-col gap-4 p-8">
        <Input label="Website" defaultValue="https://shop.example" />
        <Input
          label="Password"
          type="password"
          sensitive
          defaultValue="hunter2"
        />
        <Input
          label="Card number"
          type="password"
          sensitive
          copyable
          copyLabel="Copy Card number"
          defaultValue="4242 4242 4242 4242"
        />
        <Input label="Token" copyable defaultValue="tok-1" />
      </div>,
    );
    const fields = ['Website', 'Password', 'Card number', 'Token'].map((name) =>
      screen.getByLabelText(name),
    );
    const [first, ...others] = fields.map((field) => box(field));
    for (const other of others) {
      expect(other.left).toBe(first.left);
      expect(other.right).toBe(first.right);
    }

    const copy = screen.getByRole('button', { name: 'Copy Card number' });
    const show = screen.getAllByRole('button', { name: 'Show password' })[1];
    const card = box(fields[2]);
    for (const button of [copy, show]) {
      const inside = box(button);
      expect(inside.left).toBeGreaterThanOrEqual(card.left);
      expect(inside.right).toBeLessThanOrEqual(card.right);
      expect(inside.top).toBeGreaterThanOrEqual(card.top);
      expect(inside.bottom).toBeLessThanOrEqual(card.bottom);
    }
    // Copy first, then the eye, as they are read.
    expect(box(copy).right).toBeLessThanOrEqual(box(show).left);
  });

  it('keep the text of the field clear of them', () => {
    render(
      <div className="w-72 p-8">
        <Input
          label="Card number"
          type="password"
          sensitive
          copyable
          defaultValue="4242 4242 4242 4242 4242 4242"
        />
      </div>,
    );
    const field = screen.getByLabelText('Card number');
    const copy = screen.getByRole('button', { name: 'Copy' });
    const padding = Number.parseFloat(getComputedStyle(field).paddingRight);
    expect(padding).toBeGreaterThanOrEqual(box(field).right - box(copy).left);
  });

  it('mask a value with the browser, until it is shown', async () => {
    const { user } = render(
      <div className="w-96 p-8">
        <Input
          label="Password"
          type="password"
          sensitive
          defaultValue="hunter2"
        />
        <Textarea
          label="Private key"
          sensitive
          defaultValue={'line one\nline two'}
        />
      </div>,
    );
    const input = screen.getByLabelText('Password');
    const area = screen.getByLabelText('Private key');
    const security = (element: Element) =>
      getComputedStyle(element).getPropertyValue('-webkit-text-security');
    expect(security(input)).toBe('disc');
    expect(security(area)).toBe('disc');

    const [showInput, showArea] = screen.getAllByRole('button', {
      name: /^Show (password|value)$/,
    });
    await user.click(showInput);
    await user.click(showArea);
    expect(security(input)).toBe('none');
    expect(security(area)).toBe('none');
    // Showing is no editing: the values are what they were.
    expect(input).toHaveValue('hunter2');
    expect(area).toHaveValue('line one\nline two');
  });

  it('sit in the corner of a text area, which keeps its width and its text clear of them', () => {
    render(
      <div className="flex w-96 flex-col gap-4 p-8">
        <Input label="Name" defaultValue="Ann" />
        <Textarea
          label="Private key"
          sensitive
          copyable
          copyLabel="Copy Private key"
          defaultValue={'a long first line of text '.repeat(8)}
        />
      </div>,
    );
    const input = box(screen.getByLabelText('Name'));
    const area = screen.getByLabelText('Private key');
    expect(box(area).left).toBe(input.left);
    expect(box(area).right).toBe(input.right);
    const copy = box(screen.getByRole('button', { name: 'Copy Private key' }));
    expect(copy.right).toBeLessThanOrEqual(box(area).right);
    expect(copy.top).toBeGreaterThanOrEqual(box(area).top);
    expect(copy.bottom).toBeLessThanOrEqual(box(area).bottom);
    expect(
      Number.parseFloat(getComputedStyle(area).paddingRight),
    ).toBeGreaterThan(box(area).right - copy.left - 1);
  });

  // The box the buttons are drawn in lies over the field: a click on it that
  // misses every button is still a click on the field, which takes the focus.
  describe('leave the field its clicks', () => {
    function reach(x: number, y: number) {
      return document.elementFromPoint(x, y);
    }

    function insideAny(x: number, y: number, rects: DOMRect[]) {
      return rects.some(
        (rect) =>
          x >= rect.left - 0.5 &&
          x <= rect.right + 0.5 &&
          y >= rect.top - 0.5 &&
          y <= rect.bottom + 0.5,
      );
    }

    /** Every point, 1px apart, of the box the buttons sit in that is on no button. */
    function pointsBesideButtons(buttons: HTMLElement[]) {
      const frame = buttons[0].parentElement;
      if (frame === null) throw new Error('the buttons have no box');
      const area = box(frame);
      const rects = buttons.map((button) => box(button));
      const points: Array<[number, number]> = [];
      for (let x = Math.ceil(area.left); x < area.right; x++) {
        for (let y = Math.ceil(area.top); y < area.bottom; y++) {
          if (!insideAny(x, y, rects)) points.push([x, y]);
        }
      }
      return points;
    }

    it.each([
      [
        'a masked single-line field',
        <Input
          key="input"
          label="Card"
          type="password"
          sensitive
          copyable
          defaultValue="abc"
        />,
        'Card',
      ],
      [
        'a masked text area',
        <Textarea
          key="area"
          label="Key"
          sensitive
          copyable
          defaultValue="abc"
        />,
        'Key',
      ],
    ])('on %s, beside the buttons', (_name, field, label) => {
      render(<div className="w-96 p-8">{field}</div>);
      const control = screen.getByLabelText(label);
      const copy = screen.getByRole('button', { name: 'Copy' });
      const show = screen.getByRole('button', { name: /^Show / });

      const beside = pointsBesideButtons([copy, show]);
      // There is a margin to test: above and below the 24px buttons of a field
      // that is 36px tall, and the gap between the two buttons.
      expect(beside.length).toBeGreaterThan(0);
      const lost = beside.filter(([x, y]) => reach(x, y) !== control);
      expect(lost).toEqual([]);

      // The buttons keep their own clicks.
      for (const button of [copy, show]) {
        const rect = box(button);
        const hit = reach(
          (rect.left + rect.right) / 2,
          (rect.top + rect.bottom) / 2,
        );
        expect(hit?.closest('button')).toBe(button);
      }
    });

    it('while a finger is the pointer, a tap near a button still lands on it', async () => {
      await cdp().send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 1,
      });
      expect(window.matchMedia('(pointer: coarse)').matches).toBe(true);
      render(
        <div className="w-96 p-8">
          <Input
            label="Card"
            type="password"
            sensitive
            copyable
            defaultValue="abc"
          />
        </div>,
      );
      const field = box(screen.getByLabelText('Card'));
      const copy = screen.getByRole('button', { name: 'Copy' });
      const show = screen.getByRole('button', { name: /^Show / });
      // The 36px field is 6px taller above and below each 24px button; the
      // invisible 44px target of a button covers that margin, so a thumb that
      // lands high or low still presses the button it was aimed at.
      for (const button of [copy, show]) {
        const rect = box(button);
        const x = (rect.left + rect.right) / 2;
        for (const y of [field.top + 2, field.bottom - 2]) {
          expect(document.elementFromPoint(x, y)?.closest('button')).toBe(
            button,
          );
        }
      }
    });
  });

  // The buttons are controls of the field: while a Skeletonize around it loads
  // they are neither drawn nor reachable, in whichever frame the field is drawn.
  it('are neither drawn nor reachable while a Skeletonize around the field loads', () => {
    const { container } = render(
      <Skeletonize loading>
        <div className="flex w-96 flex-col gap-4 p-8">
          <Input
            label="Card"
            type="password"
            sensitive
            copyable
            defaultValue="abc"
          />
          <Textarea label="Key" sensitive copyable defaultValue="abc" />
        </div>
      </Skeletonize>,
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      const rect = box(button);
      expect(rect.width).toBeGreaterThan(0);
      expect(getComputedStyle(button).visibility).toBe('hidden');
      const hit = document.elementFromPoint(
        (rect.left + rect.right) / 2,
        (rect.top + rect.bottom) / 2,
      );
      expect(hit?.closest('button')).toBeNull();
    }
  });
});
