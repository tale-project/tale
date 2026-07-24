'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';

export interface SettingsHeaderAction {
  label: string;
  /** Label shown while `loading` is true. Falls back to `label` if omitted. */
  loadingLabel?: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  title?: string;
  variant?: 'primary' | 'secondary';
  /**
   * Which side of the Discard/Save cluster the button sits on. `trailing`
   * (the default) continues the cluster — for an action that follows saving,
   * like "Apply & restart". `leading` puts it BEFORE Discard, which is where
   * a destructive-ish page action such as branding's Reset belongs: the
   * primary action stays rightmost.
   */
  placement?: 'leading' | 'trailing';
}

/**
 * Split-context pattern (mirrors `useRegisterActiveEditor`):
 *
 * - `SetterContext`  — holds the stable `setActions` from `useState`.
 *   Sub-pages use this to register their buttons.  Because the setter
 *   is stable, including it as an effect dep does NOT cause re-render loops.
 *
 * - `ActionsContext` — holds the current action array.
 *   The header slot reads this to know what to render.
 */
const SetterContext = createContext<Dispatch<
  SetStateAction<SettingsHeaderAction[]>
> | null>(null);

const ActionsContext = createContext<SettingsHeaderAction[]>([]);

export { SetterContext as SettingsHeaderActionsSetter };
export { ActionsContext as SettingsHeaderActionsReader };

/** Reads the registered actions (consumed by the settings header slot). */
export function useSettingsHeaderActions(): SettingsHeaderAction[] {
  return useContext(ActionsContext);
}

/**
 * Registers one or more action buttons in the settings header slot.
 * Buttons render in order alongside any EditorActions (Discard/Save) cluster,
 * or on their own when the page doesn't use `useRegisterActiveEditor`.
 *
 * Pass a fresh array each render; the hook only re-registers when any
 * action's `disabled` or `loading` state changes.  The setter from
 * `useState` is stable, so including it as a dep is safe — no loops.
 *
 * Pass an empty array to clear the slot.
 */
export function useRegisterSettingsSecondaryAction(
  actions: SettingsHeaderAction[],
): void {
  const setActions = useContext(SetterContext);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // Collect the per-action state values that can change between renders.
  // Number of actions must be stable across renders (rules of hooks).
  const depValues = actions.flatMap((a) => [a.disabled, a.loading]);

  useEffect(
    () => {
      if (!setActions) return;
      setActions([...actionsRef.current]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setActions, ...depValues],
  );

  // Clear the slot when the registering component unmounts.
  useEffect(
    () => () => {
      setActions?.([]);
    },
    [setActions],
  );
}
