import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { NewAutomationDialog } from './new-automation-dialog';

const mockMutate = vi.fn();
const mockNavigate = vi.fn();

/** Per-test knobs the hook mocks read. */
let catalogData: Array<{
  name: string;
  displayName: string;
  models: Array<{ id: string; tags: string[] }>;
}>;
let credentialsData: Array<{ providerSlug: string; authMethod: string }>;
let sessionData:
  | {
      status: string;
      reason?: string;
      saved?: { name: string; version: number };
    }
  | undefined;

vi.mock('../hooks/queries', () => ({
  useBuilderModelCatalog: () => ({
    data: catalogData,
    isPending: false,
    isError: false,
    error: null,
  }),
  useBuilderCredentials: () => ({ data: credentialsData }),
}));

vi.mock('../hooks/mutations', () => ({
  useStartBuilderSession: () => ({
    mutate: mockMutate,
    isPending: false,
    isError: false,
    error: null,
    data: sessionData,
    reset: vi.fn(),
  }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mockNavigate,
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const ONE_PROVIDER = [
  {
    name: 'anthropic',
    displayName: 'Anthropic',
    models: [{ id: 'claude-sonnet-5', tags: ['chat'] }],
  },
];
const ONE_CREDENTIAL = [{ providerSlug: 'anthropic', authMethod: 'api-key' }];

async function openDialog() {
  await userEvent.click(screen.getByTestId('new-automation'));
  return screen.getByRole('dialog', { name: 'New automation' });
}

describe('NewAutomationDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    catalogData = ONE_PROVIDER;
    credentialsData = ONE_CREDENTIAL;
    sessionData = undefined;
  });

  it('opens from its trigger, auto-picks a lone provider and model, and passes axe', async () => {
    const { container } = render(
      <NewAutomationDialog organizationId="org-1" />,
    );

    await openDialog();
    // The single usable provider/model need no picking.
    expect(
      screen.getByRole('combobox', { name: 'AI provider' }),
    ).toHaveTextContent('Anthropic');
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent(
      'claude-sonnet-5',
    );
    await checkAccessibility(container);
  });

  it('starts a session from the goal and navigates to the authored automation', async () => {
    mockMutate.mockImplementation(
      (
        _args: unknown,
        options?: { onSuccess?: (outcome: unknown) => void },
      ) => {
        options?.onSuccess?.({
          status: 'succeeded',
          saved: { name: 'billing/dunning', version: 1 },
          turns: 3,
          restarts: 0,
          usage: { prompt: 1, completion: 1 },
          steps: [],
        });
      },
    );
    render(<NewAutomationDialog organizationId="org-1" />);

    await openDialog();
    await userEvent.type(
      screen.getByLabelText('Goal'),
      'Summarize new support emails every morning',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Start building' }),
    );

    expect(mockMutate).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        goal: 'Summarize new support emails every morning',
        model: { providerSlug: 'anthropic', modelId: 'claude-sonnet-5' },
      },
      expect.anything(),
    );
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/automations/$automationSlug',
      params: { id: 'org-1', automationSlug: 'billing__dunning' },
    });
  });

  it('keeps a gave-up session on screen with the builder’s reason', async () => {
    sessionData = { status: 'gave-up', reason: 'the tests never passed' };
    render(<NewAutomationDialog organizationId="org-1" />);

    await openDialog();
    expect(screen.getByText(/the tests never passed/)).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('says when no provider credential can serve the builder', async () => {
    credentialsData = [];
    render(<NewAutomationDialog organizationId="org-1" />);

    await openDialog();
    expect(
      screen.getByText(/No AI provider is ready for the builder/),
    ).toBeInTheDocument();
  });
});
