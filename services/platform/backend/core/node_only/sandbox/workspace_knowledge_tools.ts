/**
 * The knowledge-entry WRITE tool of the workspace-tool bridge:
 * `knowledge_entry_write` saves one fact under its topic in the
 * organization's knowledge entries — a new entry, or a new version of one.
 * The dispatch (`workspace_tools_bridge.ts`) resolves the session's write
 * authority once and hands it here; this handler owns the argument check
 * written for the model and the call into the entries domain's write by
 * topic, which decides, versions, audits and rate-limits.
 *
 * Entries are org-wide: every member and agent of the organization reads
 * them, whichever project the writing agent works in. So a run a member
 * started — confined to its own task — writes none, the same boundary that
 * keeps it from saving project documents.
 *
 * A changed fact is written only onto the version the agent read
 * (`expectedVersionId`); anything else comes back as a refusal carrying the
 * current text, so the agent merges instead of overwriting a person's edit.
 * Like `task_start_agent`'s "nothing started", that refusal is an answer
 * (`status: ok`) the model reads, not a failed call.
 */

import {
  CONTENT_MAX_LENGTH,
  TOPIC_MAX_LENGTH,
} from '../../knowledge_entries/constants';
import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import { taskLimitText } from '../../tasks/helpers';
import {
  memberRunRefusal,
  toolResultFromError,
} from './workspace_domain_tools';
import {
  readString,
  type ToolResult,
  type WorkspaceActionAuthority,
} from './workspace_tool_shared';

export const KNOWLEDGE_ENTRY_WRITE_TOOL = 'knowledge_entry_write';

/** A topic's current version, as a refused write hands it back. */
interface CurrentEntry {
  versionId: string;
  topic: string;
  content: string;
  updatedAt: number;
}

/** What the entries domain's write by topic answers (the knowledge entries
 * service's `upsertKnowledgeEntryByTopic`, reached through the write shim). */
type EntryWriteAnswer =
  | {
      outcome: 'created' | 'updated' | 'unchanged';
      versionId: string;
      documentId: string;
      topic: string;
      previousVersionId?: string;
    }
  | {
      outcome: 'refused';
      reason: 'version_required' | 'version_conflict' | 'entry_gone';
      current: CurrentEntry | null;
    }
  | { outcome: 'rate_limited'; retryAfterMs: number };

/** What the model is told to do after a write that saved nothing. */
const REFUSAL_GUIDANCE: Record<
  Extract<EntryWriteAnswer, { outcome: 'refused' }>['reason'],
  string
> = {
  version_required:
    'This topic already has an entry with other text; nothing was saved. ' +
    'Merge your change into current.content — keep the facts you did not ' +
    'mean to change — and save again with expectedVersionId: ' +
    'current.versionId.',
  version_conflict:
    'The entry changed since you read it; nothing was saved. current is ' +
    'what it says now. Merge your change into current.content and save ' +
    'again with expectedVersionId: current.versionId.',
  entry_gone:
    'The entry you read has been deleted since; nothing was saved. Someone ' +
    'removed it on purpose: save it again only if your task needs it, as a ' +
    'new entry (without expectedVersionId).',
};

/** Why an argument is refused, in the words the signature uses, or null. */
function textRefusal(
  name: 'topic' | 'content',
  value: string,
  max: number,
): string | null {
  const length = value.trim().length;
  if (length === 0) {
    return `The ${name} is empty — it takes 1 to ${taskLimitText(max)}.`;
  }
  if (length > max) {
    return (
      `The ${name} is capped at ${taskLimitText(max)} (most emoji count as ` +
      `2); this one has ${length.toLocaleString('en-US')}.`
    );
  }
  return null;
}

const ARGS_SHAPE =
  'knowledge_entry_write needs {topic: string, content: string, ' +
  'expectedVersionId?: string}.';

/** `knowledge_entry_write`: save one fact under its topic. */
export async function runKnowledgeEntryWrite(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    callArgs: Record<string, unknown>;
    authority: WorkspaceActionAuthority;
  },
): Promise<ToolResult> {
  if (args.authority.confinedToTaskId !== undefined) {
    return memberRunRefusal(
      'It cannot write knowledge entries: they are shared with the whole ' +
        'organization. Put the fact in your result or in a comment on this ' +
        'task, so an editor can save it.',
    );
  }
  const { topic, content, expectedVersionId } = args.callArgs;
  if (typeof topic !== 'string' || typeof content !== 'string') {
    return { status: 'invalid_args', message: ARGS_SHAPE };
  }
  const refusal =
    textRefusal('topic', topic, TOPIC_MAX_LENGTH) ??
    textRefusal('content', content, CONTENT_MAX_LENGTH);
  if (refusal !== null) return { status: 'invalid_args', message: refusal };
  const version = readString(expectedVersionId);
  if (expectedVersionId !== undefined && version === undefined) {
    return {
      status: 'invalid_args',
      message:
        'expectedVersionId names the version you read — the id ' +
        'knowledge_entry_find listed, or the versionId this tool answered. ' +
        'Leave it out for a new topic.',
    };
  }

  let answer: EntryWriteAnswer;
  try {
    answer = await ctx.runMutation(
      internal.knowledge_entries.internal_mutations.upsertEntryForAgent,
      {
        organizationId: args.organizationId,
        actorId: args.authority.actorId,
        topic,
        content,
        ...(version !== undefined ? { expectedVersionId: version } : {}),
      },
    );
  } catch (error) {
    return toolResultFromError(error);
  }

  if (answer.outcome === 'rate_limited') {
    const seconds = Math.max(1, Math.ceil(answer.retryAfterMs / 1000));
    return {
      status: 'unavailable',
      blockers: [
        {
          code: 'rate_limited',
          guidance:
            "This organization's agents saved many knowledge entries in a " +
            `short time; nothing was saved. Try again in ${seconds} s, and ` +
            'save only facts worth keeping.',
        },
      ],
    };
  }
  if (answer.outcome === 'refused') {
    return {
      status: 'ok',
      output: {
        outcome: 'refused',
        reason: answer.reason,
        guidance: REFUSAL_GUIDANCE[answer.reason],
        current: answer.current,
      },
    };
  }
  return {
    status: 'ok',
    output: {
      outcome: answer.outcome,
      versionId: answer.versionId,
      topic: answer.topic,
      documentId: answer.documentId,
      note:
        answer.outcome === 'unchanged'
          ? 'The entry already says this; nothing was saved.'
          : 'Saved. knowledge_entry_find lists it now; rag_search finds it ' +
            'only once it has been indexed.',
    },
  };
}
