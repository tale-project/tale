/**
 * Unified contract that both `useJsonConfigEditor` and `useFormEditor`
 * implement. `EditorActions` consumes this shape; pages own the choice of
 * which hook to use under the hood.
 *
 * The contract is intentionally not generic over the value type — the
 * editor's exposed methods (`save`, `reset`) operate on internal state
 * and the public surface doesn't need to leak it. Hooks layer the value
 * type on their *own* return shapes (e.g. `useFormEditor<T>` returns
 * `EditorController & { form: UseFormReturn<T> }`).
 *
 * Plan: ../../../../../../.claude/plans/figure-out-how-to-generic-cookie.md
 */
export interface EditorController {
  isDirty: boolean;
  isSaving: boolean;
  isValid: boolean;
  isLoading: boolean;
  /**
   * Top-level keys that diverge from the saved baseline. Nested fields
   * flatten to their first path segment so `TabNavigation` can intersect
   * with a tab's `dirtyKeys` and decide whether to render the per-tab dot.
   */
  dirtyKeys: ReadonlySet<string>;
  /**
   * Persists the edits. `EditorActions` owns every piece of save feedback, so
   * a `save` implementation must never toast:
   *
   *   • server errors that belong to a field are turned into per-field issues
   *     — `useFormEditor`'s `mapServerError` maps the raw failure and the
   *     issues render under the inputs, with no toast at all;
   *   • any other failure throws an `Error` whose `message` is a user-facing,
   *     already-translated line. `EditorActions` shows exactly ONE destructive
   *     toast carrying that message;
   *   • success needs nothing: the cluster flashes "Saved" on its own, so a
   *     page that also toasts success double-reports it.
   *
   * Throw {@link EditorSaveCancelledError} to abort silently when the user
   * dismisses an interactive step inside `save` (e.g. a "save version"
   * dialog) — no toast, no "Saved" flash.
   *
   * `EditorActions`' `suppressServerErrorToast` escape hatch exists only for
   * legacy controllers whose `save` still toasts its own failures; new
   * controllers follow the contract above instead.
   */
  save: () => Promise<void>;
  reset: () => void;
  /**
   * RHF-backed editors map a Convex `BackendError({code, issues})` payload
   * into per-field `form.setError` calls; JSON-config editors leave it
   * undefined and rely on the destructive toast in `EditorActions`.
   */
  setServerErrors?: (
    issues: ReadonlyArray<{ path: string; message: string }>,
  ) => void;
}

/**
 * Thrown by a controller whose `save` asks the user something before it
 * persists — a "save version" dialog, a destructive-change confirmation — and
 * the user backs out. It is a deliberate no-op, not a failure: `EditorActions`
 * neither toasts it nor flashes "Saved", and the edits stay dirty so the user
 * can try again.
 *
 * Identified by `name` rather than `instanceof` so it survives being rethrown
 * across module boundaries (a duplicated module instance in a bundle split, a
 * test that re-imports the module) — see {@link isEditorSaveCancelled}.
 */
export class EditorSaveCancelledError extends Error {
  constructor(message = 'EDITOR_SAVE_CANCELLED') {
    super(message);
    this.name = 'EditorSaveCancelledError';
  }
}

/** Whether a rejection is the silent-cancel signal above. */
export function isEditorSaveCancelled(err: unknown): boolean {
  return err instanceof Error && err.name === 'EditorSaveCancelledError';
}

/**
 * Optional telemetry callback wired through `EditorActions.onEvent`. Pages
 * pass `entityKind` so a single sink can group save events by entity.
 */
export type EditorTelemetryEvent =
  | { type: 'save_attempt'; entityKind: string }
  | { type: 'save_success'; entityKind: string; durationMs: number }
  /**
   * The user backed out of an interactive step inside `save`. Reported
   * separately so a `save_attempt` with no outcome can't read as a hang, and
   * so cancellations never inflate the save-failure rate.
   */
  | { type: 'save_cancelled'; entityKind: string; durationMs: number }
  | {
      type: 'save_failure';
      entityKind: string;
      durationMs: number;
      reason: 'validation' | 'server' | 'unknown';
    }
  | { type: 'discard'; entityKind: string }
  | {
      type: 'navigation_blocked';
      entityKind: string;
      choice: 'stay' | 'discard_leave' | 'save_leave';
    }
  | { type: 'remote_update_detected'; entityKind: string };
