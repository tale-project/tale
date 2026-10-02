import { AWAITING_ROOM_RESULT_STATUS } from '../../core/sandbox/session_constants.ts';

/**
 * One reading of a settled harness turn's outcome, shared by every fold of
 * the external-turn metrics (the summary cards and the per-harness rows), so
 * the totals equal the sum of the rows.
 *
 * `outcome` is the op's `agent_result_status` — the harness's own turn-ended
 * status (`completed` / `error` / `max-turns` / `cancelled`,
 * lib/harnesses/types.ts), the watchdog's `timeout`, `awaiting_human` for a
 * turn parked on a question, or `awaiting_room` for a start that found no
 * sandbox room — with the op's `status` as the fallback when the harness
 * reported nothing.
 */
export type ExternalTurnOutcome =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  /** Parked on a human question, or a start waiting for sandbox room: not an
   * outcome, so neither counted nor in any rate's denominator. */
  | 'parked';

export function classifyOutcome(
  outcome: string | null,
  status: string,
): ExternalTurnOutcome {
  switch (outcome ?? status) {
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'timeout':
      return 'timeout';
    case 'awaiting_human':
    case AWAITING_ROOM_RESULT_STATUS:
      return 'parked';
    default:
      // `failed`, the harness's `error` and `max-turns`, and anything a
      // future harness reports that is not a success.
      return 'failed';
  }
}
