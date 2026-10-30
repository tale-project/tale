import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { ModelFactsField } from './model-facts-field';
import type { ModelFactsDraft } from './provider-definition-form';

/**
 * A provider without a model listing says what each of its models can take
 * here: one group per allowlisted id, named by the id, with the model's
 * context window and whether it reads images (#5073).
 */

function Harness({
  ids,
  initial = {},
}: {
  ids: string[];
  initial?: Record<string, ModelFactsDraft>;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ModelFactsField ids={ids} value={value} onValueChange={setValue} />
      <output aria-label="Held facts">{JSON.stringify(value)}</output>
    </>
  );
}

const model = (id: string) => screen.getByRole('group', { name: id });
const windowOf = (id: string) =>
  within(model(id)).getByRole('spinbutton', { name: /^Context window/ });
const imagesOf = (id: string) =>
  within(model(id)).getByRole('checkbox', { name: 'Reads images' });
const held = () => screen.getByRole('status', { name: 'Held facts' });

describe('ModelFactsField', () => {
  it('shows each allowlisted model with what its definition declares', async () => {
    const { container } = render(
      <Harness
        ids={['claude-sonnet-gw', 'claude-haiku-gw']}
        initial={{
          'claude-sonnet-gw': {
            contextWindow: '1000000',
            supportsVision: true,
          },
        }}
      />,
    );
    expect(
      screen.getByRole('group', { name: 'Model details' }),
    ).toHaveAccessibleDescription(
      'Leave a context window empty to assume 128,000 tokens. Mark the models that read images; the others are treated as text-only.',
    );
    expect(windowOf('claude-sonnet-gw')).toHaveValue(1_000_000);
    expect(imagesOf('claude-sonnet-gw')).toBeChecked();
    // Nothing declared reads as blank: the neutral assumption.
    expect(windowOf('claude-haiku-gw')).toHaveValue(null);
    expect(windowOf('claude-haiku-gw')).toHaveAttribute(
      'placeholder',
      '128000',
    );
    expect(imagesOf('claude-haiku-gw')).not.toBeChecked();
    await checkAccessibility(container);
  });

  it('holds what the reader types for one model, apart from the others', async () => {
    const { user } = render(
      <Harness ids={['claude-sonnet-gw', 'claude-haiku-gw']} />,
    );
    await user.type(windowOf('claude-haiku-gw'), '200000');
    await user.click(imagesOf('claude-sonnet-gw'));
    expect(JSON.parse(held().textContent ?? '')).toEqual({
      'claude-haiku-gw': { contextWindow: '200000', supportsVision: false },
      'claude-sonnet-gw': { contextWindow: '', supportsVision: true },
    });
  });

  it('says how to fix a window that is not a whole number of tokens', async () => {
    const { user } = render(<Harness ids={['claude-sonnet-gw']} />);
    await user.type(windowOf('claude-sonnet-gw'), '0');
    expect(windowOf('claude-sonnet-gw')).toBeInvalid();
    expect(
      within(model('claude-sonnet-gw')).getByText(
        'Enter a whole number of tokens, such as 200000.',
      ),
    ).toBeVisible();
    await user.clear(windowOf('claude-sonnet-gw'));
    await user.type(windowOf('claude-sonnet-gw'), '200000');
    expect(windowOf('claude-sonnet-gw')).toBeValid();
  });

  it('shows nothing before the allowlist names a model', () => {
    render(<Harness ids={[]} />);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
});
