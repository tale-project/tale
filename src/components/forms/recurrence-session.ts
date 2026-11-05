'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { useTriggerTooltipGuard } from '../../hooks/use-trigger-tooltip-guard';
import { structuralEqual } from '../../lib/structural-equal';

/** One popover session: the draft that Save commits and Cancel discards. */
export interface PickerSession<Rule, View extends string, Editor, Extra> {
  view: View;
  /** The draft rule — `null` while Never is picked. */
  rule: Rule | null;
  /** The drafted host extra; `null` when the host has none. */
  extra: { value: Extra } | null;
  /** The custom editor's state, once a custom view has been opened. */
  editor: Editor | null;
}

/** What a picker's props must carry for the session to run. */
interface SessionProps {
  disabled?: boolean;
  readOnly?: boolean;
}

/**
 * The rules of one picker mode: how a rule reads, compares and is saved,
 * and what a session starts from. Keep it a module constant, so the
 * session's callbacks stay stable.
 */
export interface RecurrenceMachine<Props, Rule, Session, Extra> {
  /** The saved rule. */
  value: (props: Props) => Rule | null;
  /** The saved host extra, or null when the host has none. */
  savedExtra: (props: Props) => { value: Extra } | null;
  same: (a: Rule | null | undefined, b: Rule | null | undefined) => boolean;
  /** A session that opens on the saved values. */
  fresh: (props: Props) => Session;
  /** Hands a rule (normalized by the mode) and the extra to the host. */
  emit: (
    props: Props,
    rule: Rule | null,
    extra: { value: Extra } | null,
  ) => void;
  /** A clean session following new saved values while it is open. */
  reseed: (
    live: Session,
    props: Props,
    saved: { value: Extra } | null,
  ) => Session;
}

/** Whether the drafted extra differs from the saved one. */
function extraChanged<Extra>(
  draft: { value: Extra } | null,
  saved: { value: Extra } | null,
): boolean {
  return (
    draft !== null &&
    saved !== null &&
    !structuralEqual(draft.value, saved.value)
  );
}

/**
 * The popover session both picker modes run: open and close, the draft
 * with its latest copy for handlers that run several steps in one event,
 * Save that calls the host once and only when something changed, a preset
 * that saves at once, new saved values that a clean draft follows while a
 * dirty one is kept, and a control that turns disabled or read-only taking
 * its popover with it.
 */
export function useRecurrenceSession<
  Props extends SessionProps,
  Rule,
  View extends string,
  Editor,
  Extra,
>(
  props: Props,
  machine: RecurrenceMachine<
    Props,
    Rule,
    PickerSession<Rule, View, Editor, Extra>,
    Extra
  >,
) {
  type Session = PickerSession<Rule, View, Editor, Extra>;
  const { disabled = false, readOnly = false } = props;
  const [open, setOpen] = useState(false);
  const [session, setSessionState] = useState<Session>(() =>
    machine.fresh(props),
  );
  // The latest session and props, for handlers that run several steps in one
  // event (Enter in a number field commits the number, then saves).
  const sessionRef = useRef(session);
  const propsRef = useRef(props);
  // Event handlers must see committed props, never props from a concurrent
  // render that React later discards.
  useLayoutEffect(() => {
    propsRef.current = props;
  });
  // False from the moment a session ends, so one event can never save twice.
  const openRef = useRef(false);
  // The saved values the open session last took in, to tell a clean draft
  // (follows new values) from a dirty one (kept) when the props change.
  const syncedRef = useRef<{
    value: Rule | null;
    extra: { value: Extra } | null;
  }>({ value: null, extra: null });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipGuard = useTriggerTooltipGuard(open);
  const suppressTooltipOpen = tooltipGuard.suppressNextOpen;

  const update = useCallback((change: (current: Session) => Session) => {
    const next = change(sessionRef.current);
    sessionRef.current = next;
    setSessionState(next);
  }, []);

  const isDirty = useCallback(
    (draft: Session, current: Props) =>
      !machine.same(draft.rule, machine.value(current)) ||
      extraChanged(draft.extra, machine.savedExtra(current)),
    [machine],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        const current = propsRef.current;
        if (current.disabled || current.readOnly) return;
        const fresh = machine.fresh(current);
        sessionRef.current = fresh;
        setSessionState(fresh);
        syncedRef.current = {
          value: machine.value(current),
          extra: machine.savedExtra(current),
        };
        openRef.current = true;
        setOpen(true);
        return;
      }
      openRef.current = false;
      setOpen(false);
      suppressTooltipOpen();
    },
    [machine, suppressTooltipOpen],
  );
  const close = useCallback(() => handleOpenChange(false), [handleOpenChange]);

  const save = useCallback(() => {
    if (!openRef.current) return;
    const current = propsRef.current;
    const draft = sessionRef.current;
    if (isDirty(draft, current)) machine.emit(current, draft.rule, draft.extra);
    close();
  }, [close, isDirty, machine]);

  /** A preset — or Never, as null — saves at once, calling the host only
   *  when the rule or the drafted extra changed. */
  const commit = useCallback(
    (rule: Rule | null) => {
      if (!openRef.current) return;
      const current = propsRef.current;
      const draft = sessionRef.current;
      if (rule === null) {
        if (machine.value(current)) machine.emit(current, null, draft.extra);
        close();
        return;
      }
      if (
        !machine.same(rule, machine.value(current)) ||
        extraChanged(draft.extra, machine.savedExtra(current))
      ) {
        machine.emit(current, rule, draft.extra);
      }
      close();
    },
    [close, machine],
  );

  // New saved values while the popover is open: a clean draft follows them,
  // a dirty one is kept (the last save wins). Runs after every render; the
  // comparison makes it a no-op unless a saved value really changed.
  useEffect(() => {
    if (!open) return;
    const current = propsRef.current;
    const value = machine.value(current);
    const saved = machine.savedExtra(current);
    const previous = syncedRef.current;
    if (
      machine.same(previous.value, value) &&
      !extraChanged(previous.extra, saved)
    ) {
      return;
    }
    syncedRef.current = { value, extra: saved };
    const draft = sessionRef.current;
    const clean =
      machine.same(draft.rule, previous.value) &&
      !extraChanged(draft.extra, previous.extra);
    if (!clean) return;
    update((live) => machine.reseed(live, current, saved));
  });

  // A control that turns disabled or read-only takes its popover with it.
  // The popover's focus return aimed at the trigger it unmounted with, so
  // put focus back on the one that replaced it rather than on the page.
  useEffect(() => {
    if ((disabled || readOnly) && openRef.current) {
      openRef.current = false;
      setOpen(false);
      if (
        document.activeElement === null ||
        document.activeElement === document.body
      ) {
        triggerRef.current?.focus();
      }
    }
  }, [disabled, readOnly]);

  return {
    open,
    session,
    sessionRef,
    propsRef,
    openRef,
    triggerRef,
    tooltipGuard,
    update,
    isDirty,
    handleOpenChange,
    close,
    save,
    commit,
  };
}
