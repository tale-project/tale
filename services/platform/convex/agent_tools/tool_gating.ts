/**
 * Two-tier tool gating for chat agents (#2781).
 *
 * Every chat turn used to ship ALL bound tool schemas + descriptions to the
 * model (~8-9k of the ~16.5k input tokens a trivial message costs). Most of
 * that payload is capabilities a given message can't plausibly need. This
 * module defines the tiering:
 *
 *  - CORE tools are always active — the capabilities the agent's standing
 *    rules depend on (search-before-"I don't know" → rag_search, the
 *    interactive-input contract → request_human_input, …). Gating one of
 *    these would make the system prompt reference a missing tool.
 *  - GATED GROUPS are hidden from the wire until the model (or a prior turn
 *    of the same thread) unlocks them via the `request_capabilities`
 *    meta-tool. Unlocks are STICKY-GROW PER THREAD: once a group is
 *    unlocked it stays active for every later step and turn of that thread,
 *    and groups are never re-locked. This keeps the provider prompt-cache
 *    prefix stable (a tool-set change invalidates the cached prefix, so it
 *    must stay a rare, monotonic event — at most one per group per thread).
 *  - Tools in NO group are always active (safe default: a specialist
 *    agent's primary tools — CRM, workflows, integrations — never sit
 *    behind an extra hop just because gating shipped).
 *
 * The wire mechanics live in the callers: all tools stay CONSTRUCTED on the
 * Agent instance; the AI SDK's `activeTools` (recomputed per step via
 * `prepareStep`) controls which are serialized to the provider. The unlock
 * therefore takes effect on the NEXT step of the SAME streamText call — one
 * extra tool round-trip, no restart.
 *
 * Kill-switch: deployment env `TALE_TOOL_GATING=off` disables gating
 * everywhere (all tools active on every step, exactly the pre-#2781 wire
 * shape).
 */

import type { ToolName } from './tool_names';

/** A gated capability group: the unit of locking/unlocking. */
export interface ToolGroup {
  /** Stable id the model passes to `request_capabilities`. */
  id: string;
  /** One-line summary shown in the meta-tool description while locked. */
  summary: string;
  /** Registry tool names, plus known per-turn extras (e.g. `spawn_agent`). */
  tools: readonly string[];
}

/**
 * Always-active core for chat agents. Keep in sync with the standing rules
 * in the builtin chat instructions — a rule may only reference core tools
 * (or name the group to request). `propose_memory` is auto-injected only
 * while personalization is active, but when present it must not be gated:
 * the memories UX depends on it firing opportunistically.
 */
export const CORE_TOOL_NAMES: readonly ToolName[] = [
  'rag_search',
  'web',
  'request_human_input',
  'document_find',
  'document_retrieve',
  'propose_memory',
];

/**
 * Groups locked by default on gated turns. Scoped deliberately to the
 * default-chat-agent surface (the measured payload problem); tools of
 * specialist agents (CRM, workflows, integrations, …) are intentionally
 * ungrouped → always active.
 */
export const GATED_TOOL_GROUPS: readonly ToolGroup[] = [
  {
    id: 'workspace',
    summary:
      'code execution (Python/Node/bash sandbox) and the file workspace (write, edit, read, list, delete)',
    tools: [
      'run_code',
      'file_write',
      'file_edit',
      'file_read',
      'file_list',
      'file_delete',
    ],
  },
  {
    id: 'images',
    summary: 'analyze user-provided images and generate new images',
    tools: ['image', 'generate_image'],
  },
  {
    id: 'documents_write',
    summary: 'create or update documents in the Document Hub',
    tools: ['document_write'],
  },
  {
    id: 'location',
    summary: "request the user's current location",
    tools: ['request_user_location'],
  },
  {
    id: 'delegation',
    summary:
      'spawn focused worker agents for well-scoped sub-tasks (cited research, bulk extraction, long drafts)',
    tools: ['spawn_agent'],
  },
];

export const REQUEST_CAPABILITIES_TOOL_NAME = 'request_capabilities';

const GROUP_BY_ID = new Map(GATED_TOOL_GROUPS.map((g) => [g.id, g]));
const GROUP_BY_TOOL = new Map<string, string>();
for (const group of GATED_TOOL_GROUPS) {
  for (const tool of group.tools) GROUP_BY_TOOL.set(tool, group.id);
}

export function isKnownGroupId(id: string): boolean {
  return GROUP_BY_ID.has(id);
}

export function groupById(id: string): ToolGroup | undefined {
  return GROUP_BY_ID.get(id);
}

/** Kill-switch: gating is on unless the deployment says otherwise. */
export function isToolGatingEnabled(): boolean {
  return process.env.TALE_TOOL_GATING !== 'off';
}

/**
 * Mutable per-turn gating state. Created once per generation in
 * `internal_actions`, written by the `request_capabilities` tool's execute,
 * read by `prepareStep` — all within one node action, so plain object
 * sharing is safe. `hydrate` folds in the thread's persisted unlocks once
 * threadMetadata resolves (generate_response owns that read).
 */
export interface ToolGatingState {
  unlockedGroupIds: Set<string>;
}

export function createToolGatingState(): ToolGatingState {
  return { unlockedGroupIds: new Set() };
}

export function hydrateToolGatingState(
  state: ToolGatingState,
  persistedGroupIds: readonly string[] | undefined,
): void {
  for (const id of persistedGroupIds ?? []) {
    if (GROUP_BY_ID.has(id)) state.unlockedGroupIds.add(id);
  }
}

/**
 * The active tool names for the current step: everything except tools whose
 * group is still locked, plus the meta-tool itself while anything remains
 * locked (once every group is unlocked the meta-tool disappears from the
 * wire too — it has nothing left to offer).
 */
export function computeActiveToolNames(
  allToolNames: readonly string[],
  state: ToolGatingState,
): string[] {
  const active = allToolNames.filter((name) => {
    const groupId = GROUP_BY_TOOL.get(name);
    if (!groupId) return true;
    return state.unlockedGroupIds.has(groupId);
  });
  const lockedRemain = GATED_TOOL_GROUPS.some(
    (g) =>
      !state.unlockedGroupIds.has(g.id) &&
      g.tools.some((t) => allToolNames.includes(t)),
  );
  if (lockedRemain) active.push(REQUEST_CAPABILITIES_TOOL_NAME);
  return active;
}

/**
 * Groups that are still locked AND actually matter for this agent (at least
 * one of their tools is bound) — what the meta-tool advertises.
 */
export function lockedGroupsFor(
  allToolNames: readonly string[],
  state: ToolGatingState,
): ToolGroup[] {
  return GATED_TOOL_GROUPS.filter(
    (g) =>
      !state.unlockedGroupIds.has(g.id) &&
      g.tools.some((t) => allToolNames.includes(t)),
  );
}
