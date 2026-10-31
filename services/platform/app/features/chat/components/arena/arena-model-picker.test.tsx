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
      await screen.findByRole('menuitem', { name: 'Mistral Small' });
      expect(screen.queryByText(EU_NOTE) !== null).toBe(
        modelsHiddenBy !== undefined,
      );
    },
  );
});
