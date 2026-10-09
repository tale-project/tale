'use client';

import { useEffect } from 'react';

import type { NodeRunPage } from '@/app/lib/backend/contract/automations';

import { useRunItems } from '../hooks/queries';

/** The most items or passes one read asks for: the route's own ceiling. */
const UNITS_PER_PAGE = 200;

/**
 * Reads one step's items and passes from a run's record, a page at a time:
 * each page is handed up as it lands, and the next one is asked for after
 * it, until the last. It draws nothing.
 */
export function RunUnitsReader({
  organizationId,
  runId,
  node,
  cursor,
  onPage,
}: {
  organizationId: string;
  runId: string;
  node: string;
  /** Where this page starts; the first page when left out. */
  cursor?: string;
  onPage: (
    node: string,
    cursor: string | undefined,
    units: NodeRunPage['units'],
  ) => void;
}) {
  const page = useRunItems(organizationId, runId, {
    node,
    limit: UNITS_PER_PAGE,
    ...(cursor !== undefined && { cursor }),
  });
  const data = page.data;
  const units = data?.units;
  useEffect(() => {
    if (units !== undefined) onPage(node, cursor, units);
  }, [units, node, cursor, onPage]);
  return typeof data?.next === 'string' ? (
    <RunUnitsReader
      organizationId={organizationId}
      runId={runId}
      node={node}
      cursor={data.next}
      onPage={onPage}
    />
  ) : null;
}
