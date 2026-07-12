// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen, waitFor, within } from '@testing-library/react';
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

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'org-1' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/' }),
  useRouter: () => ({}),
}));

const saveProviderMock = vi.fn();
const saveSecretMock = vi.fn();
const fetchModelsMock = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useSaveProvider: () => ({ mutateAsync: saveProviderMock }),
  useSaveProviderSecret: () => ({ mutateAsync: saveSecretMock }),
  useFetchProviderModels: () => ({
    mutateAsync: fetchModelsMock,
    isPending: false,
  }),
}));

vi.mock('../utils/error-dispatch', () => ({
  dispatchOrgAccessError: () => false,
  readConvexErrorData: () => undefined,
}));

// Synced-catalog rows the picker offers (#2655). `catalogRows` is mutable so a
// test can empty it and assert the picker hides on catalog-less orgs.
const OPUS_ROW = {
  modelId: 'anthropic/claude-opus-4',
  source: 'openrouter',
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
  inputCentsPerMillion: 1500,
  outputCentsPerMillion: 7500,
  reasoning: { knob: 'budgetTokens', minBudgetTokens: 1024 },
  promptCaching: { mode: 'explicit-breakpoints', maxBreakpoints: 4 },
};
let catalogRows: unknown[] = [];
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: (_fn: unknown, args: unknown) => ({
    data: args === 'skip' ? undefined : catalogRows,
  }),
}));

import { ProviderAddPanel } from './provider-add-panel';

function renderPanel() {
  return render(
    <ProviderAddPanel open onOpenChange={vi.fn()} organizationId="org-1" />,
  );
}

function getInput(label: RegExp) {
  return screen.getByRole('textbox', { name: label });
}

describe('ProviderAddPanel', () => {
  beforeEach(() => {
    saveProviderMock.mockReset().mockResolvedValue(undefined);
    saveSecretMock.mockReset().mockResolvedValue(undefined);
    fetchModelsMock.mockReset().mockResolvedValue([]);
    catalogRows = [
      OPUS_ROW,
      { modelId: 'openai/gpt-4o', source: 'openrouter', supportsTools: true },
    ];
  });

  it('prefills name, display name, and base URL from a known-provider preset (#2655)', async () => {
    const { user } = renderPanel();

    await user.click(screen.getByRole('radio', { name: 'OpenAI' }));
    expect(getInput(/^settings\.providers\.name\b/i)).toHaveValue('openai');
    expect(getInput(/^settings\.providers\.displayName\b/i)).toHaveValue(
      'OpenAI',
    );
    expect(getInput(/^settings\.providers\.baseUrl\b/i)).toHaveValue(
      'https://api.openai.com/v1',
    );

    // Hand-editing the name truthfully flips the derived selection to Custom.
    await user.type(getInput(/^settings\.providers\.name\b/i), 'x');
    expect(
      screen.getByRole('radio', { name: /providers\.presetCustom/i }),
    ).toBeChecked();

    // Picking Custom explicitly blanks the preset-filled fields again.
    await user.click(screen.getByRole('radio', { name: 'Anthropic' }));
    await user.click(
      screen.getByRole('radio', { name: /providers\.presetCustom/i }),
    );
    expect(getInput(/^settings\.providers\.name\b/i)).toHaveValue('');
    expect(getInput(/^settings\.providers\.baseUrl\b/i)).toHaveValue('');
    expect(getInput(/^settings\.providers\.displayName\b/i)).toHaveValue('');
  });

  it('creates a preset provider with only an API key + a catalog-picked model, copying capabilities', async () => {
    const { user } = renderPanel();

    await user.click(screen.getByRole('radio', { name: 'Anthropic' }));
    await user.type(
      screen.getByLabelText(/^settings\.providers\.apiKey\b/i),
      'sk-test',
    );

    // Add a model through the catalog picker.
    await user.click(
      screen.getByRole('button', { name: /^settings\.providers\.addModel$/i }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', {
        name: /providers\.catalogPickerLabel/i,
      }),
    );
    await user.click(
      await screen.findByRole('option', { name: /anthropic\/claude-opus-4/i }),
    );
    // The pick fills the ID and defaults the display name — both stay editable.
    expect(
      within(dialog).getByLabelText(/^settings\.providers\.modelId\b/i),
    ).toHaveValue('anthropic/claude-opus-4');
    expect(
      within(dialog).getByLabelText(/^settings\.providers\.displayName\b/i),
    ).toHaveValue('anthropic/claude-opus-4');
    await user.click(
      within(dialog).getByRole('button', {
        name: /^settings\.providers\.addModel$/i,
      }),
    );

    await user.click(
      screen.getByRole('button', {
        name: /^settings\.providers\.addProvider$/i,
      }),
    );

    await waitFor(() => expect(saveProviderMock).toHaveBeenCalledTimes(1));
    expect(saveSecretMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerName: 'anthropic', apiKey: 'sk-test' }),
    );
    const call = saveProviderMock.mock.calls[0][0];
    expect(call.providerName).toBe('anthropic');
    expect(call.config.baseUrl).toBe('https://api.anthropic.com/v1');
    // No apiFormat: standard gateway slugs reject it server-side.
    expect(call.config.apiFormat).toBeUndefined();
    expect(call.config.models).toHaveLength(1);
    expect(call.config.models[0]).toMatchObject({
      id: 'anthropic/claude-opus-4',
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      cost: { inputCentsPerMillion: 1500, outputCentsPerMillion: 7500 },
      reasoning: { knob: 'budgetTokens', minBudgetTokens: 1024 },
      promptCaching: { mode: 'explicit-breakpoints', maxBreakpoints: 4 },
    });
    // The transient wrapper never leaks into the saved config.
    expect(call.config.models[0].catalog).toBeUndefined();
  });

  it('drops the catalog capabilities when the ID is hand-edited after a pick', async () => {
    const { user } = renderPanel();

    await user.click(screen.getByRole('radio', { name: 'Anthropic' }));
    await user.type(
      screen.getByLabelText(/^settings\.providers\.apiKey\b/i),
      'sk-test',
    );

    await user.click(
      screen.getByRole('button', { name: /^settings\.providers\.addModel$/i }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', {
        name: /providers\.catalogPickerLabel/i,
      }),
    );
    await user.click(
      await screen.findByRole('option', { name: /anthropic\/claude-opus-4/i }),
    );
    // The escape hatch: a hand-edited ID is a custom model.
    await user.type(
      within(dialog).getByLabelText(/^settings\.providers\.modelId\b/i),
      '-tuned',
    );
    await user.click(
      within(dialog).getByRole('button', {
        name: /^settings\.providers\.addModel$/i,
      }),
    );

    await user.click(
      screen.getByRole('button', {
        name: /^settings\.providers\.addProvider$/i,
      }),
    );

    await waitFor(() => expect(saveProviderMock).toHaveBeenCalledTimes(1));
    const model = saveProviderMock.mock.calls[0][0].config.models[0];
    expect(model.id).toBe('anthropic/claude-opus-4-tuned');
    expect(model.contextWindow).toBeUndefined();
    expect(model.cost).toBeUndefined();
  });

  it('keeps the fully-manual path unchanged (no preset, typed model ID)', async () => {
    catalogRows = [];
    const { user } = renderPanel();

    expect(
      screen.getByRole('radio', { name: /providers\.presetCustom/i }),
    ).toBeChecked();

    await user.type(getInput(/^settings\.providers\.name\b/i), 'my-vllm');
    await user.type(
      getInput(/^settings\.providers\.displayName\b/i),
      'My vLLM',
    );
    await user.type(
      getInput(/^settings\.providers\.baseUrl\b/i),
      'https://llm.internal.example/v1',
    );
    await user.type(
      screen.getByLabelText(/^settings\.providers\.apiKey\b/i),
      'sk-local',
    );

    await user.click(
      screen.getByRole('button', { name: /^settings\.providers\.addModel$/i }),
    );
    const dialog = await screen.findByRole('dialog');
    // No synced catalog → no picker; the manual fields are all there is.
    expect(
      within(dialog).queryByRole('button', {
        name: /providers\.catalogPickerLabel/i,
      }),
    ).not.toBeInTheDocument();
    await user.type(
      within(dialog).getByLabelText(/^settings\.providers\.modelId\b/i),
      'llama-3-70b',
    );
    await user.type(
      within(dialog).getByLabelText(/^settings\.providers\.displayName\b/i),
      'Llama 3 70B',
    );
    await user.click(
      within(dialog).getByRole('button', {
        name: /^settings\.providers\.addModel$/i,
      }),
    );

    await user.click(
      screen.getByRole('button', {
        name: /^settings\.providers\.addProvider$/i,
      }),
    );

    await waitFor(() => expect(saveProviderMock).toHaveBeenCalledTimes(1));
    const call = saveProviderMock.mock.calls[0][0];
    expect(call.providerName).toBe('my-vllm');
    expect(call.config.baseUrl).toBe('https://llm.internal.example/v1');
    expect(call.config.models[0]).toEqual({
      id: 'llama-3-70b',
      displayName: 'Llama 3 70B',
      tags: ['chat'],
    });
  });
});
