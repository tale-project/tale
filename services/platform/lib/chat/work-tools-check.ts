import type { SandboxStartFailure } from './work-tools-status';

/**
 * What the Run check of the Chat tool status panel answers — `POST
 * /api/app/chat/work-tools/check`: whether a light sandbox starts the way a
 * reply's `run_code` starts one, holds the document libraries its runtime
 * image lists, and writes a Word file a reply could attach; or the one
 * piece that failed. Each piece is a code; the panel says it in the reader's
 * language. The sandbox service's own words stay in the server log.
 */

/** How long a check may take, from its start to its answer. */
export const CHAT_SANDBOX_CHECK_DEADLINE_MS = 50_000;

/** The most missing libraries an answer names; it counts the rest. */
export const CHAT_SANDBOX_CHECK_MISSING_NAMED = 20;

export type ChatSandboxCheckFailure =
  /** The deployment has no sandbox service (`SANDBOX_TOKEN` is not set). */
  | { readonly piece: 'sandbox_not_configured' }
  /** No light sandbox could be had, it did not start, or it stopped working
   * during the check, in the words a reply's `run_code` step uses. */
  | { readonly piece: SandboxStartFailure }
  /** Document libraries the runtime image lists are not installed in it. */
  | {
      readonly piece: 'libraries_missing';
      /** Up to {@link CHAT_SANDBOX_CHECK_MISSING_NAMED} of them: the names
       * fit to show, so none when no name is. */
      readonly missing: readonly string[];
      /** How many are missing in all. */
      readonly count: number;
    }
  /** The sandbox could not write the Word file, or it could not be read
   * back as one. */
  | { readonly piece: 'file_not_written' }
  /** The check did not finish within {@link CHAT_SANDBOX_CHECK_DEADLINE_MS}. */
  | { readonly piece: 'timed_out' };

export type ChatSandboxCheck =
  | {
      readonly outcome: 'passed';
      /** When the check ended, in epoch milliseconds. */
      readonly checkedAt: number;
      /** How many document libraries the runtime image lists, all present:
       * at least one in each of its lists, since a list that names none
       * fails the check. */
      readonly libraries: number;
      readonly durationMs: number;
    }
  | {
      readonly outcome: 'failed';
      /** When the check ended, in epoch milliseconds. */
      readonly checkedAt: number;
      readonly failure: ChatSandboxCheckFailure;
    };
