'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

import { useAuth } from '@/app/hooks/use-convex-auth';
import { usePersistedState } from '@/app/hooks/use-persisted-state';

interface PendingMessageAttachment {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

export interface PendingMessage {
  content: string;
  threadId: string;
  attachments?: PendingMessageAttachment[];
  timestamp: Date;
  lastMessageKey?: string;
  /**
   * When set, this is an edit-and-branch operation: replace the message with
   * this ID and truncate everything after it, instead of appending a new message.
   * Cleared when dataThreadId changes (branch subscription caught up).
   */
  editedMessageId?: string;
}

export interface SelectedAgent {
  name: string;
  displayName: string;
}

/** Internal storage shape — includes expiry timestamp per override. */
interface ModelOverrideEntry {
  modelId: string;
  expiresAt: number;
}

const MODEL_OVERRIDE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface ChatLayoutContextType {
  isPending: boolean;
  setIsPending: (pending: boolean) => void;
  pendingThreadId: string | null;
  setPendingThreadId: (threadId: string | null) => void;
  clearChatState: () => void;
  pendingMessage: PendingMessage | null;
  setPendingMessage: (message: PendingMessage | null) => void;
  isHistoryOpen: boolean;
  setIsHistoryOpen: (open: boolean) => void;
  selectedAgent: SelectedAgent | null;
  setSelectedAgent: (agent: SelectedAgent | null) => void;
  selectedModelOverrides: Record<string, string>;
  setSelectedModelOverride: (agentName: string, modelId: string | null) => void;
}

const ChatLayoutContext = createContext<ChatLayoutContextType | null>(null);

export function useChatLayout() {
  const context = useContext(ChatLayoutContext);
  if (!context) {
    throw new Error('useChatLayout must be used within ChatLayoutProvider');
  }
  return context;
}

interface ChatLayoutProviderProps {
  organizationId: string;
  children: ReactNode;
}

export function ChatLayoutProvider({
  organizationId,
  children,
}: ChatLayoutProviderProps) {
  const { user } = useAuth();
  const [isPending, setIsPending] = useState(false);
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(
    null,
  );
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const agentKey = user?.userId
    ? `selected-agent-${user.userId}-${organizationId}`
    : `selected-agent-${organizationId}`;
  const [selectedAgent, setSelectedAgent] =
    usePersistedState<SelectedAgent | null>(agentKey, null);

  const modelOverridesKey = user?.userId
    ? `selected-models-${user.userId}-${organizationId}`
    : `selected-models-${organizationId}`;
  const [rawModelOverrides, setRawModelOverrides] = usePersistedState<
    Record<string, ModelOverrideEntry | string>
  >(modelOverridesKey, {});

  // Expose a flat Record<string, string> to consumers, filtering out expired entries.
  const selectedModelOverrides = useMemo(() => {
    const now = Date.now();
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawModelOverrides)) {
      if (typeof value === 'string') {
        // Legacy format (no expiry) — treat as expired
        continue;
      }
      if (value.expiresAt > now) {
        result[key] = value.modelId;
      }
    }
    return result;
  }, [rawModelOverrides]);

  const setSelectedModelOverride = useCallback(
    (agentName: string, modelId: string | null) => {
      setRawModelOverrides((prev) => {
        if (modelId === null) {
          const { [agentName]: _, ...rest } = prev;
          return rest;
        }
        return {
          ...prev,
          [agentName]: {
            modelId,
            expiresAt: Date.now() + MODEL_OVERRIDE_TTL_MS,
          },
        };
      });
    },
    [setRawModelOverrides],
  );

  const clearChatState = useCallback(() => {
    setIsPending(false);
    setPendingThreadId(null);
    setPendingMessage(null);
  }, []);

  const value = useMemo(
    () => ({
      isPending,
      setIsPending,
      pendingThreadId,
      setPendingThreadId,
      clearChatState,
      pendingMessage,
      setPendingMessage,
      isHistoryOpen,
      setIsHistoryOpen,
      selectedAgent,
      setSelectedAgent,
      selectedModelOverrides,
      setSelectedModelOverride,
    }),
    [
      isPending,
      pendingThreadId,
      clearChatState,
      pendingMessage,
      isHistoryOpen,
      selectedAgent,
      setSelectedAgent,
      selectedModelOverrides,
      setSelectedModelOverride,
    ],
  );

  return (
    <ChatLayoutContext.Provider value={value}>
      {children}
    </ChatLayoutContext.Provider>
  );
}
