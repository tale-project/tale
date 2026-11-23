import {
  type HarnessReason,
  isHarnessReason,
} from '../../../lib/shared/harness-reason.ts';
import { loadHarnesses } from '../../core/lib/providers/load_system_config.ts';

/**
 * The runtime facts of one op row as a run's details read them: the harness
 * the turn ran on (`harness`, migration 0127), its display name, and why it
 * ran there (`harness_reason`, migration 0240) — the task lane's sandbox-op
 * read and the automation step's agent-node read answer the same three, and
 * the shared transcript view tells them as one sentence.
 */
export interface OpRuntimeView {
  harness?: string;
  /** The harness's display name, while the deployment still ships it. */
  harnessLabel?: string;
  /** Absent on a row written before ops recorded it, and on one the
   * watchdog created for a turn whose host never opened it. */
  harnessReason?: HarnessReason;
}

/** The runtime facts of an op row's columns. A reason means nothing without
 * the harness it explains, and a value this image does not know (a newer
 * image's rule, read during a rollback) is left out rather than shown. */
export function opRuntimeView(row: {
  harness?: string | null;
  harnessReason?: string | null;
}): OpRuntimeView {
  const slug = row.harness;
  if (typeof slug !== 'string' || slug === '') return {};
  const label = loadHarnesses().find(
    (harness) => harness.slug === slug,
  )?.displayName;
  return {
    harness: slug,
    ...(label !== undefined ? { harnessLabel: label } : {}),
    ...(isHarnessReason(row.harnessReason)
      ? { harnessReason: row.harnessReason }
      : {}),
  };
}
