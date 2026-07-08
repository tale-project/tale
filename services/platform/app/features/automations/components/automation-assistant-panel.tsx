'use client';

/**
 * Side panel hosting an assistant chat for one installed automation — the
 * developer-facing "ask about this automation" surface, pinned to the platform
 * `workflow-assistant` agent (the same assistant the workflow editor embeds).
 *
 * Threads live on the shared automation-thread rail (`threads/get_or_create_automation_thread`)
 * under `subjectType: 'assistant'` with the automation slug as the subject —
 * deliberately DISTINCT from the `('automation', <automationSlug>)` subject the `AgentChat`
 * block uses for install-scoped member discussions, so the operator's assistant
 * conversation never mixes into an automation-authored discussion view.
 *
 * Visibility is developer-gated by the caller (`automation-page.tsx` checks the
 * `developerSettings` ability); the server stays authoritative on every call the
 * chat pipeline makes.
 */
import { VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useCallback, useMemo } from 'react';

import { Sheet } from '@/app/components/ui/overlays/sheet';
import { EmbeddedChat } from '@/app/features/chat/components/embedded-chat';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

/** The platform assistant agent answering every turn — pinned, never routed. */
const ASSISTANT_AGENT_SLUG = 'workflow-assistant';
/** Automation-thread subject type for the assistant rail (see the file header). */
const ASSISTANT_SUBJECT_TYPE = 'assistant';

export function AutomationAssistantPanel({
  open,
  onOpenChange,
  organizationId,
  automationSlug,
  automationName,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  automationSlug: string;
  automationName: string;
  /** Bound project when opened from a project route — carried into the turn
   *  context and the thread's project scope. */
  projectId?: string;
}) {
  const { t } = useT('automations');

  const { data: existingThread } = useConvexQuery(
    api.threads.get_or_create_automation_thread.getAutomationThread,
    open
      ? {
          organizationId,
          automationSlug: automationSlug,
          subjectType: ASSISTANT_SUBJECT_TYPE,
          subjectId: automationSlug,
        }
      : 'skip',
  );

  const { mutateAsync: getOrCreateThread } = useConvexMutation(
    api.threads.get_or_create_automation_thread.getOrCreateAutomationThread,
    // The embed's send path owns failure UX (toast + optimistic rollback).
    { errorToast: false },
  );
  const resolveThread = useCallback(async (): Promise<string> => {
    const result = await getOrCreateThread({
      organizationId,
      ...(projectId !== undefined && {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route's projectId is the bound project's Convex id (a string in the route contract)
        projectId: projectId as Id<'projects'>,
      }),
      automationSlug: automationSlug,
      subjectType: ASSISTANT_SUBJECT_TYPE,
      subjectId: automationSlug,
      title: automationName,
    });
    return result.threadId;
  }, [
    getOrCreateThread,
    organizationId,
    projectId,
    automationSlug,
    automationName,
  ]);

  // Every turn carries which automation the operator is asking about.
  const additionalContext = useMemo<Record<string, string>>(
    () => ({
      automation_slug: automationSlug,
      automation_name: automationName,
      ...(projectId !== undefined && { project_id: projectId }),
    }),
    [automationSlug, automationName, projectId],
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('assistant.title')}
      description={t('assistant.description')}
      size="md"
    >
      {open && (
        <div className="flex h-full min-h-0 flex-col gap-4">
          <VStack gap={1} className="shrink-0">
            <Text className="text-lg font-semibold">
              {t('assistant.title')}
            </Text>
            <Text variant="muted" className="text-sm">
              {t('assistant.description')}
            </Text>
          </VStack>
          <EmbeddedChat
            organizationId={organizationId}
            agentSlug={ASSISTANT_AGENT_SLUG}
            threadId={existingThread?.threadId ?? null}
            resolveThread={resolveThread}
            additionalContext={additionalContext}
          />
        </div>
      )}
    </Sheet>
  );
}
