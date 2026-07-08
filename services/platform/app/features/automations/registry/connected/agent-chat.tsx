'use client';

/**
 * An automation-embedded chat with one of the automation's cast: resolves the view's `role`
 * token to an agent through the manifest's `roles` map (`runtime.roles`,
 * validated at publish) and chats on the ONE shared `automation_discussion` thread
 * per (org, automation, subject) — per-subject when the view binds a subject
 * (e.g. `('task', <id>)` on a task detail), install-scoped
 * (`('automation', <automationSlug>)`) otherwise.
 *
 * Reads the FIXED platform thread functions directly
 * (`threads/get_or_create_automation_thread`), like `SubjectRun` — the automation allowlist
 * gates automation-AUTHORED view bindings, whereas these are platform functions with
 * their own org-membership RLS (soft-null read; membership-throwing create).
 * Turns ride the interactive pipeline (`agents/chat_turn`), which admits any
 * org member on `automation_discussion` threads.
 *
 * Subject id resolution (documented contract):
 * - `subject.id` — a literal or binding sentinel resolved through
 *   `resolveBindingArgs` (e.g. `'$state.taskId'` reads the view-state key a
 *   sibling list block sets; `$config:`/`$tpl:` also work). Unresolved →
 *   the awaiting-selection placeholder.
 * - `subject.idField` — a field read from the `item` row a COMPOSING host
 *   passes (e.g. the resource-detail overlay hands its target). Puck-rendered
 *   views have no row, so they use `subject.id`.
 */
import { Text } from '@tale/ui/text';
import { useCallback, useMemo } from 'react';

import { EmbeddedChat } from '@/app/features/chat/components/embedded-chat';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { resolveBindingArgs } from '@/lib/shared/platform/function_bindings';

import { useAutomationRuntime } from '../../runtime/automation-runtime';
import { useOptionalViewState } from '../../runtime/view-state';
import { BindingStates, BlockFrame } from '../block-frame';

/** Default panel height (px) when the view doesn't size it. */
const DEFAULT_HEIGHT = 480;

export interface AgentChatSubject {
  type: string;
  /** Field on the host-passed `item` row holding the subject id. */
  idField?: string;
  /** Literal or sentinel-capable id binding (e.g. `'$state.taskId'`). */
  id?: string;
}

export interface AgentChatProps {
  /** Literal block title, rendered verbatim by BlockFrame. */
  title?: string;
  /**
   * Manifest role token → the agent behind the chat. The VIEW prop is named
   * `role` (app_views schema); the component prop dodges that name because a
   * JSX `role=` attribute trips the ARIA-role lint — the block render maps it.
   */
  roleToken: string;
  /** Present → per-subject thread; absent → the install-scoped thread. */
  subject?: AgentChatSubject;
  /** Sentinel-capable template resolved into the turn's `subject_context`. */
  contextTemplate?: string;
  placeholder?: string;
  /** Literal composer placeholder (takes precedence over `placeholder`). */
  placeholderKey?: string;
  /** Panel height in px (the embed scrolls inside it). */
  height?: number;
  /** Subject row from a composing host (resource-detail); `idField` source. */
  item?: Record<string, unknown>;
}

export function AgentChat({
  title,
  roleToken,
  subject,
  contextTemplate,
  placeholder,
  placeholderKey,
  height,
  item,
}: AgentChatProps) {
  const { t } = useT('automations');
  const runtime = useAutomationRuntime();
  const { organizationId, projectId, automationSlug, config } = runtime;
  const viewState = useOptionalViewState();
  const state = viewState?.state;

  const agentSlug = runtime.roles?.[roleToken];

  // ---- Subject resolution -------------------------------------------------
  const subjectType = subject ? subject.type : 'automation';
  const subjectId = useMemo<string | undefined>(() => {
    if (!subject) return automationSlug; // install-scoped thread
    let raw: unknown;
    if (subject.id !== undefined) {
      raw = resolveBindingArgs(subject.id, {
        organizationId,
        projectId,
        config,
        state: state ?? {},
        selected: item,
      });
    } else if (subject.idField !== undefined) {
      raw = item?.[subject.idField];
    }
    if (typeof raw === 'number') return String(raw);
    if (typeof raw === 'string' && raw.trim().length > 0) return raw;
    return undefined;
  }, [subject, automationSlug, organizationId, projectId, config, state, item]);

  // Subject context for the agent: always name the subject; add the resolved
  // template (row/state/config fields via the house resolvers) when it yields
  // a non-empty string.
  const additionalContext = useMemo<Record<string, string> | undefined>(() => {
    if (subjectId === undefined) return undefined;
    const out: Record<string, string> = {
      subject_type: subjectType,
      subject_id: subjectId,
    };
    if (contextTemplate) {
      const resolved = resolveBindingArgs(contextTemplate, {
        organizationId,
        projectId,
        config,
        state: state ?? {},
        selected: item,
      });
      if (typeof resolved === 'string' && resolved.trim().length > 0) {
        out.subject_context = resolved;
      }
    }
    return out;
  }, [
    subjectId,
    subjectType,
    contextTemplate,
    organizationId,
    projectId,
    config,
    state,
    item,
  ]);

  // ---- Thread: read-only history resolve + lazy get-or-create -------------
  const ready = agentSlug !== undefined && subjectId !== undefined;
  const { data: existingThread } = useConvexQuery(
    api.threads.get_or_create_automation_thread.getAutomationThread,
    ready
      ? {
          organizationId,
          automationSlug: automationSlug,
          subjectType,
          subjectId,
        }
      : 'skip',
  );

  const { mutateAsync: getOrCreateThread } = useConvexMutation(
    api.threads.get_or_create_automation_thread.getOrCreateAutomationThread,
    // The embed's send path owns failure UX (toast + optimistic rollback).
    { errorToast: false },
  );
  const resolveThread = useCallback(async (): Promise<string> => {
    if (subjectId === undefined) {
      // Unreachable through the UI (the awaiting placeholder gates the embed),
      // kept as a loud guard against minting a thread keyed on ''.
      throw new Error('[AgentChat] subject id unresolved');
    }
    const result = await getOrCreateThread({
      organizationId,
      ...(projectId !== undefined && {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the automation runtime's projectId is the bound project's Convex id (a string in the runtime contract)
        projectId: projectId as Id<'projects'>,
      }),
      automationSlug: automationSlug,
      subjectType,
      subjectId,
      ...(title !== undefined && { title }),
    });
    return result.threadId;
  }, [
    getOrCreateThread,
    organizationId,
    projectId,
    automationSlug,
    subjectType,
    subjectId,
    title,
  ]);

  // Role unmapped (or the automation predates the roles plumbing): a graceful framed
  // notice, not a crash — the pack's cast is authored data.
  if (agentSlug === undefined) {
    return (
      <BlockFrame title={title}>
        <Text variant="muted">
          {t('chat.roleUnavailable', { role: roleToken })}
        </Text>
      </BlockFrame>
    );
  }

  const placeholderText = placeholderKey ?? placeholder;
  return (
    <BlockFrame title={title}>
      <BindingStates
        awaitingState={subjectId === undefined}
        loading={existingThread === undefined}
      >
        <div
          className="flex flex-col"
          style={{ height: height ?? DEFAULT_HEIGHT }}
        >
          <EmbeddedChat
            organizationId={organizationId}
            agentSlug={agentSlug}
            threadId={existingThread?.threadId ?? null}
            resolveThread={resolveThread}
            additionalContext={additionalContext}
            placeholder={placeholderText}
          />
        </div>
      </BindingStates>
    </BlockFrame>
  );
}

/** Partial props as Puck passes them (every field optional until authored). */
export interface AgentChatBlockProps {
  title?: string;
  role?: string;
  subject?: AgentChatSubject;
  contextTemplate?: string;
  placeholder?: string;
  placeholderKey?: string;
  height?: number;
}

/**
 * The registration payload for `registerConnectedBlock('AgentChat', …)` in
 * `tale-config.tsx` (wired by the registry owner). No row flows through Puck,
 * so `item`/`idField` stay a composing-host affordance.
 */
export const agentChatBlock = {
  fields: {
    title: { type: 'text' as const },
    role: { type: 'text' as const },
  },
  render: ({
    title,
    role,
    subject,
    contextTemplate,
    placeholder,
    placeholderKey,
    height,
  }: AgentChatBlockProps) =>
    role ? (
      <AgentChat
        title={title}
        roleToken={role}
        subject={subject}
        contextTemplate={contextTemplate}
        placeholder={placeholder}
        placeholderKey={placeholderKey}
        height={height}
      />
    ) : (
      <></>
    ),
};
