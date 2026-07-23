// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

// Per-test preference row: `undefined` means the user has made no explicit
// choice and follows the org default.
let preferences: {
  customInstructions?: string;
  customInstructionsEnabled?: boolean;
  memoriesEnabled?: boolean;
} | null = null;
let policyEnabled = false;

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: preferences, isLoading: false }),
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: { config: { enabled: policyEnabled } },
    isLoading: false,
  }),
}));

const setCustomInstructionsEnabled = vi.fn().mockResolvedValue(undefined);
const setMemoriesEnabled = vi.fn().mockResolvedValue(undefined);
const upsert = vi.fn().mockResolvedValue(undefined);

vi.mock('../hooks/mutations', () => ({
  useSetCustomInstructionsEnabled: () => ({
    mutateAsync: setCustomInstructionsEnabled,
    isPending: false,
  }),
  useSetMemoriesEnabled: () => ({
    mutateAsync: setMemoriesEnabled,
    isPending: false,
  }),
  useUpsertMyPreferences: () => ({ mutateAsync: upsert, isPending: false }),
}));

import { PreferencesSettings } from './preferences-settings';

function renderPage() {
  return render(<PreferencesSettings organizationId="org-1" />);
}

beforeEach(() => {
  preferences = null;
  policyEnabled = false;
  vi.clearAllMocks();
});

describe('PreferencesSettings', () => {
  it('offers no voice-output entry — reading aloud is a composer mode', () => {
    preferences = { customInstructionsEnabled: true, memoriesEnabled: true };
    renderPage();

    expect(screen.queryByText(/voice output/i)).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });

  it('renders the custom-instructions field inline under its own section', () => {
    preferences = {
      customInstructionsEnabled: true,
      customInstructions: 'Be terse.',
    };
    renderPage();

    const field = screen.getByRole('textbox', {
      name: 'Custom instructions',
    });
    expect(field).toHaveValue('Be terse.');
    expect(field).toBeEnabled();
  });

  it('keeps the field visible but inert while the feature is off', () => {
    preferences = {
      customInstructionsEnabled: false,
      customInstructions: 'Be terse.',
    };
    renderPage();

    expect(
      screen.getByRole('textbox', { name: 'Custom instructions' }),
    ).toBeDisabled();
  });

  it('follows the org default when the user has made no choice', () => {
    preferences = null;
    policyEnabled = true;
    renderPage();

    expect(
      screen.getByRole('switch', { name: 'Custom instructions' }),
    ).toBeChecked();
    expect(
      screen.getAllByText(/Following organization default/).length,
    ).toBeGreaterThan(0);
  });

  it('says it is overriding the org default once the user chooses', () => {
    preferences = { customInstructionsEnabled: false };
    policyEnabled = true;
    renderPage();

    expect(
      screen.getByRole('switch', { name: 'Custom instructions' }),
    ).not.toBeChecked();
    expect(
      screen.getAllByText(/Overriding organization default/).length,
    ).toBeGreaterThan(0);
  });

  it('turns the feature on through its section switch', async () => {
    preferences = { memoriesEnabled: false };
    const { user } = renderPage();

    await user.click(screen.getByRole('switch', { name: 'Memories' }));

    expect(setMemoriesEnabled).toHaveBeenCalledWith({
      organizationId: 'org-1',
      enabled: true,
    });
  });

  it('saves the custom instructions the user typed', async () => {
    preferences = { customInstructionsEnabled: true, customInstructions: '' };
    const { user } = renderPage();

    await user.type(
      screen.getByRole('textbox', { name: 'Custom instructions' }),
      'Reply in French.',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(upsert).toHaveBeenCalledWith({
      organizationId: 'org-1',
      customInstructions: 'Reply in French.',
    });
  });

  it('renders the memory lists inline under the memories section', () => {
    preferences = { memoriesEnabled: true };
    renderPage();

    expect(screen.getByText('Pending suggestions')).toBeInTheDocument();
    expect(screen.getAllByText('Saved memories').length).toBeGreaterThan(0);
  });

  it('passes an axe audit', async () => {
    preferences = { customInstructionsEnabled: true, memoriesEnabled: true };
    const { container } = renderPage();
    await waitFor(() => checkAccessibility(container));
  });
});
