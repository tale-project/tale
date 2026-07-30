/**
 * The vocabulary the chat UI renders.
 *
 * These are VIEW MODELS, not table rows: they mirror the shapes the chat
 * layer already owns (`lib/chat/types.ts` for message parts,
 * `convex/chat/schema.ts` for threads, messages, and the live generation)
 * reduced to what a screen needs. Components take them as props, so every
 * component renders from data a test can hand it directly.
 */

import type { ReasoningEffort } from '@/lib/chat/effort';
import type { MessagePart } from '@/lib/chat/types';
import type { CredentialAuth } from '@/lib/shared/providers/resolve_execution';

export type { MessagePart };

/** Where a thread's turns ran. `sandbox` survives only on rows written
 * before the chat page became direct-only — rendered read-only-ish, never
 * creatable. */
export type ChatThreadKind = 'direct' | 'sandbox';

/** One row of the thread list. */
export interface ChatThreadSummary {
  readonly id: string;
  readonly title?: string;
  readonly kind: ChatThreadKind;
  /** The owner's explicit reasoning-effort pick for the conversation — the
   * composer re-hydrates its effort control from this. */
  readonly reasoningEffort?: ReasoningEffort;
  /** The project the thread is filed under (absent = the loose Chats list). */
  readonly projectId?: string;
  /** Owner's opt-in: readable by everyone with access to its project. */
  readonly sharedWithProject?: boolean;
  readonly archived: boolean;
  /** Present while pinned — pinned rows float to the top of the list. */
  readonly pinnedAt?: number;
  /** Unread tracking: newest assistant activity vs. the owner's watermark. */
  readonly lastReplyAt?: number;
  readonly lastReadAt?: number;
  /** True while the thread is published as an org-internal snapshot link. */
  readonly isShared?: boolean;
  /** True while the row is column A of a live arena pair. */
  readonly inArena?: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** True while a generation row exists for the thread. */
  readonly generating: boolean;
  /** False when a project member reads someone else's project-shared
   * conversation — the surface renders read-only then. Absent reads as
   * true (every list row is the caller's own). */
  readonly viewerIsOwner?: boolean;
}

/** One project folder of the chat sub-panel, reduced to what a folder row
 * renders. */
export interface ChatProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  readonly color?: string;
  readonly pinnedAt?: number;
}

export type ChatMessageRole = 'user' | 'assistant' | 'tool' | 'system';

/**
 * Token counts and timings as the turn pipeline stamped them (`usage` is a
 * free-shape blob server-side, so every field reads as optional and the info
 * panel hides what a turn did not record).
 */
export interface ChatMessageUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly reasoningTokens?: number;
  readonly cachedInputTokens?: number;
  readonly durationMs?: number;
  readonly timeToFirstTokenMs?: number;
}

/** One rendered message. `parts` is authored order and is rendered in it. */
export interface ChatMessageView {
  readonly id: string;
  readonly role: ChatMessageRole;
  readonly parts: readonly MessagePart[];
  readonly sequence: number;
  readonly model?: string;
  readonly providerSlug?: string;
  /** Token counts and turn timings, when the pipeline recorded them. */
  readonly usage?: ChatMessageUsage;
  /** Set when a guardrail refused or altered the message. */
  readonly blockedReason?: string;
  readonly error?: string;
  readonly createdAt: number;
}

/**
 * One thread-view row as the conversation renders it: the message view plus
 * the streaming facts the thread-view hook resolves from the live generation.
 * Rows come from `useThreadView`, which holds object identity across pushes —
 * a row's reference changes only when a field a component renders changed.
 */
export interface ChatMessageItem extends ChatMessageView {
  /** Stable React key. Real rows use their id; the optimistic rows the send
   * path inserts before the server ack use synthetic `pending-*` keys. */
  readonly key: string;
  /**
   * The message's plain text (text parts joined). For the row a live turn is
   * writing this is the in-flight streamed text, which lives on the
   * generation row — the message row's own parts stay empty until finalize.
   */
  readonly text: string;
  /** The model's reasoning ("thinking") text, while and after it streams. */
  readonly reasoningText?: string;
  /** True while the live turn is writing this row. Latched: a transient
   * subscription gap never flaps it off mid-stream. */
  readonly isStreaming: boolean;
  /**
   * True on a row that finished streaming during this mount: the reveal
   * animation drains to the end instead of the settled text popping in, and
   * settle-gated chrome (the toolbar) can wait for the drain.
   */
  readonly isFinalReveal: boolean;
  /** True for the optimistic rows the send path inserts before the ack. */
  readonly isPendingShell?: boolean;
}

/**
 * The live turn. The existence of this object IS the "is generating" signal —
 * it mirrors the `generations` row, which is deleted when the turn settles.
 */
export interface ChatGenerationView {
  readonly status:
    | 'queued'
    | 'streaming'
    | 'waiting-approval'
    | 'waiting-input';
  /** What the turn is blocked on, when waiting. */
  readonly waitingOn?: string;
  /** The assistant message being written, once it exists. */
  readonly messageId?: string;
}

/** A model the composer can pick, under the "Models" group. */
export interface ComposerModelOption {
  readonly id: string;
  readonly label: string;
  readonly providerSlug: string;
  /** Present when the model's reasoning depth is controllable. */
  readonly reasoning?: { readonly knob: 'effort' | 'budget-tokens' };
  /**
   * The credential that would serve this model, in the exact shape execution
   * resolution reads — so the composer asks the resolver instead of
   * re-deriving which credentials force a sandbox.
   */
  readonly credential: CredentialAuth;
}

/**
 * What the composer sends. Model selection only — the chat page offers no
 * agent, skill, or sandbox pick (the Chat·Task·Automation boundary); the
 * reasoning effort is a property of the picked model.
 */
export interface ComposerSelection {
  /** The chosen model. */
  readonly modelId?: string;
  /**
   * The provider serving the chosen model. Distinguishes the copies when
   * more than one configured provider lists the same model id; absent means
   * "whichever provider resolves first" (the pre-provider-pick behavior).
   */
  readonly providerSlug?: string;
  /** The reasoning-effort pick riding the next turn; absent samples the
   * default (and a pick is silently ignored by non-reasoning models). */
  readonly reasoningEffort?: ReasoningEffort;
}
