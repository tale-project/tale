// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ActiveEditorProvider,
  useActiveEditor,
  type EditorController,
} from '@/app/components/ui/editor';
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

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: preferences, isLoading: false }),
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
const reviewMemory = vi.fn().mockResolvedValue(true);
const deleteMemory = vi.fn().mockResolvedValue(true);

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
  useReviewMemory: () => ({ mutateAsync: reviewMemory, isPending: false }),
  useDeleteMemory: () => ({ mutateAsync: deleteMemory, isPending: false }),
}));

// The memories read: a proposal waiting and a memory already saved.
let memories: {
  pending: { id: string; content: string }[];
  approved: { id: string; content: string }[];
} = { pending: [], approved: [] };

vi.mock('@/app/features/chat/data/chat-backend', () => ({
  useChatMemories: () => ({ status: 'ready', data: memories }),
}));

import { PreferencesSettings } from './preferences-settings';

function renderPage() {
  return render(<PreferencesSettings organizationId="org-1" />);
}

beforeEach(() => {
  preferences = null;
  policyEnabled = false;
  memories = { pending: [], approved: [] };
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

  it('hides the field while the feature is off — a section toggle removes its content', () => {
    preferences = {
      customInstructionsEnabled: false,
      customInstructions: 'Be terse.',
    };
    renderPage();

    expect(
      screen.queryByRole('textbox', { name: 'Custom instructions' }),
    ).toBeNull();
    // The switch still says what the stored state is, so turning the feature
    // back on brings the saved text with it.
    expect(
      screen.getByRole('switch', { name: 'Custom instructions' }),
    ).not.toBeChecked();
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

  it('saves the custom instructions the user typed through the global save bar', async () => {
    preferences = { customInstructionsEnabled: true, customInstructions: '' };
    const capture = { current: null as EditorController | null };
    function ActiveProbe() {
      capture.current = useActiveEditor();
      return null;
    }
    const { user } = render(
      <ActiveEditorProvider>
        <ActiveProbe />
        <PreferencesSettings organizationId="org-1" />
      </ActiveEditorProvider>,
    );

    await user.type(
      screen.getByRole('textbox', { name: 'Custom instructions' }),
      'Reply in French.',
    );

    expect(capture.current?.isDirty).toBe(true);
    await act(async () => {
      await capture.current?.save();
    });

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

  it('saves or discards a pending suggestion — the person decides', async () => {
    preferences = { memoriesEnabled: true };
    memories = {
      pending: [{ id: 'mem_1', content: 'Prefers metric units' }],
      approved: [],
    };
    const { user } = renderPage();

    await user.click(
      screen.getByRole('button', {
        name: 'Save suggestion: Prefers metric units',
      }),
    );
    expect(reviewMemory).toHaveBeenCalledWith({
      organizationId: 'org-1',
      memoryId: 'mem_1',
      decision: 'approved',
    });

    await user.click(
      screen.getByRole('button', {
        name: 'Discard suggestion: Prefers metric units',
      }),
    );
    expect(reviewMemory).toHaveBeenCalledWith({
      organizationId: 'org-1',
      memoryId: 'mem_1',
      decision: 'rejected',
    });
  });

  it('deletes a saved memory from its row', async () => {
    preferences = { memoriesEnabled: true };
    memories = {
      pending: [],
      approved: [{ id: 'mem_2', content: 'Works in Berlin' }],
    };
    const { user } = renderPage();

    await user.click(
      screen.getByRole('button', { name: 'Delete memory: Works in Berlin' }),
    );
    expect(deleteMemory).toHaveBeenCalledWith({
      organizationId: 'org-1',
      memoryId: 'mem_2',
    });
  });

  it('passes an axe audit', async () => {
    preferences = { customInstructionsEnabled: true, memoriesEnabled: true };
    memories = {
      pending: [{ id: 'mem_1', content: 'Prefers metric units' }],
      approved: [{ id: 'mem_2', content: 'Works in Berlin' }],
    };
    const { container } = renderPage();
    await waitFor(() => checkAccessibility(container));
  });
});
