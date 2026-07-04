// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen, waitFor } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    model_catalog: {
      queries: { getModelCapabilities: 'getModelCapabilities' },
    },
  },
}));

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: [] }),
}));

const saveConfigMock = vi.fn();
const configMock = vi.fn();
vi.mock('../../hooks/use-provider-config-context', () => ({
  useProviderConfig: () => ({
    config: configMock(),
    isSaving: false,
    saveConfig: saveConfigMock,
  }),
}));

vi.mock('../../hooks/mutations', () => ({
  useSaveProviderSecret: () => ({ mutateAsync: vi.fn() }),
  useFetchConfiguredProviderModels: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('../../utils/error-dispatch', () => ({
  dispatchForbiddenDeveloperSettings: () => false,
  dispatchInvalidProviderConfig: () => false,
  dispatchOrgAccessError: () => false,
  dispatchVersionConflict: () => false,
}));

import { ModelsSection } from './models-section';

// GPT-OSS 120B in the shipped catalog: $0.039/1M input tokens is stored as
// 3.9 cents — a sub-cent value the edit form must round-trip losslessly.
const subCentModel = {
  id: 'gpt-oss-120b',
  displayName: 'GPT-OSS 120B',
  tags: ['chat'] as const,
  cost: { inputCentsPerMillion: 3.9, outputCentsPerMillion: 18 },
};

function renderSection() {
  return render(
    <ModelsSection
      organizationId="org-1"
      providerName="openrouter"
      maskedModelKeys={{}}
      isLoading={false}
    />,
  );
}

async function openEdit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', {
      name: /^settings\.providers\.editModel$/,
    }),
  );
}

function getInputCostField() {
  return screen.getByRole('spinbutton', {
    name: /^settings\.providers\.inputCostLabel/,
  });
}

async function submitEdit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('button', { name: 'settings.providers.save' }),
  );
  await waitFor(() => expect(saveConfigMock).toHaveBeenCalledTimes(1));
  return saveConfigMock.mock.calls[0][0];
}

describe('ModelsSection sub-cent cost editing', () => {
  beforeEach(() => {
    saveConfigMock.mockReset();
    saveConfigMock.mockResolvedValue(undefined);
    configMock.mockReturnValue({
      displayName: 'OpenRouter',
      models: [{ ...subCentModel }],
    });
  });

  it('lets the cost inputs accept sub-cent values (step="any")', async () => {
    const { user } = renderSection();
    await openEdit(user);

    const field = getInputCostField();
    // Pre-filled from 3.9 cents → $0.039/1M, previously blocked by step=0.01.
    expect(field).toHaveValue(0.039);
    expect(field).toHaveAttribute('step', 'any');
  });

  it('round-trips a pre-filled sub-cent catalog cost without silent rounding', async () => {
    const { user } = renderSection();
    await openEdit(user);

    // Touch only the display name; the untouched 3.9-cent cost must survive
    // the save instead of snapping to 4 (the old Math.round behaviour).
    await user.type(
      screen.getByRole('textbox', {
        name: /^settings\.providers\.displayName/,
      }),
      ' v2',
    );

    const payload = await submitEdit(user);
    expect(payload.models[0].cost.inputCentsPerMillion).toBe(3.9);
    expect(payload.models[0].cost.outputCentsPerMillion).toBe(18);
  });

  it('saves a freshly entered sub-cent cost at full precision', async () => {
    const { user } = renderSection();
    await openEdit(user);

    const field = getInputCostField();
    await user.clear(field);
    await user.type(field, '0.005');

    const payload = await submitEdit(user);
    // $0.005/1M → 0.5 cents; step=0.01 would have rejected it outright.
    expect(payload.models[0].cost.inputCentsPerMillion).toBe(0.5);
  });
});
