import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { RadioGroup } from './radio-group';

// Real-Chromium coverage for the roving-tabindex keyboard contract a WAI-ARIA
// radiogroup must honour: focus one radio, press an arrow, and selection moves
// to the sibling. The platform `RadioGroup` delegates this to Radix
// `RadioGroupPrimitive`, so this guards against a future swap to a hand-rolled
// set of radios that would silently drop arrow-key navigation (the run-code
// governance "Default Mode" picker is the canonical consumer).
//
// A native `keydown` is dispatched rather than `userEvent.keyboard('{ArrowDown}')`
// because the latter does not drive Radix's RovingFocusGroup handler under the
// vitest browser runner; a native event is exactly what a physical arrow press
// emits. The `browser` project ships no setup file, so cleanup is explicit.
afterEach(cleanup);

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pressArrowDownFrom(radio: HTMLElement) {
  radio.focus();
  await tick(10);
  radio.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      code: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    }),
  );
  await tick(60);
}

describe('RadioGroup keyboard navigation', () => {
  it('moves selection to the next option on ArrowDown', async () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup
        value="denylist"
        onValueChange={onValueChange}
        options={[
          { value: 'denylist', label: 'Denylist' },
          { value: 'allowlist', label: 'Allowlist' },
        ]}
      />,
    );

    await pressArrowDownFrom(screen.getByRole('radio', { name: /Denylist/ }));

    expect(onValueChange).toHaveBeenCalledWith('allowlist');
  });

  it('wraps from the last option back to the first on ArrowDown', async () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup
        value="allowlist"
        onValueChange={onValueChange}
        options={[
          { value: 'denylist', label: 'Denylist' },
          { value: 'allowlist', label: 'Allowlist' },
        ]}
      />,
    );

    await pressArrowDownFrom(screen.getByRole('radio', { name: /Allowlist/ }));

    expect(onValueChange).toHaveBeenCalledWith('denylist');
  });
});
