import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { Select } from './select';

import '../../globals.css';

afterEach(cleanup);

it('ends a value too long for the field in an ellipsis, with the chevron still in view', () => {
  render(
    <div style={{ width: 240 }}>
      <Select
        aria-label="Missed runs"
        value="later"
        onValueChange={() => undefined}
        options={[
          {
            value: 'later',
            label:
              'Einmal nachholen, sobald Tale wieder läuft, und dann wie geplant weitermachen',
          },
          { value: 'skip', label: 'Überspringen' },
        ]}
      />
    </div>,
  );
  const trigger = screen.getByRole('combobox', { name: 'Missed runs' });
  const value = trigger.querySelector(':scope > span');
  if (!(value instanceof HTMLElement)) throw new Error('no value');
  const style = getComputedStyle(value);
  expect(style.textOverflow).toBe('ellipsis');
  expect(style.whiteSpace).toBe('nowrap');
  // The text is longer than the room it has, and the room ends inside the
  // field, before the chevron.
  expect(value.scrollWidth).toBeGreaterThan(value.clientWidth);
  const chevron = trigger.querySelector('svg');
  const field = trigger.getBoundingClientRect();
  expect(chevron?.getBoundingClientRect().right).toBeLessThanOrEqual(
    field.right,
  );
  expect(value.getBoundingClientRect().right).toBeLessThanOrEqual(
    chevron?.getBoundingClientRect().left ?? field.right,
  );
});
