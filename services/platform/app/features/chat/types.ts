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
  readonly archived: boolean;
  /** True while the thread is published as an org-internal snapshot link. */
  readonly isShared?: boolean;
  readonly updatedAt: number;
  /** True while a generation row exists for the thread. */
  readonly generating: boolean;
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

/** A harness the composer can pick, under the "Sandbox agents" group. */
export interface ComposerSandboxAgentOption {
  readonly harness: string;
  readonly label: string;
}

/** An agent configuration the slim agent picker offers. */
export interface ChatAgentOption {
  readonly slug: string;
  readonly label: string;
  readonly description?: string;
}

/** What the composer sends. */
export interface ComposerSelection {
  /** The picked model, or the picked sandbox agent's harness. */
  readonly modelId?: string;
  readonly harness?: string;
  readonly sandbox: boolean;
  readonly agentSlug?: string;
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
