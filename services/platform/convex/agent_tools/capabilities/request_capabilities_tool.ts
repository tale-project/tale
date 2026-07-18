/**
 * `request_capabilities` — the unlock half of two-tier tool gating (#2781).
 *
 * Built PER TURN (like `create_spawn_agent_tool`) because it closes over the
 * turn's mutable `ToolGatingState` and advertises exactly the groups that are
 * still locked for this agent. Its execute unions the requested groups into
 * the in-turn state (read by `prepareStep` → the tools become active on the
 * model's NEXT step of the same stream) and persists them to
 * `threadMetadata.unlockedToolGroups` so the unlock is sticky for the rest of
 * the thread.
 *
 * Not registered in TOOL_REGISTRY: it never appears in agent configs; the
 * gating wiring in `lib/agent_chat/internal_actions.ts` attaches it as an
 * extra tool whenever gating is active and something is locked.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod';

import { internal } from '../../_generated/api';
import {
  GATED_TOOL_GROUPS,
  isKnownGroupId,
  lockedGroupsFor,
  REQUEST_CAPABILITIES_TOOL_NAME,
  type ToolGatingState,
} from '../tool_gating';

const GROUP_IDS = GATED_TOOL_GROUPS.map((g) => g.id) as [string, ...string[]];

const requestCapabilitiesArgs = z.object({
  groups: z
    .array(z.enum(GROUP_IDS))
    .min(1)
    .describe('Capability group ids to unlock for this conversation.'),
});

export interface RequestCapabilitiesDeps {
  state: ToolGatingState;
  threadId: string;
  /** The agent's full tool-name list — scopes the advertised groups. */
  allToolNames: readonly string[];
}

export function createRequestCapabilitiesTool(deps: RequestCapabilitiesDeps) {
  const locked = lockedGroupsFor(deps.allToolNames, deps.state);
  const groupLines = locked.map((g) => `• "${g.id}" — ${g.summary}`).join('\n');
  return {
    name: REQUEST_CAPABILITIES_TOOL_NAME,
    tool: createTool({
      description: `Unlock additional capability groups for this conversation. The groups below are NOT active yet — when the user's request needs one of them, call this FIRST with the group id(s), then use the unlocked tools on your next step. Unlocks persist for the whole conversation.

Available groups:
${groupLines}`,
      inputSchema: requestCapabilitiesArgs,
      execute: async (
        ctx: ToolCtx,
        args: z.infer<typeof requestCapabilitiesArgs>,
      ) => {
        const valid = [...new Set(args.groups.filter(isKnownGroupId))];
        for (const id of valid) deps.state.unlockedGroupIds.add(id);
        try {
          await ctx.runMutation(
            internal.threads.internal_mutations.addUnlockedToolGroups,
            { threadId: deps.threadId, groupIds: valid },
          );
        } catch (err) {
          // The in-turn unlock already happened; a persistence hiccup only
          // costs stickiness on FUTURE turns. Log and continue.
          console.warn(
            '[request_capabilities] failed to persist unlocks (turn unlock still active):',
            err instanceof Error ? err.message : err,
          );
        }
        return {
          unlocked: valid,
          note: 'The requested capabilities are now active — continue with the task using the newly available tools.',
        };
      },
    }),
  };
}
