import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNavigate = vi.fn();
let mockSearch: Record<string, string> = {};

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => mockSearch,
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/dashboard/org-1/chat' }),
}));

import { useDialogSearchParam } from '../use-dialog-search-param';

beforeEach(() => {
  mockSearch = {};
  mockNavigate.mockClear();
});

describe('useDialogSearchParam', () => {
  it('returns isOpen false when URL has no dialog param', () => {
    const { result } = renderHook(() =>
      useDialogSearchParam({ paramValue: 'create-agent' }),
    );

    expect(result.current.isOpen).toBe(false);
  });

  it('returns isOpen true when URL has matching dialog param', () => {
    mockSearch = { dialog: 'create-agent' };

    const { result } = renderHook(() =>
      useDialogSearchParam({ paramValue: 'create-agent' }),
    );

    expect(result.current.isOpen).toBe(true);
  });

  it('returns isOpen false when URL has a different dialog param value', () => {
    mockSearch = { dialog: 'other-dialog' };

    const { result } = renderHook(() =>
      useDialogSearchParam({ paramValue: 'create-agent' }),
    );

    expect(result.current.isOpen).toBe(false);
  });

  it('sets the URL param when open is called', () => {
    const { result } = renderHook(() =>
      useDialogSearchParam({ paramValue: 'create-agent' }),
    );

    act(() => {
      result.current.open();
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ dialog: 'create-agent' }),
      }),
    );
  });

  it('removes the URL param when close is called', () => {
    mockSearch = { dialog: 'create-agent' };

    const { result } = renderHook(() =>
      useDialogSearchParam({ paramValue: 'create-agent' }),
    );

    act(() => {
      result.current.close();
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.not.objectContaining({ dialog: 'create-agent' }),
      }),
    );
  });

  it('onOpenChange(true) opens and onOpenChange(false) closes', () => {
    const { result } = renderHook(() =>
      useDialogSearchParam({ paramValue: 'create-agent' }),
    );

    act(() => {
      result.current.onOpenChange(true);
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ dialog: 'create-agent' }),
      }),
    );

    mockNavigate.mockClear();

    act(() => {
      result.current.onOpenChange(false);
    });

    expect(mockNavigate).toHaveBeenCalled();
  });

  it('supports a custom paramKey', () => {
    mockSearch = { panel: 'details' };

    const { result } = renderHook(() =>
      useDialogSearchParam({ paramValue: 'details', paramKey: 'panel' }),
    );

    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.close();
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.not.objectContaining({ panel: 'details' }),
      }),
    );
  });

  it('preserves other URL search params when opening', () => {
    mockSearch = { search: 'hello', priority: 'high' };

    const { result } = renderHook(() =>
      useDialogSearchParam({ paramValue: 'create-agent' }),
    );

    act(() => {
      result.current.open();
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({
          search: 'hello',
          priority: 'high',
          dialog: 'create-agent',
        }),
      }),
    );
  });
});
