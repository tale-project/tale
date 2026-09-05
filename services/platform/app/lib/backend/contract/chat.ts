/**
 * `chat` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../chat.ts` are what
 * actually serve them.
 */

import type { MessagePart } from '@/lib/chat/types';

export interface ChatContract {
  'chat/arena:getArenaPair': {
    kind: 'query';
    args: { organizationId: string; threadId: string };
    returns: null | {
      pairId: string;
      threadIdA: string;
      threadIdB: string;
      createdAt: number;
    };
  };
  'chat/branches:listThreadBranches': {
    kind: 'query';
    args: { organizationId: string; rootThreadId: string };
    returns: {
      branches: Array<{
        id: string;
        parentId: string;
        forkSequence: number;
        createdAt: number;
      }>;
      selections: null | string;
    };
  };
  'chat/composer:listAutomationCapabilities': {
    kind: 'action';
    args: { projectId?: string; organizationId: string };
    returns: {
      skills: Array<{
        description?: string;
        icon?: string;
        slug: string;
        label: string;
      }>;
      connectors: Array<{
        description?: string;
        icon?: string;
        slug: string;
        label: string;
      }>;
    };
  };
  'chat/composer:listComposerModels': {
    kind: 'action';
    args: { organizationId: string };
    returns: {
      models: Array<{
        reasoning?: {
          toolsRequireOff?: boolean;
          knob: 'effort' | 'budget-tokens';
        };
        vision?: boolean;
        id: string;
        providerSlug: string;
        label: string;
        providerLabel: string;
        credential:
          | { authMethod: 'api-key' }
          | { authMethod: 'env' }
          | {
              authMethod: 'subscription-key';
              constraints: { harness: string; execution: 'sandbox' };
            }
          | {
              authMethod: 'subscription-broker';
              constraints: { harness: string; execution: 'sandbox' };
            };
      }>;
      harnesses: Array<{
        harness: string;
        label: string;
        iconUrl: undefined | string;
      }>;
      voice: { ttsAvailable: boolean; transcriptionAvailable: boolean };
    };
  };
  'chat/composer:listProjectCapabilities': {
    kind: 'action';
    args: { organizationId: string; projectId: string };
    returns: {
      skills: Array<{
        description?: string;
        icon?: string;
        slug: string;
        label: string;
      }>;
      connectors: Array<{
        description?: string;
        icon?: string;
        slug: string;
        label: string;
      }>;
    };
  };
  'chat/memories:listMemories': {
    kind: 'query';
    args: { organizationId: string };
    returns: {
      pending: Array<{ id: string; content: string }>;
      approved: Array<{ id: string; content: string }>;
    };
  };
  'chat/messages:getOrgChatHealth': {
    kind: 'query';
    args: { organizationId: string; periodDays: 1 | 7 | 30 };
    returns: {
      summary: {
        totalTurns: number;
        errorCount: number;
        errorRate: number;
        blockedCount: number;
        blockedRate: number;
        tokens: { input: number; output: number; total: number };
        capped: boolean;
        hasAnyData: boolean;
      };
      series: Array<{
        dateKey: string;
        turns: number;
        errors: number;
        blocked: number;
      }>;
      byModel: Array<{ provider: string; model: string; count: number }>;
      byAgent: Array<{ agentSlug: string; count: number }>;
      errorsByType: Array<{ key: string; count: number }>;
      recentErrors: Array<{
        at: number;
        type: string;
        model?: string;
        agentSlug?: string;
      }>;
    };
  };
  'chat/messages:listMessages': {
    kind: 'query';
    args: { organizationId: string; threadId: string };
    returns: Array<{
      id: string;
      role: 'user' | 'assistant' | 'tool' | 'system';
      parts: MessagePart[];
      sequence: number;
      model: undefined | string;
      providerSlug: undefined | string;
      usage: unknown;
      blockedReason: undefined | string;
      error: undefined | string;
      createdAt: number;
    }>;
  };
  'chat/project_threads:listThreadsForProject': {
    kind: 'query';
    args: { organizationId: string; projectId: string };
    returns: {
      mine: Array<{
        id: string;
        title: undefined | string;
        updatedAt: number;
        sharedWithProject: undefined | boolean;
        userId: string;
        authorName: null | string;
      }>;
      shared: Array<{
        id: string;
        title: undefined | string;
        updatedAt: number;
        sharedWithProject: undefined | boolean;
        userId: string;
        authorName: null | string;
      }>;
    };
  };
  'chat/questions:getPendingQuestion': {
    kind: 'query';
    args: { organizationId: string; threadId: string };
    returns: null | {
      requestId: string;
      set: {
        questions: Array<{
          id: string;
          question: string;
          options: Array<{
            label: string;
            description?: string;
            recommended?: boolean;
          }>;
          header?: string;
          multiSelect?: boolean;
        }>;
        intro?: string;
      };
    };
  };
  'chat/search:searchChats': {
    kind: 'query';
    args: { organizationId: string; query: string };
    returns: Array<{
      threadId: string;
      title?: string;
      snippet: string;
      updatedAt: number;
    }>;
  };
  'chat/threads:getSharedThread': {
    kind: 'query';
    args: { shareToken: string };
    returns: null | {
      threadId: string;
      title: undefined | string;
      sharedBy: string;
      sharedAt: number;
      agentSlug: undefined | string;
      messages: Array<{
        id: string;
        role: 'user' | 'assistant' | 'tool' | 'system';
        parts: MessagePart[];
        sequence: number;
        model: undefined | string;
        providerSlug: undefined | string;
        blockedReason: undefined | string;
        error: undefined | string;
        createdAt: number;
      }>;
    };
  };
  'chat/threads:getThread': {
    kind: 'query';
    args: { organizationId: string; threadId: string };
    returns: null | {
      id: string;
      title?: string;
      kind: 'sandbox' | 'direct';
      agentSlug?: string;
      harness?: string;
      capabilities?: { skills: string[]; connectors: string[] };
      reasoningEffort?: 'low' | 'medium' | 'high' | 'extra' | 'max';
      projectId?: string;
      sharedWithProject?: boolean;
      archived: boolean;
      pinnedAt?: number;
      lastReplyAt?: number;
      lastReadAt?: number;
      isShared?: boolean;
      inArena?: boolean;
      createdAt: number;
      updatedAt: number;
      generating: boolean;
      viewerIsOwner: boolean;
    };
  };
  'chat/threads:getThreadShareStatus': {
    kind: 'query';
    args: { organizationId: string; threadId: string };
    returns: null | {
      isShared: boolean;
      shareToken: null | string;
      sharedAt: null | number;
      isShareable: boolean;
    };
  };
  'chat/threads:listArchivedThreads': {
    kind: 'query';
    args: { cursor?: number; limit?: number; organizationId: string };
    returns: {
      rows: Array<{
        id: string;
        title?: string;
        kind: 'sandbox' | 'direct';
        agentSlug?: string;
        harness?: string;
        capabilities?: { skills: string[]; connectors: string[] };
        reasoningEffort?: 'low' | 'medium' | 'high' | 'extra' | 'max';
        projectId?: string;
        sharedWithProject?: boolean;
        archived: boolean;
        pinnedAt?: number;
        lastReplyAt?: number;
        lastReadAt?: number;
        isShared?: boolean;
        inArena?: boolean;
        createdAt: number;
        updatedAt: number;
        generating: boolean;
        viewerIsOwner: boolean;
      }>;
      nextCursor: null | number;
    };
  };
  'chat/threads:listThreads': {
    kind: 'query';
    args: { organizationId: string };
    returns: Array<{
      id: string;
      title?: string;
      kind: 'sandbox' | 'direct';
      agentSlug?: string;
      harness?: string;
      capabilities?: { skills: string[]; connectors: string[] };
      reasoningEffort?: 'low' | 'medium' | 'high' | 'extra' | 'max';
      projectId?: string;
      sharedWithProject?: boolean;
      archived: boolean;
      pinnedAt?: number;
      lastReplyAt?: number;
      lastReadAt?: number;
      isShared?: boolean;
      inArena?: boolean;
      createdAt: number;
      updatedAt: number;
      generating: boolean;
      viewerIsOwner: boolean;
    }>;
  };
  'chat/threads:setThreadSharedWithProject': {
    kind: 'mutation';
    args: { shared: boolean; organizationId: string; threadId: string };
    returns: boolean;
  };
}
