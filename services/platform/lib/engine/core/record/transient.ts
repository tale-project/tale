/**
 * A run that is never stored — a test, a try of a draft, a step test — read
 * the way a stored run is read: the same projection (`./read`) over the
 * records its recorder kept in memory. No later read can ask for one of its
 * units, so the answer carries every unit read whole beside the view: the
 * steps first (with the run's input and output), then their items and
 * passes, as long as they fit {@link TRANSIENT_DETAILS_MAX_BYTES}.
 *
 * Pure and browser-safe.
 */

import type { Automation, RunResult } from '../types';
import {
  nodeDetail,
  type NodeRunDetail,
  recordView,
  runFactsOf,
  type RunRecordView,
} from './read';
import { RECORD_RUN_BUDGET, utf8Bytes } from './value';
import { latestPerUnit } from './view';

export interface TransientRecord {
  view: RunRecordView;
  /** Each unit the record keeps, read whole: steps, then items and passes. */
  details: NodeRunDetail[];
  /** Units left out because they did not fit: steps are read first, so
   * items and passes are the first to go. */
  detailsTruncated?: true;
}

/** The units of a transient run read whole stay under this as JSON
 * (UTF-8) — what a durable run may store of its values in all. */
export const TRANSIENT_DETAILS_MAX_BYTES = RECORD_RUN_BUDGET;

/** A run's outcome in the words a stored run's status uses. */
function statusOf(result: RunResult): string {
  if (result.stoppedBy !== undefined) return 'cancelled';
  return result.status === 'success' ? 'success' : 'failed';
}

/**
 * The record of a run executed in one call with a recorder, as a reader
 * sees it; undefined for a run that kept none (no recorder, or refused
 * before it started). `version` is the saved version it ran, 0 for a draft
 * that was never saved.
 */
export function transientRecord(args: {
  doc: Automation;
  result: RunResult;
  id: string;
  version?: number;
  startedAt: number;
  finishedAt: number;
}): TransientRecord | undefined {
  const { doc, result } = args;
  const records = result.record;
  if (records === undefined) return undefined;
  const status = statusOf(result);
  const facts = runFactsOf(
    { status, finishedAt: args.finishedAt },
    records,
    args.finishedAt,
  );
  const view = recordView({
    run: {
      id: args.id,
      status,
      version: args.version ?? 0,
      mode: 'mock',
      startedAt: args.startedAt,
      finishedAt: args.finishedAt,
    },
    source: 'transient',
    doc,
    records,
    facts,
    events: [],
    eventsTotal: 0,
    cursor: args.finishedAt,
    travels: true,
  });

  const units = latestPerUnit(records);
  const ordered = [
    ...units.filter((r) => r.key.item < 0 && r.key.pass < 0),
    ...units.filter((r) => r.key.item >= 0 || r.key.pass >= 0),
  ];
  const details: NodeRunDetail[] = [];
  let bytes = 0;
  let truncated = false;
  for (const record of ordered) {
    const detail = nodeDetail({
      doc,
      records,
      facts,
      path: record.key.path,
      item: record.key.item,
      pass: record.key.pass,
    });
    if (detail === null) continue;
    const size = utf8Bytes(JSON.stringify(detail));
    if (bytes + size > TRANSIENT_DETAILS_MAX_BYTES) {
      truncated = true;
      continue;
    }
    bytes += size;
    details.push(detail);
  }
  return { view, details, ...(truncated && { detailsTruncated: true }) };
}
