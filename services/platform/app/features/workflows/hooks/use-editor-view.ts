'use client';

import { useCallback, useState } from 'react';

import { useUrlState } from '@/app/hooks/use-url-state';

export type WorkflowEditorView = 'graph' | 'specification';

const COOKIE_NAME = 'workflow-editor-view';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

function isWorkflowEditorView(
  value: string | null | undefined,
): value is WorkflowEditorView {
  return value === 'graph' || value === 'specification';
}

/** No dedicated SSR-safe cookie util exists in this SPA-only app (searched:
 * `app/hooks/`, `lib/utils/`) — read/write directly, mirroring
 * `usePersistedState`'s "no `window`/`document` guard needed" note. */
function readViewCookie(): WorkflowEditorView {
  if (typeof document === 'undefined') return 'graph';
  const match = /(?:^|; )workflow-editor-view=([^;]*)/.exec(document.cookie);
  return isWorkflowEditorView(match?.[1]) ? match[1] : 'graph';
}

function writeViewCookie(value: WorkflowEditorView): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

/**
 * Graph/Specification toggle state for the workflow editor (W5b). Persisted
 * in a COOKIE (not per-workflow `usePersistedState`/localStorage) so the
 * choice carries across every workflow the user opens next in any
 * automation detail's Editor tab. An optional `?view=` URL param layers on
 * top — it forces the
 * view for the current visit (e.g. a shared link) without changing the
 * saved default; picking a tab clears it so the cookie drives the next visit.
 *
 * Lazy `useState` init reads the cookie synchronously on first render (like
 * `usePersistedState`) — this is an SPA-only app (no SSR), so there's no
 * hydration flash to guard against.
 */
export function useWorkflowEditorView(): [
  WorkflowEditorView,
  (next: WorkflowEditorView) => void,
] {
  const { state, setState } = useUrlState({
    definitions: { view: { default: null } },
  });
  const urlView = isWorkflowEditorView(state.view) ? state.view : null;

  const [cookieView, setCookieView] = useState<WorkflowEditorView>(() =>
    readViewCookie(),
  );

  const setView = useCallback(
    (next: WorkflowEditorView) => {
      setCookieView(next);
      writeViewCookie(next);
      setState('view', null);
    },
    [setState],
  );

  return [urlView ?? cookieView, setView];
}
