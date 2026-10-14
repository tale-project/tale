import type { Sql } from 'postgres';

import type { WorkLoadout } from '../../../lib/agent/ladder.ts';
import type {
  WorkToolFailureReason,
  WorkToolFailureStatus,
} from '../../../lib/agent/work-tools.ts';
import type { ToolArtifact } from '../../../lib/chat/tools.ts';
import type { SkillViewer } from '../../../lib/skills/visibility.ts';
import type { ResolvedImageModel } from '../../core/lib/providers/resolve_image_model.ts';

/**
 * What a work tool needs from the lane that runs the turn — the chat, or a
 * task run on the native engine — so the tools themselves are one
 * implementation for every lane.
 *
 * A lane answers a few questions through these ports: where a produced file
 * goes (the conversation, or the task's deliverables), which files the turn
 * may read back (the conversation's uploads and products, or the task's
 * inputs), whose spend an image is, whose sandbox the code runs in, which
 * skills it reaches, and whether it may hand its work to the full workspace.
 * The person behind the turn decides which skills it sees.
 */

/** Where a file the turn produces goes. */
export interface ArtifactSink {
  store(file: {
    name: string;
    mediaType: string;
    bytes: Uint8Array;
  }): Promise<ToolArtifact>;
}

/** A file the turn may hand to a tool, by its ref. */
export interface InputFile {
  readonly ref: string;
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
}

/** Which files the turn may read back: those among `refs` it holds. */
export interface InputFiles {
  resolve(refs: readonly string[]): Promise<Map<string, InputFile>>;
}

/** An image generation's admission and settle, booked to the turn's
 * person the way the lane books its other spend. */
export interface ImageBilling {
  admit(
    images: number,
  ): Promise<
    { admitted: true; holdCents: number } | { admitted: false; message: string }
  >;
  settle(args: {
    holdCents: number;
    /** One entry per request the provider billed: its cost in cents. */
    charges: readonly number[];
    provider: string;
    model: string;
  }): Promise<void>;
}

/** What a turn hands to the full workspace: why it cannot finish, and the
 * brief its successor works from. */
export interface WorkspaceHandoff {
  readonly reason: string;
  readonly brief: string;
}

/** Where a turn that has a full workspace to hand its work to does so. The
 * lane decides what a hand-over does and whether it may happen now; the
 * turn only asks. */
export interface Escalation {
  request(
    handoff: WorkspaceHandoff,
  ): Promise<{ accepted: true } | { accepted: false; message: string }>;
}

export interface WorkToolScope {
  readonly sql: Sql;
  readonly organizationId: string;
  readonly orgSlug: string;
  /** The person whose turn it is: the sandbox's creator, the skills'
   * viewer, the spend's subject. */
  readonly userId: string;
  readonly skillViewer: SkillViewer;
  /** The skills the turn reaches, by name. Absent: every skill its viewer
   * sees, as in a chat. A task's agent reaches only what it is equipped
   * with, whatever else its project can see. */
  readonly skillAllowlist?: readonly string[];
  /** The key of the light sandbox the turn's code runs in: a
   * conversation's lineage root, a run's id. */
  readonly sandboxOwnerKey: string;
  /** How long a call waits for a light sandbox when every one of the
   * organization's is running code. Absent, a call answers busy at once: a
   * chat's person is watching and can ask again. A task run has no one to
   * ask, so its lane gives it patience. */
  readonly lightSandboxWaitMs?: number;
  /** Which work tools the turn offers. */
  readonly loadout: WorkLoadout;
  readonly artifacts: ArtifactSink;
  readonly inputs: InputFiles;
  /** The image model and its billing, when the turn may generate images. */
  readonly image?: {
    readonly model: ResolvedImageModel;
    readonly billing: ImageBilling;
  };
  /** The hand-over to the full workspace, on a turn that has one. */
  readonly escalation?: Escalation;
}

/** Whether the turn reaches the skill `slug`: an equipped list narrows what
 * the viewer would otherwise see. */
export function skillReachable(scope: WorkToolScope, slug: string): boolean {
  return (
    scope.skillAllowlist === undefined || scope.skillAllowlist.includes(slug)
  );
}

/** A structured failure the model reads and can act on — every work tool
 * answers one instead of throwing. `reason` names the cause for the person,
 * where the status alone does not. */
export interface WorkToolFailure {
  status: WorkToolFailureStatus;
  message: string;
  reason?: WorkToolFailureReason;
}

export function failure(
  status: WorkToolFailure['status'],
  message: string,
  reason?: WorkToolFailureReason,
): WorkToolFailure {
  return reason === undefined
    ? { status, message }
    : { status, message, reason };
}

export function isArgsRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A list argument of non-empty strings, trimmed — `[]` when absent, and
 * `null` when present but not such a list. */
export function stringList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') return null;
    items.push(item.trim());
  }
  return items;
}
