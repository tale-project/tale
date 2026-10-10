import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useMemo } from 'react';

import {
  agentLegacyHandleVariants,
  agentMentionEntry,
  automationMentionEntry,
  emailHandle,
  MENTION_HANDLE_TIER,
  type MentionActorEntry,
  type MentionKind,
  memberMentionEntry,
} from '@/lib/shared/mention-handles';

import { useAssignableActors } from '../hooks/use-actor-directory';
import {
  useTaskContractAutomations,
  taskSubjectEntries,
} from '../hooks/use-task-subject-contract';

export interface MentionActorOption {
  type: MentionKind;
  id: string;
  name: string;
  email?: string;
  /** What the picker shows after `@` and finds it by: an agent's handle, a
   * person's email name, an automation's store name. */
  handle?: string;
  /** Other handles it answers to (a person's name with dots), which find it
   * too. */
  keywords?: readonly string[];
}

/** The handles of an entry a person may type to find it: every one but its
 * id, which nobody types. */
function typedHandles(entry: MentionActorEntry): string[] {
  return entry.handles
    .filter(({ tier }) => tier !== MENTION_HANDLE_TIER.id)
    .map(({ handle }) => handle);
}

/**
 * Mentionable actors for a project, in picker order: org members first, then
 * agents, then the automations operating this board — the same population the
 * server resolves mentions against (`backend/domains/collab/mention-directory.ts`).
 * Agents are the project's own agent instances. Automations are the deployed
 * subject-contract ones the assignee picker offers — @-ing a task's OWNING
 * automation puts it to work, exactly like @-ing an agent instance.
 *
 * A picked mention is stored as whom it names, so anyone can be offered,
 * whatever their name: the handle is how the picker finds and shows them.
 */
export function useMentionActorOptions(
  organizationId: string,
  projectId: string,
): MentionActorOption[] {
  const { assignableMembers, assignableAgents, currentUserId } =
    useAssignableActors(organizationId, projectId);
  const automations = useTaskContractAutomations(organizationId, projectId);
  const { locale } = useLocale();

  return useMemo(() => {
    const options: MentionActorOption[] = [];
    for (const member of assignableMembers) {
      // You never need to @mention yourself — leave the current user out.
      if (member.id === currentUserId) continue;
      const entry = memberMentionEntry({
        id: member.id,
        name: member.name,
        email: member.email,
      });
      const handle = emailHandle(member.email);
      options.push({
        type: 'user',
        id: member.id,
        name: member.name,
        ...(member.email !== undefined ? { email: member.email } : {}),
        ...(handle !== null ? { handle } : {}),
        keywords: typedHandles(entry),
      });
    }
    for (const agent of assignableAgents) {
      const entry = agentMentionEntry({
        id: agent.id,
        name: agent.name,
        handle: agent.handle ?? null,
        legacyHandles:
          agent.legacyHandles ?? agentLegacyHandleVariants(agent.name),
      });
      options.push({
        type: 'agent',
        id: agent.id,
        name: agent.name,
        ...(agent.handle !== undefined ? { handle: agent.handle } : {}),
        keywords: typedHandles(entry),
      });
    }
    for (const automation of taskSubjectEntries(automations, locale)) {
      const entry = automationMentionEntry({
        slug: automation.automationSlug,
        name: automation.displayName,
      });
      options.push({
        type: 'automation',
        id: automation.automationSlug,
        name: automation.displayName,
        handle: automation.automationSlug,
        keywords: typedHandles(entry),
      });
    }
    return options;
  }, [assignableMembers, assignableAgents, automations, currentUserId, locale]);
}
