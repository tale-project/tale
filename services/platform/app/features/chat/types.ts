/**
 * The vocabulary the chat UI renders.
 *
 * These are VIEW MODELS, not table rows: they mirror the shapes the chat
 * layer already owns (`lib/chat/types.ts` for message parts,
 * `convex/chat/schema.ts` for threads, messages, and the live generation)
 * reduced to what a screen needs. Components take them as props, so every
 * component renders from data a test can hand it directly.
 */

import type { MessagePart } from '@/lib/chat/types';
import type { CredentialAuth } from '@/lib/shared/providers/resolve_execution';

import type { ChatThreadKind } from './lib/canvas-modes';

export type { MessagePart };

/** One row of the thread list. */
export interface ChatThreadSummary {
  readonly id: string;
  readonly title?: string;
  readonly kind: ChatThreadKind;
  readonly agentSlug?: string;
  /** The external agent pinned to a sandbox thread (absent on direct threads). */
  readonly harness?: string;
  /** The project the thread is filed under (absent = the loose Chats list). */
  readonly projectId?: string;
  readonly archived: boolean;
  /** True while the thread is published as an org-internal snapshot link. */
  readonly isShared?: boolean;
  readonly updatedAt: number;
  /** True while a generation row exists for the thread. */
  readonly generating: boolean;
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

/** One rendered message. `parts` is authored order and is rendered in it. */
export interface ChatMessageView {
  readonly id: string;
  readonly role: ChatMessageRole;
  readonly parts: readonly MessagePart[];
  readonly sequence: number;
  readonly model?: string;
  readonly providerSlug?: string;
  /** Set when a guardrail refused or altered the message. */
  readonly blockedReason?: string;
  readonly error?: string;
  readonly createdAt: number;
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
  /**
   * The credential that would serve this model, in the exact shape execution
   * resolution reads — so the composer asks the resolver instead of
   * re-deriving which credentials force a sandbox.
   */
  readonly credential: CredentialAuth;
}

/**
 * A third-party agent the composer can pick — an external harness
 * (Claude Code, Codex) that runs the turn in a sandbox and brings its own
 * model. (The field is still named for the harness it maps to.)
 */
export interface ComposerExternalAgentOption {
  readonly harness: string;
  readonly label: string;
}

/** An agent configuration the slim agent picker offers. */
export interface ChatAgentOption {
  readonly slug: string;
  readonly label: string;
  readonly description?: string;
}

/**
 * Which kind of agent answers the turn. `platform` is the first-party
 * assistant that runs a model directly; `external` is a third-party harness that
 * runs in a sandbox. The kind — not a separate switch — decides where the turn
 * runs, so there is no sandbox toggle in the selection.
 */
export type ComposerAgentKind = 'platform' | 'external';

/** A skill or connector a conversation can equip its agent with. */
export interface ComposerCapabilityOption {
  readonly slug: string;
  readonly label: string;
  readonly description?: string;
}

/** What the composer sends. */
export interface ComposerSelection {
  readonly agentKind: ComposerAgentKind;
  /** The platform agent's chosen model. */
  readonly modelId?: string;
  /** The third-party agent's harness. */
  readonly harness?: string;
  /** Org skill slugs the conversation equips its agent with. */
  readonly skills: readonly string[];
  /** Enabled-connector slugs the conversation equips its agent with. */
  readonly connectors: readonly string[];
  /** Read replies aloud — a composer mode, not a stored preference. */
  readonly voiceOutput: boolean;
}

/** One entry of the Canvas live-activity stream. */
export interface CanvasActivityEntry {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly at: number;
}

/** One file in the sandbox workspace, as the Canvas file tree shows it. */
export interface CanvasFileEntry {
  readonly path: string;
  readonly bytes: number;
}

/** One artifact the Browser mode can render. */
export interface CanvasArtifact {
  readonly id: string;
  readonly title: string;
  /** Where the render frame loads the artifact from. */
  readonly url?: string;
}

/** Everything the Canvas panel needs about one thread. */
export interface CanvasSources {
  readonly kind: ChatThreadKind;
  readonly hasSandboxSession: boolean;
  /**
   * Where the sandbox computer stream is served. Its presence IS "the
   * computer is streaming" — one fact, so the panel can never show a
   * streaming tab it has no frame for.
   */
  readonly computerStreamUrl?: string;
  readonly activity: readonly CanvasActivityEntry[];
  readonly files: readonly CanvasFileEntry[];
  readonly artifacts: readonly CanvasArtifact[];
}
