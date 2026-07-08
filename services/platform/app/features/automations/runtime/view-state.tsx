'use client';

/**
 * Cross-block, per-view runtime state — the store behind the `$state.<key>` and
 * `$selection.ids` binding sentinels (`function_bindings.ts`). A list block that
 * declares `selection.stateKey` writes the clicked row's id into `state[stateKey]`
 * (master-detail: a ConversationThread reads it back via `$state.conversationId`);
 * a multi-select block writes its checked ids into `selectionIds[<its key>]` for
 * bulk-action args (`$selection.ids`). State is EPHEMERAL by design — it resets
 * with the view instance, is never persisted, and holds only data (ids/scalars),
 * never code.
 *
 * One store per VIEW instance: `AutomationView` mounts the provider around the Puck
 * `<Render>`. A NESTED provider (e.g. the per-column `AutomationView` inside a split
 * tab) adopts the ancestor store instead of shadowing it, so master-detail
 * selection crosses columns — a split-layout shell wraps its columns in one
 * provider and the per-column ones become pass-throughs.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from 'react';

export interface ViewStateData {
  /** Cross-block keys (`selection.stateKey` writes; `$state.<key>` reads). */
  state: Record<string, unknown>;
  /** Multi-select ids per owning block key (`$selection.ids` reads). */
  selectionIds: Record<string, string[]>;
}

export type ViewStateAction =
  | { type: 'setState'; key: string; value: unknown }
  | { type: 'setSelectionIds'; key: string; ids: string[] };

const EMPTY_VIEW_STATE: ViewStateData = { state: {}, selectionIds: {} };

/**
 * Pure reducer (exported for unit tests). No-op writes return the SAME object
 * so re-selecting the current row doesn't re-render every subscribed block.
 */
export function viewStateReducer(
  data: ViewStateData,
  action: ViewStateAction,
): ViewStateData {
  if (action.type === 'setState') {
    if (Object.is(data.state[action.key], action.value)) return data;
    return { ...data, state: { ...data.state, [action.key]: action.value } };
  }
  const prev = data.selectionIds[action.key];
  if (
    prev !== undefined &&
    prev.length === action.ids.length &&
    prev.every((id, i) => id === action.ids[i])
  ) {
    return data;
  }
  return {
    ...data,
    selectionIds: { ...data.selectionIds, [action.key]: action.ids },
  };
}

export interface ViewState extends ViewStateData {
  /** Write one cross-block key (`undefined` clears it → `$state.<key>` gates). */
  setState: (key: string, value: unknown) => void;
  /** Replace a block's multi-select ids (keyed by the block's id/state key). */
  setSelectionIds: (key: string, ids: string[]) => void;
}

const ViewStateContext = createContext<ViewState | null>(null);

export function ViewStateProvider({ children }: { children: React.ReactNode }) {
  const parent = useContext(ViewStateContext);
  // Hooks run unconditionally; when nested under an ancestor provider this
  // local store stays unused and the children read the ancestor's.
  const [data, dispatch] = useReducer(viewStateReducer, EMPTY_VIEW_STATE);
  const setState = useCallback(
    (key: string, value: unknown) => dispatch({ type: 'setState', key, value }),
    [],
  );
  const setSelectionIds = useCallback(
    (key: string, ids: string[]) =>
      dispatch({ type: 'setSelectionIds', key, ids }),
    [],
  );
  const value = useMemo<ViewState>(
    () => ({ ...data, setState, setSelectionIds }),
    [data, setState, setSelectionIds],
  );
  // Adopt the ancestor store: one view = one state, even when a layout shell
  // renders one `AutomationView` per column.
  if (parent) return <>{children}</>;
  return (
    <ViewStateContext.Provider value={value}>
      {children}
    </ViewStateContext.Provider>
  );
}

/**
 * The view's shared state. Blocks that REQUIRE the store (selection writers)
 * use this; it throws outside a provider so a mis-mounted block fails loudly.
 */
export function useViewState(): ViewState {
  const value = useContext(ViewStateContext);
  if (!value) {
    throw new Error('useViewState must be used within a ViewStateProvider');
  }
  return value;
}

/**
 * Null-safe variant for blocks that must render standalone (outside a view —
 * e.g. a preview or the resource-detail overlay): read `?.state` and degrade
 * to the awaiting/placeholder path instead of crashing.
 */
export function useOptionalViewState(): ViewState | null {
  return useContext(ViewStateContext);
}
