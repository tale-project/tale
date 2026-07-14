// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

// Regression coverage for #2678: Display name / Description mapped an empty
// input to `undefined` in i18n[locale], and the rendered value then fell back
// to the legacy top-level field — so select-all+delete visibly snapped back to
// the old value and retyped text concatenated onto it. The cleared state is
// now staged verbatim (empty string included); empties are stripped at the
// write boundary (normalizeAgentConfig I-2), not while typing.
// Also #2682: the Agent-type radio group exposed no accessible name.

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

const GeneralTab = (Route as unknown as { component: () => React.ReactElement })
  .component;

let ctx: ReturnType<typeof useAgentConfig> | null = null;
function CaptureConfig() {
  ctx = useAgentConfig();
  return null;
}
function getCtx() {
  if (!ctx) throw new Error('config context was not captured');
  return ctx;
}

function renderGeneralTab() {
  ctx = null;
  return render(
    <AgentConfigProvider
      agentName="agent-1"
      initialConfig={{
        supportedModels: [],
        displayName: 'E2E Assistant',
        description: 'Legacy description',
      }}
    >
      <CaptureConfig />
      <GeneralTab />
    </AgentConfigProvider>,
  );
}

// The two fields carry stable ids; accessible-name queries would couple the
// test to message loading, and the page has several textboxes.
function fieldById(container: HTMLElement, id: string) {
  const el = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `#${id}`,
  );
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

afterEach(() => {
  cleanup();
});

describe('GeneralTab display name / description clear-then-retype (#2678)', () => {
  it('clearing the display name leaves it visibly empty and retyping replaces instead of appending', () => {
    const { container } = renderGeneralTab();
    const input = fieldById(container, 'displayName');
    expect(input.value).toBe('E2E Assistant');

    // Select-all + delete: the controlled value must represent the cleared
    // state, not resurrect the legacy fallback.
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    expect(getCtx().config.i18n?.en?.displayName).toBe('');

    fireEvent.change(input, { target: { value: 'QAX' } });
    expect(input.value).toBe('QAX');
    expect(getCtx().config.i18n?.en?.displayName).toBe('QAX');
  });

  it('description shares the same path', () => {
    const { container } = renderGeneralTab();
    const textarea = fieldById(container, 'description');
    expect(textarea.value).toBe('Legacy description');

    fireEvent.change(textarea, { target: { value: '' } });
    expect(textarea.value).toBe('');

    fireEvent.change(textarea, { target: { value: 'New copy' } });
    expect(textarea.value).toBe('New copy');
    expect(getCtx().config.i18n?.en?.description).toBe('New copy');
  });
});

describe('Agent-type radio group accessible name (#2682)', () => {
  it('exposes an accessible name on role=radiogroup', () => {
    renderGeneralTab();
    expect(screen.getByRole('radiogroup')).toHaveAccessibleName();
  });
});
