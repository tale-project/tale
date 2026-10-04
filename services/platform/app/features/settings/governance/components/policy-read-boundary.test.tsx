import { ActiveEditorProvider, useActiveEditor } from '@tale/ui/editor';
import { createPortal } from 'react-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { act, render, screen, waitFor } from '@/tests/utils/render';

import { usePolicyReadAvailable } from '../hooks/policy-read-access';
import { DsarPolicyEditor } from './dsar-policy-editor';
import { LoginPolicyEditor } from './login-policy-editor';
import { PasswordPolicyEditor } from './password-policy-editor';
import { withGovernancePolicyReadBoundary } from './policy-read-boundary';
import { RetentionEditor } from './retention-editor';
import { TwoFactorPolicyEditor } from './two-factor-policy-editor';
import { VoiceOutputPolicyEditor } from './voice-output-policy-editor';

const { state, mutateAsync, refetch } = vi.hoisted(() => ({
  state: {
    data: undefined as undefined | null | { config: Record<string, unknown> },
    isLoading: false,
    isError: true,
    isFetching: false,
  },
  mutateAsync: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));
vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({ ...state, refetch }),
  useDsarPolicyForUi: () => ({ ...state, refetch }),
}));

function SaveProbe() {
  const editor = useActiveEditor();
  return (
    <button
      disabled={!editor || editor.isLoading || !editor.isDirty}
      onClick={() => void editor?.save()}
    >
      Save
    </button>
  );
}

function Editor() {
  return (
    <ActiveEditorProvider>
      <SaveProbe />
      <PasswordPolicyEditor organizationId="org-1" />
    </ActiveEditorProvider>
  );
}

beforeEach(async () => {
  localStorage.setItem('user-locale', 'en');
  await i18n.changeLanguage('en');
  state.data = undefined;
  state.isLoading = false;
  state.isError = true;
  state.isFetching = false;
  vi.clearAllMocks();
});

describe('governance policy read safety', () => {
  it('closes portalled policy actions when a cached read fails', async () => {
    function PortalEditor() {
      const available = usePolicyReadAvailable();
      return available
        ? createPortal(<button>Portal write</button>, document.body)
        : null;
    }
    const PortalPolicy = withGovernancePolicyReadBoundary(
      PortalEditor,
      'password_policy',
    );
    state.data = { config: { minLength: 24 } };
    state.isError = false;
    const { rerender } = render(<PortalPolicy organizationId="org-1" />);
    expect(
      screen.getByRole('button', { name: 'Portal write' }),
    ).toBeInTheDocument();
    state.isError = true;
    rerender(<PortalPolicy organizationId="org-1" />);
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Portal write' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('preserves loaded values during a background refetch', () => {
    state.data = { config: { minLength: 24, rotationDays: 30 } };
    state.isError = false;
    const { rerender } = render(<Editor />);
    state.isFetching = true;
    rerender(<Editor />);
    expect(
      screen.getByRole('spinbutton', { name: /minimum.*length/i }),
    ).toHaveValue(24);
    expect(
      screen.getByRole('spinbutton', { name: /rotation.*days/i }),
    ).toHaveValue(30);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it.each([
    PasswordPolicyEditor,
    LoginPolicyEditor,
    VoiceOutputPolicyEditor,
    TwoFactorPolicyEditor,
    DsarPolicyEditor,
    RetentionEditor,
  ])(
    'blocks a failed policy read before mounting editable controls (%#)',
    (PolicyEditor) => {
      render(<PolicyEditor organizationId="org-1" />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
      expect(screen.queryAllByRole('switch')).toHaveLength(0);
      expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
      expect(screen.queryAllByRole('textbox')).toHaveLength(0);
      expect(mutateAsync).not.toHaveBeenCalled();
    },
  );

  it('keeps a failed retry actionable without exposing controls', async () => {
    refetch.mockResolvedValue({ isError: true });
    const { user } = render(<Editor />);
    const retry = screen.getByRole('button', { name: 'Retry' });
    await user.click(retry);
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
  it.each([
    ['en', 'Retry', "Couldn't load the saved policy"],
    [
      'de',
      'Erneut versuchen',
      'Die gespeicherte Richtlinie konnte nicht geladen werden',
    ],
    ['fr', 'Réessayer', 'Impossible de charger la politique enregistrée'],
  ])(
    'provides localized error recovery in %s',
    async (locale, retry, message) => {
      await i18n.changeLanguage(locale);
      localStorage.setItem('user-locale', locale);
      render(<Editor />);
      expect(screen.getByRole('alert')).toHaveTextContent(message);
      expect(screen.getByRole('button', { name: retry })).toBeEnabled();
    },
  );
  it('does not expose editable defaults after an initial failed read', () => {
    render(<Editor />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('uses defaults only after a successful absent policy response', () => {
    state.data = null;
    state.isError = false;
    render(<Editor />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton')).toHaveValue(12);
    expect(screen.getAllByRole('switch')).toHaveLength(5);
  });

  it('hides cached controls and disables Save without losing an unsaved draft', async () => {
    state.data = { config: { minLength: 24 } };
    state.isError = false;
    const { user, rerender } = render(<Editor />);
    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '32');
    expect(input).toHaveValue(32);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    state.isError = true;
    rerender(<Editor />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    state.isError = false;
    rerender(<Editor />);
    expect(screen.getByRole('spinbutton')).toHaveValue(32);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('retains Retry focus and blocks writes during retry, then shows the real policy', async () => {
    let finishRetry: () => void = () => {};
    refetch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRetry = resolve;
        }),
    );
    const { user, rerender } = render(<Editor />);
    const retry = screen.getByRole('button', { name: 'Retry' });
    await user.click(retry);
    expect(refetch).toHaveBeenCalledOnce();
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    state.isLoading = true;
    state.isError = false;
    rerender(<Editor />);
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    state.data = { config: { minLength: 24, rotationDays: 30 } };
    state.isLoading = false;
    await act(async () => finishRetry());
    rerender(<Editor />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getByRole('spinbutton', { name: /minimum.*length/i }),
    ).toHaveValue(24);
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(document.activeElement).toContainElement(
      screen.getByRole('spinbutton', { name: /minimum.*length/i }),
    );
    await user.click(screen.getAllByRole('switch')[0]);
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ minLength: 24, rotationDays: 30 }),
        }),
      ),
    );
  });
});
