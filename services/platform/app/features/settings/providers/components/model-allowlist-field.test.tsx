import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ModelAllowlistField } from './model-allowlist-field';

/**
 * The free-entry field keeps the reader's raw text (in-progress commas and
 * all), but what it shows must always be the list it holds — the list a Save
 * sends. A custom provider's form swaps ONE instance of this field between
 * free entry and the catalog picker, so the picker can change the list while
 * the free-entry draft is out of sight (#3664).
 */

function Harness({ initial }: { initial: string[] }) {
  const [freeText, setFreeText] = useState(true);
  const [value, setValue] = useState(initial);
  return (
    <>
      <button type="button" onClick={() => setFreeText((on) => !on)}>
        Switch source
      </button>
      <button type="button" onClick={() => setValue(['gamma'])}>
        Replace list
      </button>
      <ModelAllowlistField
        models={[]}
        freeText={freeText}
        value={value}
        onValueChange={setValue}
      />
      <output aria-label="Held list">{JSON.stringify(value)}</output>
    </>
  );
}

const field = () => screen.getByRole('textbox', { name: /^Model allowlist/ });
const held = () => screen.getByRole('status', { name: 'Held list' });

describe('ModelAllowlistField', () => {
  it('shows the list the picker left when it returns to free entry', async () => {
    const { container, user } = render(<Harness initial={['alpha', 'beta']} />);
    expect(field()).toHaveValue('alpha, beta');

    await user.click(screen.getByRole('button', { name: 'Switch source' }));
    await user.click(screen.getByRole('button', { name: 'Remove alpha' }));
    expect(held()).toHaveTextContent('["beta"]');
    await user.click(screen.getByRole('button', { name: 'Switch source' }));

    expect(field()).toHaveValue('beta');
    expect(held()).toHaveTextContent('["beta"]');
    await checkAccessibility(container);
  });

  it('keeps the reader’s draft, in-progress commas and all, while it holds the same list', async () => {
    const { user } = render(<Harness initial={[]} />);
    await user.type(field(), 'alpha, beta,');
    expect(field()).toHaveValue('alpha, beta,');
    expect(held()).toHaveTextContent('["alpha","beta"]');

    // A trip through the picker that changes nothing leaves the draft alone.
    await user.click(screen.getByRole('button', { name: 'Switch source' }));
    await user.click(screen.getByRole('button', { name: 'Switch source' }));
    expect(field()).toHaveValue('alpha, beta,');

    await user.type(field(), ' gamma');
    expect(field()).toHaveValue('alpha, beta, gamma');
    expect(held()).toHaveTextContent('["alpha","beta","gamma"]');
  });

  it('shows a list replaced from outside, then edits on from it', async () => {
    const { user } = render(<Harness initial={['alpha', 'beta']} />);
    await user.click(screen.getByRole('button', { name: 'Replace list' }));
    expect(field()).toHaveValue('gamma');

    await user.type(field(), ', delta');
    expect(field()).toHaveValue('gamma, delta');
    expect(held()).toHaveTextContent('["gamma","delta"]');
  });
});
