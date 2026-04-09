import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { AgentJsonConfig } from '@/convex/agents/file_utils';

import {
  AgentConfigProvider,
  useAgentConfig,
} from './use-agent-config-context';

const BASE_CONFIG: AgentJsonConfig = {
  displayName: 'Assistant',
  description: 'General-purpose AI assistant',
  systemInstructions: 'You are a helpful AI assistant.',
  supportedModels: ['anthropic/claude-opus-4.6'],
  visibleInChat: true,
};

function createWrapper(config: AgentJsonConfig = BASE_CONFIG) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AgentConfigProvider agentName="test-agent" initialConfig={config}>
        {children}
      </AgentConfigProvider>
    );
  };
}

describe('useAgentConfig', () => {
  it('starts with initial config and not dirty', () => {
    const { result } = renderHook(() => useAgentConfig(), {
      wrapper: createWrapper(),
    });
    expect(result.current.config).toEqual(BASE_CONFIG);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.isSaving).toBe(false);
  });

  it('becomes dirty after updateConfig', () => {
    const { result } = renderHook(() => useAgentConfig(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.updateConfig({ visibleInChat: false });
    });

    expect(result.current.config.visibleInChat).toBe(false);
    expect(result.current.isDirty).toBe(true);
  });

  it('becomes dirty after setting delegates', () => {
    const { result } = renderHook(() => useAgentConfig(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.updateConfig({ delegates: ['web-assistant'] });
    });

    expect(result.current.config.delegates).toEqual(['web-assistant']);
    expect(result.current.isDirty).toBe(true);
  });

  it('markSaving does not reset dirty state', () => {
    const { result } = renderHook(() => useAgentConfig(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.updateConfig({ visibleInChat: false });
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.markSaving(true);
    });
    expect(result.current.isSaving).toBe(true);
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.markSaving(false);
    });
    expect(result.current.isSaving).toBe(false);
    // After failed save, config should still be dirty
    expect(result.current.isDirty).toBe(true);
  });

  it('markSaved resets dirty state', () => {
    const { result } = renderHook(() => useAgentConfig(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.updateConfig({ delegates: ['crm-assistant'] });
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.markSaved();
    });
    expect(result.current.isDirty).toBe(false);
  });

  it('remains dirty after save failure (markSaving without markSaved)', () => {
    const { result } = renderHook(() => useAgentConfig(), {
      wrapper: createWrapper(),
    });

    // Simulate: user toggles visibility
    act(() => {
      result.current.updateConfig({ visibleInChat: false });
    });
    expect(result.current.isDirty).toBe(true);

    // Simulate: save starts
    act(() => {
      result.current.markSaving(true);
    });

    // Simulate: save fails, markSaving(false) called in finally block
    act(() => {
      result.current.markSaving(false);
    });

    // Config should still be dirty so user can retry
    expect(result.current.isDirty).toBe(true);
    expect(result.current.config.visibleInChat).toBe(false);
  });

  it('becomes clean after successful save (markSaved then markSaving false)', () => {
    const { result } = renderHook(() => useAgentConfig(), {
      wrapper: createWrapper(),
    });

    // Simulate: user adds delegates
    act(() => {
      result.current.updateConfig({ delegates: ['web-assistant'] });
    });
    expect(result.current.isDirty).toBe(true);

    // Simulate: save starts
    act(() => {
      result.current.markSaving(true);
    });

    // Simulate: save succeeds
    act(() => {
      result.current.markSaved();
    });

    // Simulate: finally block
    act(() => {
      result.current.markSaving(false);
    });

    expect(result.current.isDirty).toBe(false);
    expect(result.current.isSaving).toBe(false);
    expect(result.current.config.delegates).toEqual(['web-assistant']);
  });

  it('resetConfig reverts to initial config', () => {
    const { result } = renderHook(() => useAgentConfig(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.updateConfig({ visibleInChat: false });
      result.current.updateConfig({ delegates: ['web-assistant'] });
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.resetConfig();
    });

    expect(result.current.config).toEqual(BASE_CONFIG);
    expect(result.current.isDirty).toBe(false);
  });
});
