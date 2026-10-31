import type { WorkToolFailureReason } from '../agent/work-tools';

/**
 * Whether chat in an organization can use each of its work tools — make
 * files, run code, use skills, make images — and why not where it cannot:
 * what `GET /api/app/chat/work-tools` answers and the Chat tool status
 * panel under Governance shows. Each reason is a code; the panel says it in
 * the reader's language and names where to change it.
 */

/** The work tools, in the order the panel lists them. */
export const CHAT_WORK_TOOLS = ['files', 'code', 'skills', 'images'] as const;

export type ChatWorkTool = (typeof CHAT_WORK_TOOLS)[number];

/** `available`: a reply offers it. `limited`: a reply offers it, but part of
 * it is missing or its sandbox failed to start last time. `unavailable`: no
 * reply offers it, or it cannot work. */
export type ChatWorkToolState = 'available' | 'limited' | 'unavailable';

/** The `run_code` failures that say a sandbox could not start or run, as a
 * reply's step records them. A program's own error or time-out says
 * nothing about the sandbox. */
export const SANDBOX_START_FAILURES = [
  'sandbox_not_ready',
  'sandbox_unreachable',
  'sandbox_failed',
  'sandboxes_busy',
  'sandbox_host_busy',
] as const satisfies readonly WorkToolFailureReason[];

export type SandboxStartFailure = (typeof SANDBOX_START_FAILURES)[number];

export type ChatWorkToolReason =
  /** The Chat tools policy has its switch off. */
  | { readonly code: 'policy_off' }
  /** The Chat tools policy cannot be read, which holds every switch off. */
  | { readonly code: 'policy_unreadable' }
  /** The deployment has no sandbox service (`SANDBOX_TOKEN` is not set). */
  | { readonly code: 'sandbox_not_configured' }
  /** The sandbox service did not answer just now. */
  | { readonly code: 'sandbox_unreachable' }
  /** The newest sandbox start of a reply failed, and none started since. */
  | {
      readonly code: 'sandbox_start_failed';
      readonly failure: SandboxStartFailure;
      readonly at: number;
    }
  /** The organization's skill library cannot be read. */
  | { readonly code: 'skill_library_unreadable' }
  /** Document skills missing from the organization's skill library. */
  | {
      readonly code: 'document_skills_missing';
      readonly missing: readonly string[];
    }
  /** The Image generation policy is off. */
  | { readonly code: 'image_generation_off' }
  /** The Image generation policy cannot be read. */
  | { readonly code: 'image_policy_unreadable' }
  /** No connected provider serves an image model. */
  | { readonly code: 'no_image_model' }
  /** The image model the policy names cannot be used. */
  | { readonly code: 'image_model_unavailable' }
  /** The organization processes prompts only in the EU/EEA (`GOV-R17`), and
   * the endpoint of the image model is not known to process there. */
  | { readonly code: 'image_model_outside_eu' }
  /** The Model access policy cannot be read, so whether prompts must stay
   * in the EU/EEA is not known, which holds every image model off. */
  | { readonly code: 'model_access_unreadable' }
  /** The image models could not be looked up. */
  | { readonly code: 'image_model_check_failed' };

export type ChatWorkToolReasonCode = ChatWorkToolReason['code'];

export interface ChatWorkToolStatus {
  readonly tool: ChatWorkTool;
  readonly state: ChatWorkToolState;
  /** What stands in the way, most decisive first; empty when available. */
  readonly reasons: readonly ChatWorkToolReason[];
}

export interface ChatWorkToolsStatus {
  /** When the server looked, in epoch milliseconds. */
  readonly checkedAt: number;
  /** One entry per tool, in {@link CHAT_WORK_TOOLS} order. */
  readonly tools: readonly ChatWorkToolStatus[];
  /** The image model a reply would use, when one resolves. */
  readonly imageModel?: {
    readonly providerName: string;
    readonly modelId: string;
  };
}
