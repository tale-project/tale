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
import { DEFAULT_CHAT_AGENT_SLUG } from '@/lib/shared/constants/agents';

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
  /**
   * Secondary thread ID for arena mode. When set, pending message matches
   * both `threadId` (column A) and `arenaThreadIdB` (column B).
   */
  arenaThreadIdB?: string;
}

export interface SelectedAgent {
  name: string;
  displayName: string;
}

/**
 * Default composer selection: pin the general-purpose chat agent rather than
 * Auto. New sessions (no persisted choice) open on the Assistant because it's
 * faster — Auto must first run a routing classifier to decide which agent
 * should answer (extra latency before the first token), whereas the Assistant
 * is suitable for most messages and starts replying immediately. Users can
 * still switch to Auto or any specialist. `displayName` here is only a fallback
 * label — the selector renders the catalogue-resolved (localized) name once the
 * agent list loads, so this placeholder is never user-visible in practice.
 */
const DEFAULT_SELECTED_AGENT: SelectedAgent = {
  name: DEFAULT_CHAT_AGENT_SLUG,
  displayName: 'Assistant',
};

/**
 * Reference to an image that should be attached to the next composer
 * submission as an edit target (for primaryBehavior='image-generation' agents).
 * Set explicitly via the ↻ Edit button or the ThumbnailPicker popover; when
 * null, the EditingBanner falls back to the latest image in the thread.
 */
export interface EditingImageRef {
  fileId: string;
  url: string;
  mimeType: string;
  fileName?: string;
}

/** Internal storage shape — includes expiry timestamp per override. */
interface ModelOverrideEntry {
  modelId: string;
  expiresAt: number;
}

const MODEL_OVERRIDE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface ChatLayoutContextType {
  pendingThreadId: string | null;
  setPendingThreadId: (threadId: string | null) => void;
  clearChatState: () => void;
  pendingMessage: PendingMessage | null;
  setPendingMessage: (message: PendingMessage | null) => void;
  selectedAgent: SelectedAgent | null;
  setSelectedAgent: (agent: SelectedAgent | null) => void;
  selectedModelOverrides: Record<string, string>;
  setSelectedModelOverride: (agentName: string, modelId: string | null) => void;
  /**
   * Integration slugs toggled ON as composer capabilities.
   * Persisted per user+org; sent with every chatWithAgent call.
   */
  enabledCapabilities: string[];
  setCapabilityEnabled: (slug: string, enabled: boolean) => void;
  /** Content inserted from the sidebar prompt section — consumed by ChatInterface */
  insertedPrompt: string | null;
  setInsertedPrompt: (content: string | null) => void;
  /**
   * Text the user selected inside a chat message and chose to "quote" into
   * their next message. Rendered as a removable chip above the composer and
   * prepended as a markdown blockquote on send. Null when no quote is staged.
   */
  quotedText: string | null;
  setQuotedText: (text: string | null) => void;
  /**
   * Explicit editing target, set via ↻ Edit button or ThumbnailPicker. When
   * non-null, overrides the "latest image" auto-pick in EditingBanner.
   */
  editingImageRef: EditingImageRef | null;
  setEditingImageRef: (ref: EditingImageRef | null) => void;
  /**
   * Image key (from useThreadImages) the user dismissed via × on the banner.
   * Kept in state so that when a NEW image lands, its key differs from this
   * and the banner re-appears automatically.
   */
  dismissedImageKey: string | null;
  setDismissedImageKey: (key: string | null) => void;
  /**
   * Working directory staged from the composer's Sandbox pill BEFORE the
   * thread exists (an external-agent new chat). Consumed by `useSendMessage`:
   * applied to the thread it creates right after creation — ahead of the
   * first turn, which reads it at sandbox session start — then cleared.
   * Deliberately session state, not persisted: a workdir is a
   * per-conversation choice, not a durable preference.
   */
  pendingSandboxWorkdir: string;
  setPendingSandboxWorkdir: (workdir: string) => void;
  /**
   * Chat sub-panel (project/chat history) visibility on desktop. Persisted
   * per user+org; toggled from the chat top bar.
   */
  isHistoryPanelOpen: boolean;
  toggleHistoryPanel: () => void;
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
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(
    null,
  );
  const [insertedPrompt, setInsertedPrompt] = useState<string | null>(null);
  const [quotedText, setQuotedText] = useState<string | null>(null);
  const [editingImageRef, setEditingImageRef] =
    useState<EditingImageRef | null>(null);
  const [dismissedImageKey, setDismissedImageKey] = useState<string | null>(
    null,
  );
  const [pendingSandboxWorkdir, setPendingSandboxWorkdir] = useState('');
  const agentKey = user?.userId
    ? `selected-agent-${user.userId}-${organizationId}`
    : `selected-agent-${organizationId}`;
  const [selectedAgent, setSelectedAgent] =
    usePersistedState<SelectedAgent | null>(agentKey, DEFAULT_SELECTED_AGENT);

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
        // Legacy format (no expiry) — preserve; still resolves via the
        // first-match provider path. Re-saves will upgrade to TTL format.
        result[key] = value;
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

  // Org-scoped, NOT user-scoped like the other keys here, on purpose: the
  // pre-hydration script in index.html reads this exact key before auth (or
  // any JS bundle) runs to decide whether the served boot shell shows the
  // chat sub-panel skeleton — it can't know the user id. A user-scoped key
  // would also flip mid-session (this provider mounts before `user`
  // resolves), re-reading storage under the new key and visibly sliding a
  // collapsed panel open/shut on every reload. Panel visibility is layout
  // chrome, device-scoped like `tale-theme`.
  const [isHistoryPanelOpen, setHistoryPanelOpen] = usePersistedState(
    `chat-history-panel-open-${organizationId}`,
    true,
  );
  const toggleHistoryPanel = useCallback(() => {
    setHistoryPanelOpen((prev) => !prev);
  }, [setHistoryPanelOpen]);

  const capabilityKey = user?.userId
    ? `enabled-capabilities-${user.userId}-${organizationId}`
    : `enabled-capabilities-${organizationId}`;
  const [enabledCapabilitiesRaw, setEnabledCapabilitiesRaw] = usePersistedState<
    string[]
  >(capabilityKey, []);
  const enabledCapabilities = useMemo(
    () => (Array.isArray(enabledCapabilitiesRaw) ? enabledCapabilitiesRaw : []),
    [enabledCapabilitiesRaw],
  );
  const setCapabilityEnabled = useCallback(
    (slug: string, enabled: boolean) => {
      setEnabledCapabilitiesRaw((prev) => {
        const current = Array.isArray(prev) ? prev : [];
        if (enabled) {
          if (current.includes(slug)) return current;
          return [...current, slug];
        }
        return current.filter((s) => s !== slug);
      });
    },
    [setEnabledCapabilitiesRaw],
  );

  const clearChatState = useCallback(() => {
    setPendingThreadId(null);
    setPendingMessage(null);
    setEditingImageRef(null);
    setDismissedImageKey(null);
    setQuotedText(null);
  }, []);

  const value = useMemo(
    () => ({
      pendingThreadId,
      setPendingThreadId,
      clearChatState,
      pendingMessage,
      setPendingMessage,
      selectedAgent,
      setSelectedAgent,
      selectedModelOverrides,
      setSelectedModelOverride,
      enabledCapabilities,
      setCapabilityEnabled,
      insertedPrompt,
      setInsertedPrompt,
      quotedText,
      setQuotedText,
      editingImageRef,
      setEditingImageRef,
      dismissedImageKey,
      setDismissedImageKey,
      pendingSandboxWorkdir,
      setPendingSandboxWorkdir,
      isHistoryPanelOpen,
      toggleHistoryPanel,
    }),
    [
      pendingThreadId,
      clearChatState,
      pendingMessage,
      selectedAgent,
      setSelectedAgent,
      selectedModelOverrides,
      setSelectedModelOverride,
      enabledCapabilities,
      setCapabilityEnabled,
      insertedPrompt,
      quotedText,
      editingImageRef,
      dismissedImageKey,
      pendingSandboxWorkdir,
      isHistoryPanelOpen,
      toggleHistoryPanel,
    ],
  );

  return (
    <ChatLayoutContext.Provider value={value}>
      {children}
    </ChatLayoutContext.Provider>
  );
}
