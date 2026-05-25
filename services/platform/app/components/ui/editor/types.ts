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
  save: () => Promise<void>;
  reset: () => void;
  /**
   * RHF-backed editors map a Convex `ConvexError({code, issues})` payload
   * into per-field `form.setError` calls; JSON-config editors leave it
   * undefined and rely on the destructive toast in `EditorActions`.
   */
  setServerErrors?: (
    issues: ReadonlyArray<{ path: string; message: string }>,
  ) => void;
}

/**
 * Optional telemetry callback wired through `EditorActions.onEvent`. Pages
 * pass `entityKind` so a single sink can group save events by entity.
 */
export type EditorTelemetryEvent =
  | { type: 'save_attempt'; entityKind: string }
  | { type: 'save_success'; entityKind: string; durationMs: number }
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
