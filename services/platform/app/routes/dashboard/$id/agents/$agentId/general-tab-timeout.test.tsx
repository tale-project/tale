// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// Regression coverage for #2065: the execution-timeout input used to be a
// one-shot `useState` mirror of `config.timeoutMs` that latched the first value
// forever. A History/Restore (`overrideConfig`) advanced the config but the
// input kept showing the stale value, and a later blur of the unedited field
// re-marked the form dirty and clobbered the restored value. The field now
// derives its display from `config.timeoutMs` directly.

const { mockUseParams } = vi.hoisted(() => ({
  mockUseParams: () => ({ id: 'org-1', agentId: 'agent-1' }),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: mockUseParams,
    ...config,
  }),
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));

vi.mock('@/app/features/agents/hooks/mutations', () => ({
  useUpdateAgentBindings: () => ({ mutateAsync: vi.fn() }),
  useUpdateAgentSharing: () => ({ mutateAsync: vi.fn() }),
  useTranslateAgentFields: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/app/features/agents/hooks/queries', () => ({
  useAgentBinding: () => ({ data: null }),
}));

vi.mock('@/app/features/organization/hooks/queries', () => ({
  useOrganization: () => ({ data: null }),
}));

vi.mock('@/app/hooks/use-team-filter', () => ({
  useTeamFilter: () => ({ teams: [] }),
}));

vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

import {
  AgentConfigProvider,
  useAgentConfig,
} from '@/app/features/agents/hooks/use-agent-config-context';

import { Route } from './index';

// The router-mock above replaces `createFileRoute` so `Route` is the plain
// config object (component included); the real Route type doesn't expose it.
const GeneralTab = (Route as unknown as { component: () => React.ReactElement })
  .component;

// Captures the live config context so the test can drive `overrideConfig`
// (the restore path) and assert `isDirty` the way the Save bar does.
let ctx: ReturnType<typeof useAgentConfig> | null = null;
function CaptureConfig() {
  ctx = useAgentConfig();
  return null;
}
function getCtx() {
  if (!ctx) throw new Error('config context was not captured');
  return ctx;
}

function renderGeneralTab(timeoutMs: number) {
  ctx = null;
  return render(
    <AgentConfigProvider
      agentName="agent-1"
      initialConfig={{ supportedModels: [], timeoutMs }}
    >
      <CaptureConfig />
      <GeneralTab />
    </AgentConfigProvider>,
  );
}

const timeoutInput = () => screen.getByRole<HTMLInputElement>('spinbutton');

afterEach(() => {
  cleanup();
});

describe('GeneralTab execution-timeout input (#2065)', () => {
  it('rehydrates from config when a restore overrides timeoutMs', () => {
    renderGeneralTab(7 * 60_000);
    expect(timeoutInput().value).toBe('7');

    // Simulate History/Restore: overrideConfig advances both working copy and
    // baseline to the snapshot value.
    act(() =>
      getCtx().overrideConfig({ supportedModels: [], timeoutMs: 12 * 60_000 }),
    );

    expect(timeoutInput().value).toBe('12');
    expect(getCtx().isDirty).toBe(false);
  });

  it('does not re-mark dirty or revert when an unedited field is blurred', () => {
    renderGeneralTab(7 * 60_000);

    act(() =>
      getCtx().overrideConfig({ supportedModels: [], timeoutMs: 12 * 60_000 }),
    );
    expect(getCtx().isDirty).toBe(false);

    // Focus + blur without typing — the classic stale-mirror revert trigger.
    fireEvent.focus(timeoutInput());
    fireEvent.blur(timeoutInput());

    expect(getCtx().isDirty).toBe(false);
    expect(timeoutInput().value).toBe('12');
    expect(getCtx().config.timeoutMs).toBe(12 * 60_000);
  });

  it('commits an edited value into config and marks dirty', () => {
    renderGeneralTab(7 * 60_000);

    fireEvent.change(timeoutInput(), { target: { value: '15' } });

    expect(timeoutInput().value).toBe('15');
    expect(getCtx().config.timeoutMs).toBe(15 * 60_000);
    expect(getCtx().isDirty).toBe(true);
  });
});
