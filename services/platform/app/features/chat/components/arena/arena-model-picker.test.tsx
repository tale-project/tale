import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { ComposerModelOption } from '../../types';
import { ArenaModelPicker } from './arena-model-picker';

const MODELS: ComposerModelOption[] = [
  {
    id: 'mistral-large-latest',
    label: 'Mistral Large',
    providerSlug: 'mistral',
    credential: { authMethod: 'api-key' },
  },
  {
    id: 'mistral-small-latest',
    label: 'Mistral Small',
    providerSlug: 'mistral',
    credential: { authMethod: 'api-key' },
  },
];

const EU_NOTE =
  /Only models whose endpoint processes prompts in the EU\/EEA are offered/;

describe('ArenaModelPicker', () => {
  it.each([undefined, 'eu' as const])(
    'ends its menu with why the EU/EEA rule left models out, and says nothing while it is off (hidden by %s) [GOV-R22]',
    async (modelsHiddenBy) => {
      const { user } = render(
        <ArenaModelPicker
          models={MODELS}
          modelId="mistral-large-latest"
          onChange={vi.fn()}
          modelsHiddenBy={modelsHiddenBy}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Select model' }));
      await screen.findByRole('menuitem', { name: 'mistral · Mistral Small' });
      expect(screen.queryByText(EU_NOTE) !== null).toBe(
        modelsHiddenBy !== undefined,
      );
    },
  );

  it("names a model two providers offer by its provider, and checks only the column's own copy", async () => {
    const onChange = vi.fn();
    const { user } = render(
      <ArenaModelPicker
        models={[
          ...MODELS,
          {
            id: 'mistral-large-latest',
            label: 'Mistral Large',
            providerSlug: 'eu-gateway',
            providerLabel: 'EU Gateway',
            credential: { authMethod: 'api-key' },
          },
        ]}
        modelId="mistral-large-latest"
        providerSlug="eu-gateway"
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Select model' });
    expect(trigger).toHaveTextContent(/^EU Gateway · Mistral Large$/);
    await user.click(trigger);
    const own = await screen.findByRole('menuitem', {
      name: 'EU Gateway · Mistral Large',
    });
    const other = screen.getByRole('menuitem', {
      name: 'mistral · Mistral Large',
    });
    // Under its header, a row shows the model's own name.
    expect(screen.getByText('EU Gateway')).toBeInTheDocument();
    expect(own.querySelector('.lucide-check')).not.toBeNull();
    expect(other.querySelector('.lucide-check')).toBeNull();
    // Every row shows the model's own name under its provider, and reads
    // the provider to assistive technology, which hears no header.
    expect(
      screen.getByRole('menuitem', { name: 'mistral · Mistral Small' }),
    ).toHaveTextContent(/^Mistral Small/);

    await user.click(other);
    expect(onChange).toHaveBeenCalledWith('mistral-large-latest', 'mistral');
  });
});
