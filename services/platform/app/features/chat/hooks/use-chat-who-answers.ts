'use client';

/**
 * Where a chat is filed and who answers in it — the state behind the
 * composer's project and agent controls.
 *
 * A new chat (no thread yet) takes its project from the address
 * (`?projectId=`) and its agent from the person's pick, else the project's
 * default chat agent, which the server applies when the first message
 * creates the chat. An open chat reads both off its row: the project it is
 * filed in, and the agent its conversation answers as — an agent the
 * project no longer has reads as the assistant, as the reply does.
 *
 * Choosing an agent also sets the composer to the agent's model when this
 * person's chat can serve it; that is a seed, not a choice, so it is never
 * saved as their preferred model, and leaving the agent's chat restores
 * their own unless they picked another model meanwhile.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ChatAgentChoice } from '@/app/lib/backend/contract/projects';

import {
  listsPick,
  withDefaultModel,
} from '../components/composer-model-picker';
import {
  useChatProjectAgents,
  useConversationAgent,
} from '../data/chat-backend';
import type {
  ChatModelPick,
  ChatThreadSummary,
  ComposerModelOption,
  ComposerSelection,
} from '../types';

export interface ChatWhoAnswers {
  /** The project the chat is filed in, or will be created in. */
  readonly projectId: string | undefined;
  /** The project's own agents, oldest first — none outside a project. */
  readonly agents: readonly ChatAgentChoice[];
  /** Who the project's new chats start with; null is the assistant. */
  readonly defaultAgentId: string | null;
  /** Who answers now; null is the assistant. */
  readonly agentId: string | null;
  readonly agent: ChatAgentChoice | undefined;
  /** The chosen agent's model cannot answer in this person's chat. */
  readonly agentModelUnserved: boolean;
  readonly chooseAgent: (agentId: string | null) => void;
  /** What a first message creates the chat with: the person's pick, or
   * nothing — the server's default then. */
  readonly newChatAgentId: string | null | undefined;
  /** An explicit model pick: the agent's seed no longer stands in for it. */
  readonly noteModelPicked: () => void;
}

function modelOf(
  agent: ChatAgentChoice,
  models: readonly ComposerModelOption[],
): ComposerModelOption | undefined {
  return (
    models.find(
      (model) =>
        model.id === agent.model &&
        (agent.modelProvider === null ||
          model.providerSlug === agent.modelProvider),
    ) ?? undefined
  );
}

export function useChatWhoAnswers({
  organizationId,
  threadId,
  draftProjectId,
  thread,
  models,
  preferredPick,
  setSelection,
  onSaveFailed,
  draftProjectKnown = true,
}: {
  organizationId: string;
  threadId: string | undefined;
  /** The project a new chat is being started in (the address's). */
  draftProjectId: string | undefined;
  /** False once the person's projects answered without it (a stale link,
   * a project archived or deleted since): there are no agents to read. */
  draftProjectKnown?: boolean;
  /** The open chat's row, once it has answered. */
  thread: ChatThreadSummary | undefined;
  models: readonly ComposerModelOption[];
  /** The person's own saved model, restored when an agent's seed ends. */
  preferredPick: ChatModelPick | undefined;
  setSelection: (
    update: (previous: ComposerSelection) => ComposerSelection,
  ) => void;
  /** A change of agent the server did not take. */
  onSaveFailed: () => void;
}): ChatWhoAnswers {
  const projectId = threadId === undefined ? draftProjectId : thread?.projectId;
  const chatAgents = useChatProjectAgents(
    organizationId,
    threadId === undefined && !draftProjectKnown ? undefined : projectId,
  );
  const answered = chatAgents.status === 'ready' ? chatAgents.data : undefined;
  const agents = useMemo(() => answered?.agents ?? [], [answered]);
  const defaultAgentId = answered?.defaultAgentId ?? null;
  const conversationAgent = useConversationAgent(organizationId);

  // A new chat's pick, for the project it is being started in.
  const [draftPick, setDraftPick] = useState<{
    projectId: string | undefined;
    agentId: string | null;
  } | null>(null);
  // An open chat's change while the row catches up with it.
  const [pendingPick, setPendingPick] = useState<{
    threadId: string;
    agentId: string | null;
  } | null>(null);

  const storedAgentId = thread?.chatAgentId ?? null;
  useEffect(() => {
    if (pendingPick === null) return;
    if (
      pendingPick.threadId !== threadId ||
      pendingPick.agentId === storedAgentId
    ) {
      setPendingPick(null);
    }
  }, [pendingPick, threadId, storedAgentId]);

  const draftAgentId =
    draftPick !== null && draftPick.projectId === projectId
      ? draftPick.agentId
      : undefined;
  // A pick of the assistant is null — a choice, never "no pick".
  const wantedAgentId: string | null =
    threadId === undefined
      ? draftAgentId !== undefined
        ? draftAgentId
        : defaultAgentId
      : pendingPick !== null && pendingPick.threadId === threadId
        ? pendingPick.agentId
        : storedAgentId;
  // An agent the project does not have (deleted, another project's) answers
  // as nobody: the reply runs as the assistant, and so does the control.
  const agent =
    wantedAgentId === null
      ? undefined
      : agents.find((row) => row.id === wantedAgentId);
  const agentId = agent?.id ?? null;
  const agentModel = agent === undefined ? undefined : modelOf(agent, models);
  const agentModelUnserved =
    agent !== undefined && models.length > 0 && agentModel === undefined;

  const chooseAgent = useCallback(
    (next: string | null) => {
      if (threadId === undefined) {
        setDraftPick({ projectId, agentId: next });
        return;
      }
      setPendingPick({ threadId, agentId: next });
      void conversationAgent.save(threadId, next).then((saved) => {
        if (saved) return;
        setPendingPick(null);
        onSaveFailed();
      });
    },
    [threadId, projectId, conversationAgent, onSaveFailed],
  );

  // The agent's model is the composer's while the agent answers — once per
  // conversation and agent, so a model the person picks afterwards stands.
  const seededFor = useRef<string | null>(null);
  const seededModel = useRef<ChatModelPick | null>(null);
  const contextKey = threadId ?? `new:${projectId ?? ''}`;
  useEffect(() => {
    if (models.length === 0) return;
    if (agent === undefined) {
      seededFor.current = null;
      const seeded = seededModel.current;
      if (seeded === null) return;
      seededModel.current = null;
      // Leaving the agent's chat: the person's own model again, unless they
      // picked one meanwhile (which cleared the seed).
      setSelection((previous) => {
        if (
          previous.modelId !== seeded.modelId ||
          previous.providerSlug !== seeded.providerSlug
        ) {
          return previous;
        }
        const { modelId: _model, providerSlug: _provider, ...rest } = previous;
        return withDefaultModel(rest, models, preferredPick);
      });
      return;
    }
    const key = `${contextKey}:${agent.id}`;
    if (seededFor.current === key) return;
    seededFor.current = key;
    if (agentModel === undefined) return;
    if (!listsPick(models, agentModel.id, agentModel.providerSlug)) return;
    seededModel.current = {
      modelId: agentModel.id,
      providerSlug: agentModel.providerSlug,
    };
    setSelection((previous) => {
      const { modelSelection: _auto, ...rest } = previous;
      return {
        ...rest,
        modelId: agentModel.id,
        providerSlug: agentModel.providerSlug,
      };
    });
  }, [agent, agentModel, contextKey, models, preferredPick, setSelection]);

  const noteModelPicked = useCallback(() => {
    seededModel.current = null;
  }, []);

  return {
    projectId,
    agents,
    defaultAgentId,
    agentId,
    agent,
    agentModelUnserved,
    chooseAgent,
    newChatAgentId: draftAgentId,
    noteModelPicked,
  };
}
