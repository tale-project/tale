// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSetUrlState = vi.fn();
let mockUrlState: Record<string, string | null> = { view: null };

vi.mock('@/app/hooks/use-url-state', () => ({
  useUrlState: () => ({
    state: mockUrlState,
    setState: mockSetUrlState,
    setStates: vi.fn(),
    clearState: vi.fn(),
    clearAll: vi.fn(),
    isPending: false,
  }),
}));

const { useWorkflowEditorView } = await import('./use-editor-view');

function clearCookie() {
  document.cookie = 'workflow-editor-view=; path=/; max-age=0';
}

beforeEach(() => {
  mockUrlState = { view: null };
  mockSetUrlState.mockClear();
  clearCookie();
});

describe('useWorkflowEditorView', () => {
  it('defaults to graph with no cookie and no URL override', () => {
    const { result } = renderHook(() => useWorkflowEditorView());
    expect(result.current[0]).toBe('graph');
  });

  it('reads a previously saved cookie synchronously on first render', () => {
    document.cookie = 'workflow-editor-view=specification; path=/';
    const { result } = renderHook(() => useWorkflowEditorView());
    expect(result.current[0]).toBe('specification');
  });

  it('ignores a garbage cookie value', () => {
    document.cookie = 'workflow-editor-view=not-a-real-view; path=/';
    const { result } = renderHook(() => useWorkflowEditorView());
    expect(result.current[0]).toBe('graph');
  });

  it('a `?view=` URL override wins over the cookie', () => {
    document.cookie = 'workflow-editor-view=graph; path=/';
    mockUrlState = { view: 'specification' };
    const { result } = renderHook(() => useWorkflowEditorView());
    expect(result.current[0]).toBe('specification');
  });

  it('setting the view writes the cookie and clears any URL override', () => {
    const { result } = renderHook(() => useWorkflowEditorView());

    act(() => {
      result.current[1]('specification');
    });

    expect(document.cookie).toContain('workflow-editor-view=specification');
    expect(mockSetUrlState).toHaveBeenCalledWith('view', null);
  });

  it('reflects the new value on the next render after setting it', () => {
    const { result, rerender } = renderHook(() => useWorkflowEditorView());
    act(() => {
      result.current[1]('specification');
    });
    rerender();
    expect(result.current[0]).toBe('specification');
  });
});
