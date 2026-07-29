// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ActiveEditorProvider,
  EditorActions,
  useActiveEditor,
} from '@/app/components/ui/editor';
import { cleanup, render, screen } from '@/tests/utils/render';

// `RunCodePolicyRoute` is created via `createFileRoute(...)`; stub the factory
// so we can pull the component off `Route.component` and render it without a
// router. `Route.useParams()` returns the org id the component reads.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ id: 'org-1' }),
    ...config,
  }),
}));

// Two distinct spies, because the two callers mean different things: the page
// reaches for `useToast()` while `EditorActions` (the header Save cluster)
// imports the module-level `toast`. Keeping them apart lets the suite assert
// that the page itself reports NOTHING and the cluster owns the one toast.
const { pageToast, clusterToast } = vi.hoisted(() => ({
  pageToast: vi.fn(),
  clusterToast: vi.fn(),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: pageToast }),
  toast: clusterToast,
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => true,
    cannot: () => false,
  }),
}));

// Mutable server-policy state, hoisted so the (hoisted) `vi.mock` factory below
// can read it. `config` is what the reactive `getPolicy` query returns.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: undefined as Record<string, unknown> | undefined,
  },
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: state.isLoading ? undefined : { config: state.config },
    isLoading: state.isLoading,
  }),
}));

// Controllable save mutation: each test sets `mutateAsync`'s behaviour.
const { mutation } = vi.hoisted(() => ({
  mutation: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('@/app/features/settings/governance/hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => mutation,
}));

let RunCodePolicyRoute: ComponentType;

beforeEach(async () => {
  state.isLoading = false;
  state.config = {
    defaultMode: 'allowlist',
    pythonAllow: ['numpy', 'pandas'],
    pythonDeny: [],
    nodeAllow: ['lodash'],
    nodeDeny: [],
  };
  mutation.mutateAsync = vi.fn().mockResolvedValue(undefined);
  pageToast.mockClear();
  clusterToast.mockClear();

  const mod =
    await import('@/app/routes/dashboard/$id/settings/governance/run-code-policy');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RunCodePolicyRoute = (mod.Route as any).component as ComponentType;
});

afterEach(() => {
  cleanup();
});

function pythonAllow() {
  return screen.getByRole('textbox', { name: 'Python allow list' });
}
function nodeAllow() {
  return screen.getByRole('textbox', { name: 'Node allow list' });
}

// The page docks Save/Discard in the settings header via the active-editor
// registry (no in-content Save button). Mirror the layout: render the route
// inside an ActiveEditorProvider with an EditorActions cluster reading it.
function HeaderCluster() {
  const controller = useActiveEditor();
  if (!controller) return null;
  return <EditorActions controller={controller} entityKind="settings" />;
}

function renderWithHeader() {
  return render(
    <ActiveEditorProvider>
      <HeaderCluster />
      <RunCodePolicyRoute />
    </ActiveEditorProvider>,
  );
}

describe('RunCodePolicyRoute', () => {
  it('renders the saved server values on the first loaded render', () => {
    // Regression for #2023: the form used to copy server state into `useState`
    // via `useEffect`, briefly showing the `denylist` / empty-string defaults.
    // It now reads `savedDraft` directly, so the server values are present.
    renderWithHeader();

    expect(pythonAllow()).toHaveValue('numpy\npandas');
    expect(nodeAllow()).toHaveValue('lodash');
    // The mode radio reflects the server value, not the `denylist` default.
    expect(screen.getByRole('radio', { name: /allowlist/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /denylist/i })).not.toBeChecked();
  });

  it('overrides only the edited field; other fields still mirror server state', async () => {
    const { user } = renderWithHeader();

    const field = pythonAllow();
    await user.clear(field);
    await user.type(field, 'requests');

    expect(field).toHaveValue('requests');
    // The untouched field keeps reading server state through the `edits` overlay.
    expect(nodeAllow()).toHaveValue('lodash');
  });

  it('clears edits on a successful save so the form re-reads server state', async () => {
    // On success the server canonicalises the value; the mutation updates the
    // reactive query's config. The form must drop its local `edits` (so it does
    // not keep showing the typed value) AND re-read the freshly-saved server
    // state (so it does not show the stale pre-edit value).
    mutation.mutateAsync = vi.fn().mockImplementation(async () => {
      state.config = {
        defaultMode: 'allowlist',
        pythonAllow: ['requests-canonical'],
        pythonDeny: [],
        nodeAllow: ['lodash'],
        nodeDeny: [],
      };
    });

    const { user } = renderWithHeader();

    await user.clear(pythonAllow());
    await user.type(pythonAllow(), 'requests');
    expect(pythonAllow()).toHaveValue('requests');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutation.mutateAsync).toHaveBeenCalledTimes(1);
    // Not 'requests' (edit cleared) and not 'numpy\npandas' (stale): the
    // freshly-saved server value wins.
    expect(pythonAllow()).toHaveValue('requests-canonical');
    // Success feedback is the cluster's "Saved" flash — the page adds nothing.
    expect(pageToast).not.toHaveBeenCalled();
    expect(clusterToast).not.toHaveBeenCalled();
  });

  it('preserves the user edits when the save fails', async () => {
    mutation.mutateAsync = vi.fn().mockRejectedValue(new Error('save failed'));

    const { user } = renderWithHeader();

    await user.clear(pythonAllow());
    await user.type(pythonAllow(), 'requests');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutation.mutateAsync).toHaveBeenCalledTimes(1);
    // The failed save keeps the user's in-progress edit so it isn't lost.
    expect(pythonAllow()).toHaveValue('requests');
    // Exactly one destructive toast, raised by the cluster from the translated
    // message the page threw — the page never toasts a failure itself.
    expect(pageToast).not.toHaveBeenCalled();
    expect(clusterToast).toHaveBeenCalledTimes(1);
    expect(clusterToast).toHaveBeenCalledWith({
      title: 'Save',
      description: 'Failed to update run-code package policy',
      variant: 'destructive',
    });
  });
});
