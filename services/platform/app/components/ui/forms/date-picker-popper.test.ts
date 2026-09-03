import { describe, expect, it } from 'vitest';

import {
  isDatePickerPopperEvent,
  isDatePickerPopperTarget,
} from './date-picker-popper';

describe('isDatePickerPopperTarget', () => {
  it('matches nodes inside the portaled calendar', () => {
    const root = document.createElement('div');
    root.setAttribute('data-tale-datepicker-popper', '');
    const day = document.createElement('div');
    root.append(day);
    expect(isDatePickerPopperTarget(day)).toBe(true);
    expect(isDatePickerPopperTarget(document.createElement('div'))).toBe(false);
  });
});

describe('isDatePickerPopperEvent', () => {
  it('matches a click on the month-nav chevron SVG', () => {
    const root = document.createElement('div');
    root.setAttribute('data-tale-datepicker-popper', '');
    const chevron = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg',
    );
    root.append(chevron);
    document.body.append(root);

    let matched = false;
    chevron.addEventListener('mousedown', (event) => {
      matched = isDatePickerPopperEvent(event);
    });
    chevron.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );

    expect(matched).toBe(true);
    root.remove();
  });

  it('does not match clicks outside the calendar', () => {
    const outside = document.createElement('button');
    document.body.append(outside);

    let matched = true;
    outside.addEventListener('mousedown', (event) => {
      matched = isDatePickerPopperEvent(event);
    });
    outside.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );

    expect(matched).toBe(false);
    outside.remove();
  });
});
