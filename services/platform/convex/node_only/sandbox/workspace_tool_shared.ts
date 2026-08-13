/**
 * Shapes and small arg-normalization helpers shared by the workspace-tool
 * dispatch (`workspace_tools_bridge.ts`) and its first-party domain handlers
 * (`workspace_domain_tools.ts`). Directive-free on purpose: types and pure
 * functions only, importable from either runtime and from tests.
 */

export interface BridgeBlocker {
  code: string;
  guidance: string;
}

/** Every workspace-tool dispatch answers one of these — relayed VERBATIM to
 * the external agent as the tool result, so each shape is written for the
 * model (structured status + guidance, never a bare throw). */
export type ToolResult =
  | { status: 'ok'; output: unknown }
  | { status: 'unavailable'; blockers: BridgeBlocker[] }
  | { status: 'invalid_args'; message: string }
  | { status: 'not_found'; message: string }
  | { status: 'error'; message: string };

/** The authority a resolved dispatch acts with (see
 * `sandbox/workspace_access.ts::resolveSessionActionContext`). */
export interface WorkspaceActionAuthority {
  /** Task/document-domain attribution for this session's writes. */
  actorId: string;
  /**
   * Where this dispatch may act. A `project` scope is pinned to one project. An
   * `org` scope is org-wide — but a run of a MULTI-BOUND automation that was
   * not pinned to a single project carries `allowedProjectIds`: it is org-wide
   * only across those bound projects, never the whole org. Absent (or a truly
   * org-level automation with no bindings) means the whole organization.
   */
  scope:
    | { kind: 'project'; projectId: string }
    | { kind: 'org'; allowedProjectIds?: string[] };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A caller-supplied `limit`, floored to a positive int and capped. */
export function readLimit(raw: unknown, cap: number): number {
  return typeof raw === 'number' && raw > 0
    ? Math.min(Math.floor(raw), cap)
    : Math.min(20, cap);
}

/** A caller-supplied continuation cursor: a non-empty string, else page one. */
export function readCursor(raw: unknown): string | null {
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

/** A caller-supplied string arg: trimmed, else `undefined`. */
export function readString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
}

/** A caller-supplied boolean arg, else `undefined`. */
export function readBoolean(raw: unknown): boolean | undefined {
  return typeof raw === 'boolean' ? raw : undefined;
}
