/**
 * Adapt an `executeConnector` LIST result into the `{ rows, hasNext }` shape
 * that `collectFilteredPage` consumes.
 *
 * `executeConnector` wraps the connector's payload in an envelope —
 * `{ name, operation, result: { data, pagination, ... }, ... }` — so the rows
 * array and the upstream "is there a next page" hint live under `.result`, NOT
 * at the top level. Reading `res.data` / `res.pagination` directly silently
 * yields `undefined` (an empty page with no next page), which collapses a
 * filtered list to nothing — the bug that made the issue desk show no issues.
 *
 * This unwraps `.result` first (mirroring the client's `parsePage`), and
 * tolerates an already-flat shape so a future connector that returns
 * `{ data, pagination }` directly still works.
 */
import { isRecord } from '../../utils/type-utils';
import type { SourcePage } from './filtered_pagination';

export function readConnectorListPage(res: unknown): SourcePage {
  const payload = isRecord(res) && isRecord(res.result) ? res.result : res;
  const pagination = isRecord(payload) ? payload.pagination : undefined;
  return {
    rows: isRecord(payload) && Array.isArray(payload.data) ? payload.data : [],
    hasNext: isRecord(pagination) && pagination.hasNextPage === true,
  };
}
