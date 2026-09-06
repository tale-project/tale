import type { Sql, TransactionSql } from 'postgres';

import {
  metaDescription,
  normalizeListedUrl,
  siteHosts,
} from '../../../lib/knowledge/crawl-parse.ts';
import { htmlTitle } from '../../../lib/knowledge/html-to-text.ts';
import { safeFetch } from '../../../lib/net/safe-fetch.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import {
  deregisterDomain,
  fetchWebsiteInfoFromCorpus,
  isMemberDomain,
  listPageChunks,
  listWebsitePages,
  registerDomain,
  registerUrlList,
  searchDomainContent,
  setScanInterval,
} from '../../core/knowledge/crawl.ts';
import {
  scanDueWebsitesImpl,
  scanWebsiteImpl,
} from '../../core/knowledge/crawl_action.ts';
import { getKnowledgePoolForOrg } from '../../core/knowledge/pool.ts';
import { toWebsiteDomain } from '../../core/websites/create_website.ts';
import { matchesWebsiteSearch } from '../../core/websites/match_website_search.ts';
import {
  CONNECTION_FAILURES_BEFORE_PAUSE,
  connectionFailureCount,
  lastScanAttemptAt,
  scanPausedAt,
  type ScanSchedulingSite,
  WEBSITE_NOT_IN_CORPUS_MESSAGE,
} from '../../core/websites/scan_scheduling.ts';
import {
  isValidScanInterval,
  SCAN_INTERVAL_VALUES,
  scanIntervalToSeconds,
} from '../../core/websites/types.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  createCtxShim,
  type ShimHandlers,
  type ShimScheduler,
} from '../../lib/ctx-shim.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { knowledgeShimHandlers } from '../knowledge/service.ts';
import { writeNotificationForOrgs } from '../notifications/service.ts';
import {
  markSessionDestroyed,
  reserveSessionSlot,
} from '../sandbox/sessions.ts';

/**
 * Websites — the 0.5 twin of `convex/websites` + the crawl engine host.
 *
 * The org-facing registration/status/failure-ledger rows live in
 * `app.websites`; the corpus side (domains, URL frontier, chunks,
 * memberships) stays in the KNOWLEDGE database exactly as in 0.4 — the
 * whole data seam (`convex/knowledge/crawl.ts`) and the crawl ENGINE
 * (`crawl_action.ts`, hoisted) are REUSED verbatim. The engine runs on a
 * ctx shim: its two websites mutations and the scheduling query answer
 * from this service, the knowledge shim covers the embedder/org lookups,
 * the sandbox session verbs back the render lane, and the scheduler seam
 * maps its self-chain + row-sync fan-out onto pg-boss jobs. The 0.4
 * five-minute cron is the `websites.scan_due` schedule.
 */

export class WebsiteError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'WebsiteError';
    this.code = code;
    this.status = status;
  }
}

/** The refusal both write doors answer when a patch carries `domain`. */
export function websiteDomainImmutableError(): WebsiteError {
  return new WebsiteError(
    'WEBSITE_DOMAIN_IMMUTABLE',
    'domain is immutable after create; delete the website and re-add it under the new domain',
  );
}

function assertScanInterval(scanInterval: string): void {
  if (!isValidScanInterval(scanInterval)) {
    throw new WebsiteError(
      'INVALID_SCAN_INTERVAL',
      `Invalid scanInterval. Allowed values: ${SCAN_INTERVAL_VALUES.join(', ')}`,
    );
  }
}

// ---------------------------------------------------------------------- rows

export interface WebsiteRow {
  id: string;
  organizationId: string;
  domain: string;
  kind: 'site' | 'list' | null;
  title: string | null;
  description: string | null;
  scanInterval: string;
  lastScannedAt: number | null;
  status: string | null;
  pageCount: number | null;
  crawledPageCount: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

const WEBSITE_COLUMNS = `
  id, org_id AS "organizationId", domain, kind, title, description,
  scan_interval AS "scanInterval",
  last_scanned_at_ms::float8 AS "lastScannedAt", status,
  page_count AS "pageCount", crawled_page_count AS "crawledPageCount",
  metadata, created_at_ms::float8 AS "createdAt",
  updated_at_ms::float8 AS "updatedAt"
`;

export async function getWebsite(
  db: Sql | TransactionSql,
  websiteId: string,
): Promise<WebsiteRow | null> {
  const rows = await db<WebsiteRow[]>`
    SELECT ${db.unsafe(WEBSITE_COLUMNS)} FROM app.websites
    WHERE id = ${websiteId} LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getWebsiteByDomain(
  db: Sql | TransactionSql,
  organizationId: string,
  domain: string,
): Promise<WebsiteRow | null> {
  const rows = await db<WebsiteRow[]>`
    SELECT ${db.unsafe(WEBSITE_COLUMNS)} FROM app.websites
    WHERE org_id = ${organizationId} AND domain = ${domain} LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Newest-first keyset listing with the 0.4 filters (status, scanInterval)
 * and the palette's substring search over domain/title/description. */
export async function listWebsites(
  sql: Sql,
  organizationId: string,
  args: {
    status?: string;
    scanInterval?: string;
    searchTerm?: string;
    cursor?: string | null;
    limit?: number;
  } = {},
): Promise<{ page: WebsiteRow[]; isDone: boolean; continueCursor: string }> {
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 200);
  const cursorParts = (args.cursor ?? '').split(':');
  const cursorCreated = Number(cursorParts[0]);
  const cursorId = cursorParts[1] ?? '';
  const hasCursor = Number.isFinite(cursorCreated) && cursorId.length > 0;
  const searchLower = args.searchTerm?.toLowerCase();

  const page: WebsiteRow[] = [];
  let after: { createdAt: number; id: string } | null = hasCursor
    ? { createdAt: cursorCreated, id: cursorId }
    : null;
  let isDone = true;
  outer: for (;;) {
    const rows: WebsiteRow[] = await sql<WebsiteRow[]>`
      SELECT ${sql.unsafe(WEBSITE_COLUMNS)} FROM app.websites
      WHERE org_id = ${organizationId}
        AND (${args.status ?? null}::text IS NULL
             OR status = ${args.status ?? null})
        AND (${args.scanInterval ?? null}::text IS NULL
             OR scan_interval = ${args.scanInterval ?? null})
        AND (${after === null}
             OR (created_at_ms, id) < (${after?.createdAt ?? 0}, ${after?.id ?? ''}))
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ${limit + 1}
    `;
    for (const row of rows.slice(0, limit)) {
      if (
        searchLower !== undefined &&
        searchLower.length > 0 &&
        !matchesWebsiteSearch(
          {
            domain: row.domain,
            title: row.title ?? undefined,
            description: row.description ?? undefined,
          },
          searchLower,
        )
      ) {
        continue;
      }
      page.push(row);
      if (page.length >= limit) {
        isDone = rows.length <= limit && row === rows[rows.length - 1];
        break outer;
      }
    }
    if (rows.length <= limit) break;
    const last = rows[limit - 1];
    if (!last) break;
    after = { createdAt: last.createdAt, id: last.id };
  }
  const tail = page[page.length - 1];
  return {
    page,
    isDone,
    continueCursor: tail ? `${tail.createdAt}:${tail.id}` : '',
  };
}

export async function countWebsites(
  sql: Sql,
  organizationId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.websites
    WHERE org_id = ${organizationId}
  `;
  return Number(rows[0]?.count ?? '0');
}

export async function createWebsiteRow(
  db: Sql | TransactionSql,
  args: {
    organizationId: string;
    domain: string;
    kind?: 'site' | 'list';
    title?: string;
    description?: string;
    scanInterval: string;
    status?: string;
  },
): Promise<string> {
  assertScanInterval(args.scanInterval);
  const domain = toWebsiteDomain(args.domain);
  const now = Date.now();
  const rows = await db<{ id: string }[]>`
    INSERT INTO app.websites (
      org_id, domain, kind, title, description, scan_interval, status,
      created_at_ms, updated_at_ms
    ) VALUES (
      ${args.organizationId}, ${domain}, ${args.kind ?? null},
      ${args.title ?? null}, ${args.description ?? null},
      ${args.scanInterval}, ${args.status ?? null}, ${now}, ${now}
    )
    ON CONFLICT (org_id, domain) DO NOTHING
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) {
    throw new WebsiteError(
      'WEBSITE_DUPLICATE_DOMAIN',
      `Website with domain ${domain} already exists`,
      409,
    );
  }
  return id;
}

/**
 * Patch a row (the 0.4 `updateWebsite` semantics): metadata SHALLOW-MERGES
 * over the stored object (null values persist as explicit clears — the
 * scheduling accessors treat them as absent), `callerOrgId` closes the
 * cross-tenant IDOR for REST/agent callers.
 *
 * The domain is IMMUTABLE after create: the corpus registration
 * (`registerDomain`, memberships, frontier, chunks) is keyed by it, so a
 * renamed row would never claim a scan again and its old registration would
 * never be released — the doors answer 400 and the user deletes + re-adds.
 */
export async function patchWebsite(
  db: Sql | TransactionSql,
  args: {
    websiteId: string;
    callerOrgId?: string;
    kind?: 'site' | 'list';
    title?: string;
    description?: string;
    scanInterval?: string;
    lastScannedAt?: number;
    status?: string;
    pageCount?: number;
    crawledPageCount?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<WebsiteRow | null> {
  if (args.scanInterval !== undefined) assertScanInterval(args.scanInterval);
  const existing = await getWebsite(db, args.websiteId);
  if (
    !existing ||
    (args.callerOrgId !== undefined &&
      existing.organizationId !== args.callerOrgId)
  ) {
    throw new WebsiteError('WEBSITE_NOT_FOUND', 'Website not found', 404);
  }

  const metadata =
    args.metadata !== undefined
      ? { ...existing.metadata, ...args.metadata }
      : undefined;

  const rows = await db<WebsiteRow[]>`
    UPDATE app.websites SET
      kind = ${args.kind !== undefined ? args.kind : db.unsafe('kind')},
      title = ${args.title !== undefined ? args.title : db.unsafe('title')},
      description = ${args.description !== undefined ? args.description : db.unsafe('description')},
      scan_interval = ${args.scanInterval !== undefined ? args.scanInterval : db.unsafe('scan_interval')},
      last_scanned_at_ms = ${args.lastScannedAt !== undefined ? args.lastScannedAt : db.unsafe('last_scanned_at_ms')},
      status = ${args.status !== undefined ? args.status : db.unsafe('status')},
      page_count = ${args.pageCount !== undefined ? args.pageCount : db.unsafe('page_count')},
      crawled_page_count = ${args.crawledPageCount !== undefined ? args.crawledPageCount : db.unsafe('crawled_page_count')},
      metadata = ${metadata !== undefined ? db.json(toJson(metadata)) : db.unsafe('metadata')},
      updated_at_ms = ${Date.now()}
    WHERE id = ${args.websiteId}
    RETURNING ${db.unsafe(WEBSITE_COLUMNS)}
  `;
  return rows[0] ?? null;
}

export async function deleteWebsiteRow(
  db: Sql | TransactionSql,
  websiteId: string,
): Promise<string> {
  const rows = await db<{ domain: string }[]>`
    DELETE FROM app.websites WHERE id = ${websiteId} RETURNING domain
  `;
  const domain = rows[0]?.domain;
  if (domain === undefined) {
    throw new WebsiteError('WEBSITE_NOT_FOUND', 'Website not found', 404);
  }
  return domain;
}

// ----------------------------------------------------- failure bookkeeping

/**
 * Record a failed scan on the row — the store that stays reachable when the
 * corpus database itself is the problem. Connection-class failures count
 * toward the pause threshold; crossing it pauses the site and notifies the
 * org's admins once per incident (the 0.4 `recordScanFailure`).
 */
export async function recordScanFailure(
  sql: Sql,
  args: {
    organizationId: string;
    domain: string;
    message: string;
    corpusUnreachable: boolean;
  },
): Promise<{ paused: boolean }> {
  const website = await getWebsiteByDomain(
    sql,
    args.organizationId,
    args.domain,
  );
  if (!website || website.status === 'deleting') return { paused: false };

  const failures = args.corpusUnreachable
    ? connectionFailureCount(website.metadata ?? undefined) + 1
    : 0;
  const alreadyPaused = scanPausedAt(website.metadata ?? undefined) !== null;
  const pauseNow =
    args.corpusUnreachable &&
    !alreadyPaused &&
    failures >= CONNECTION_FAILURES_BEFORE_PAUSE;
  const now = Date.now();

  await sql.begin(async (tx) => {
    await patchWebsite(tx, {
      websiteId: website.id,
      status: 'error',
      metadata: {
        lastSyncError: args.message.slice(0, 1000),
        lastScanAttemptAt: now,
        corpusConnectionFailures: failures > 0 ? failures : null,
        ...(pauseNow ? { scanPausedAt: now } : {}),
      },
    });
    if (pauseNow) {
      await writeNotificationForOrgs(tx, {
        organizationIds: [args.organizationId],
        category: 'security',
        severity: 'warning',
        titleKey: 'websiteScanPaused',
        bodyKey: 'websiteScanPausedDetails',
        params: { domain: args.domain, failures },
      });
    }
  });
  return { paused: pauseNow };
}

/** Clear the failure bookkeeping after a completed scan (the 0.4 twin). */
export async function clearScanFailures(
  sql: Sql,
  args: { organizationId: string; domain: string },
): Promise<void> {
  const website = await getWebsiteByDomain(
    sql,
    args.organizationId,
    args.domain,
  );
  if (!website) return;
  const metadata = website.metadata ?? {};
  const dirty =
    metadata.lastScanAttemptAt != null ||
    metadata.corpusConnectionFailures != null ||
    metadata.scanPausedAt != null;
  if (!dirty) return;
  await patchWebsite(sql, {
    websiteId: website.id,
    metadata: {
      lastScanAttemptAt: null,
      corpusConnectionFailures: null,
      scanPausedAt: null,
    },
  });
}

/** One keyset page of the scheduler's projection. */
const SCHEDULING_PAGE_SIZE = 500;

interface SchedulingRow {
  id: string;
  domain: string;
  organizationId: string;
  scanInterval: string;
  lastScannedAt: number | null;
  status: string | null;
  createdAt: number;
  metadata: Record<string, unknown> | null;
}

/**
 * The scheduler's projection of EVERY row, walked in keyset pages over
 * (created_at_ms, id) until exhausted. The 0.4 `take(500)` was a per-query
 * Convex cap; ported as a hard ceiling it meant every site past the 500th
 * (oldest-first) got its register-kicked scan and then never a periodic one.
 * The throttle is `MAX_SCANS_PER_TICK` on the due set, not this listing.
 */
export async function listWebsitesForScanScheduling(
  sql: Sql,
): Promise<
  (ScanSchedulingSite & { domain: string; organizationId: string })[]
> {
  const sites: (ScanSchedulingSite & {
    domain: string;
    organizationId: string;
  })[] = [];
  let after: { createdAt: number; id: string } | null = null;
  for (;;) {
    const rows: SchedulingRow[] = await sql<SchedulingRow[]>`
      SELECT id, domain, org_id AS "organizationId",
             scan_interval AS "scanInterval",
             last_scanned_at_ms::float8 AS "lastScannedAt", status,
             created_at_ms::float8 AS "createdAt", metadata
      FROM app.websites
      WHERE (${after === null}
             OR (created_at_ms, id) > (${after?.createdAt ?? 0}, ${after?.id ?? ''}))
      ORDER BY created_at_ms ASC, id ASC
      LIMIT ${SCHEDULING_PAGE_SIZE}
    `;
    for (const row of rows) sites.push(toSchedulingSite(row));
    const last = rows[rows.length - 1];
    if (!last || rows.length < SCHEDULING_PAGE_SIZE) break;
    after = { createdAt: last.createdAt, id: last.id };
  }
  return sites;
}

function toSchedulingSite(
  row: SchedulingRow,
): ScanSchedulingSite & { domain: string; organizationId: string } {
  const metadata = row.metadata ?? undefined;
  const attempt = lastScanAttemptAt(metadata);
  const site: ScanSchedulingSite & {
    domain: string;
    organizationId: string;
    lastScannedAt?: number;
    lastAttemptAt?: number;
    status?: string;
  } = {
    domain: row.domain,
    organizationId: row.organizationId,
    scanIntervalSeconds: scanIntervalToSeconds(row.scanInterval),
    createdAt: row.createdAt,
    connectionFailures: connectionFailureCount(metadata),
    scanPaused: scanPausedAt(metadata) !== null,
  };
  if (row.lastScannedAt !== null) site.lastScannedAt = row.lastScannedAt;
  if (attempt !== null) site.lastAttemptAt = attempt;
  if (row.status !== null) site.status = row.status;
  return site;
}

// ------------------------------------------------------------ crawl host

/** A website's scan interval, as the corpus stores it. */
function scanIntervalToSeconds(interval: string): number {
  switch (interval) {
    case '60m':
      return 3600;
    case '6h':
      return 21600;
    case '12h':
      return 43200;
    case '1d':
      return 86400;
    case '5d':
      return 432000;
    case '7d':
      return 604800;
    case '30d':
      return 2592000;
    default:
      return 21600;
  }
}

/** The refs the reused engine SCHEDULES rather than dispatches — mapped
 * onto pg-boss jobs by `crawlScheduler`, so the reachability gate counts
 * them as answered. Exported for tests only (`shim.test.ts`). */
export const SCHEDULED_CRAWL_REFS = {
  scanWebsite: 'knowledge/crawl_action:scanWebsite',
  syncWebsiteRow: 'websites/internal_actions:syncWebsiteRowForDomain',
} as const;

/** The ctx shim the REUSED crawl engine runs on: knowledge handlers (org
 * lookups + embedder legs), the sandbox session verbs behind the render
 * lane, and this service's websites handlers. Exported for tests only —
 * the reachability gate (`shim.test.ts`), which requires a handler for
 * every `internal.*` ref the engine can reach; production reaches it
 * through `crawlCtx` below. */
export function crawlHandlers(sql: Sql): ShimHandlers {
  return {
    ...knowledgeShimHandlers(sql),
    'websites/internal_mutations:recordScanFailure': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the engine passes exactly this shape
      const args = raw as {
        organizationId: string;
        domain: string;
        message: string;
        corpusUnreachable: boolean;
      };
      return recordScanFailure(sql, args);
    },
    'websites/internal_mutations:clearScanFailures': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the engine passes exactly this shape
      const args = raw as { organizationId: string; domain: string };
      await clearScanFailures(sql, args);
      return null;
    },
    'websites/internal_queries:listWebsitesForScanScheduling': async () =>
      listWebsitesForScanScheduling(sql),
    'sandbox/session_mutations:reserveSessionSlotAndInsert': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the render lane passes exactly this shape
      const args = raw as {
        organizationId: string;
        sessionId: string;
        profile: unknown;
        ownerType: string;
        ownerId: string;
        createdBy: string;
      };
      // Quota errors propagate as-is: the render lane treats them as the
      // infra failures they are (scan errors + retry on the next interval).
      return reserveSessionSlot(sql, args);
    },
    'sandbox/session_mutations:setSessionStatus': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the render lane passes exactly this shape
      const args = raw as { rowId: string; status: string };
      const now = Date.now();
      await sql`
        UPDATE app.sandbox_sessions SET
          status = ${args.status}, last_activity_at_ms = ${now},
          destroyed_at_ms = CASE WHEN ${args.status} = 'destroyed'
            THEN ${now}::bigint ELSE destroyed_at_ms END
        WHERE id = ${args.rowId}
      `;
      return null;
    },
    'sandbox/session_mutations:markSessionRowDestroyed': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the render lane passes exactly this shape
      const args = raw as { organizationId: string; sessionId: string };
      return markSessionDestroyed(sql, args);
    },
  };
}

/** The engine's scheduled refs, mapped onto pg-boss jobs. */
function crawlScheduler(sql: Sql): ShimScheduler {
  return async (name, delayMs, args) => {
    if (name === SCHEDULED_CRAWL_REFS.scanWebsite) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the engine self-chains with exactly this shape
      const payload = args as {
        domain: string;
        orgSlug: string;
        organizationId: string;
        continuation?: number;
        scanStartedAt?: string;
      };
      await addJobInTx(
        sql,
        'websites.scan',
        payload,
        delayMs > 0 ? { startAfter: new Date(Date.now() + delayMs) } : {},
      );
      return;
    }
    if (name === SCHEDULED_CRAWL_REFS.syncWebsiteRow) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the engine fans out with exactly this shape
      const payload = args as { orgSlug: string; domain: string };
      await addJobInTx(sql, 'websites.row_sync', payload, {
        singletonKey: `websites-row-sync-${payload.orgSlug}-${payload.domain}`,
      });
      return;
    }
    throw new Error(`[websites] unmapped scheduled ref: ${name}`);
  };
}

function crawlCtx(sql: Sql): never {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reused engine's ActionCtx surface is exactly what the shim provides
  return createCtxShim(crawlHandlers(sql), {
    scheduler: crawlScheduler(sql),
  }) as never;
}

// -------------------------------------------------------------------- ops

/** Resolve an org slug or throw the row into `error` — registration and
 * scans are meaningless without the corpus key. */
async function requireSlug(sql: Sql, organizationId: string): Promise<string> {
  const slug = await resolveOrgSlug(sql, organizationId);
  if (!slug) throw new Error(`Organization ${organizationId} has no slug`);
  return slug;
}

const HOMEPAGE_TIMEOUT_MS = 15_000;
const HOMEPAGE_MAX_BYTES = 2 * 1024 * 1024;
const REGISTER_FOLLOWUP_SYNC_MS = 600_000;

/** Validate a curated list's entries against the domain (route boundary). */
export function normalizeListUrls(
  domain: string,
  urls: readonly string[],
): string[] {
  const hosts = siteHosts(domain);
  const normalized = new Set<string>();
  for (const entry of urls) {
    const url = normalizeListedUrl(entry, hosts);
    if (!url) {
      throw new WebsiteError(
        'WEBSITE_INVALID_LIST_URL',
        `Invalid list URL (must be http(s) on ${domain}): ${entry}`,
      );
    }
    normalized.add(url);
  }
  return [...normalized];
}

/**
 * Register the domain (or curated list) in the org's `public_web` corpus,
 * kick the first scan, fetch the homepage title/description best-effort
 * (site mode only), and schedule the delayed row sync — the 0.4
 * `registerAndSync`, driven by the `websites.register` job.
 */
export async function runWebsiteRegister(
  sql: Sql,
  args: {
    websiteId: string;
    domain: string;
    scanInterval: string;
    organizationId: string;
    urls?: string[];
  },
): Promise<void> {
  const isList = args.urls !== undefined && args.urls.length > 0;
  let orgSlug: string;
  try {
    orgSlug = await requireSlug(sql, args.organizationId);
    const pool = await getKnowledgePoolForOrg(orgSlug);
    if (isList && args.urls) {
      await registerUrlList(
        pool,
        orgSlug,
        args.domain,
        args.urls,
        scanIntervalToSeconds(args.scanInterval),
      );
    } else {
      await registerDomain(
        pool,
        orgSlug,
        args.domain,
        scanIntervalToSeconds(args.scanInterval),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[websites] register failed for ${args.domain}:`,
      error instanceof Error ? error.message : error,
    );
    await patchWebsite(sql, {
      websiteId: args.websiteId,
      status: 'error',
      metadata: { lastSyncError: message },
    });
    return;
  }

  await addJobInTx(sql, 'websites.scan', {
    domain: args.domain,
    orgSlug,
    organizationId: args.organizationId,
  });

  if (!isList) {
    // Homepage title/description, best-effort (not for lists — their
    // homepage is not part of the list).
    try {
      const response = await safeFetch(`https://${args.domain}/`, {
        method: 'GET',
        headers: { accept: 'text/html' },
        timeoutMs: HOMEPAGE_TIMEOUT_MS,
        maxResponseBytes: HOMEPAGE_MAX_BYTES,
        allowedHosts: [...siteHosts(args.domain)],
      });
      if (response.status >= 200 && response.status < 300) {
        const title = htmlTitle(response.body) ?? undefined;
        const description = metaDescription(response.body) ?? undefined;
        if (title !== undefined || description !== undefined) {
          await patchWebsite(sql, {
            websiteId: args.websiteId,
            ...(title !== undefined ? { title } : {}),
            ...(description !== undefined ? { description } : {}),
          });
        }
      }
    } catch (error) {
      console.warn(
        `[websites] homepage metadata fetch failed for ${args.domain}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  await addJobInTx(
    sql,
    'websites.row_sync',
    { orgSlug, domain: args.domain },
    { startAfter: new Date(Date.now() + REGISTER_FOLLOWUP_SYNC_MS) },
  );
}

/**
 * Sync one row from the corpus truth (the 0.4 `syncSingleWebsite`): every
 * branch stamps `metadata.lastStatusSyncAt` — the fetch-pages debounce
 * reads exactly that field.
 */
export async function syncSingleWebsite(
  sql: Sql,
  args: { websiteId: string; domain: string; organizationId: string },
): Promise<void> {
  const website = await getWebsite(sql, args.websiteId);
  if (!website) return;
  const syncTimestamp = Date.now();
  try {
    const orgSlug = await requireSlug(sql, args.organizationId);
    const pool = await getKnowledgePoolForOrg(orgSlug);
    const info = await fetchWebsiteInfoFromCorpus(pool, orgSlug, args.domain);
    if (info) {
      await patchWebsite(sql, {
        websiteId: args.websiteId,
        status: info.status,
        kind: info.kind,
        pageCount: info.page_count,
        crawledPageCount: info.crawled_count,
        ...(info.title !== null ? { title: info.title } : {}),
        ...(info.description !== null ? { description: info.description } : {}),
        ...(info.last_scanned_at !== null
          ? { lastScannedAt: new Date(info.last_scanned_at).getTime() }
          : {}),
        metadata: {
          lastSyncError: info.status === 'error' ? info.error : null,
          lastStatusSyncAt: syncTimestamp,
        },
      });
    } else {
      await patchWebsite(sql, {
        websiteId: args.websiteId,
        status: 'error',
        metadata: {
          lastSyncError: WEBSITE_NOT_IN_CORPUS_MESSAGE,
          lastStatusSyncAt: syncTimestamp,
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[websites] sync failed for ${args.domain}: ${message}`);
    await patchWebsite(sql, {
      websiteId: args.websiteId,
      status: 'error',
      metadata: { lastSyncError: message, lastStatusSyncAt: syncTimestamp },
    });
  }
}

const STATUS_SYNC_INTERVAL_MS = 60 * 60 * 1000;

/** Org-wide status sweep with the hourly debounce; rows in a transient
 * state (scanning/deleting) are always re-checked (the 0.4 twin). */
export async function syncWebsiteStatuses(
  sql: Sql,
  organizationId: string,
): Promise<void> {
  const rows = await sql<
    {
      id: string;
      domain: string;
      status: string | null;
      metadata: Record<string, unknown> | null;
    }[]
  >`
    SELECT id, domain, status, metadata FROM app.websites
    WHERE org_id = ${organizationId}
    ORDER BY created_at_ms ASC
  `;
  const now = Date.now();
  for (const row of rows) {
    const transient = row.status === 'scanning' || row.status === 'deleting';
    const lastSync = row.metadata?.lastStatusSyncAt;
    if (
      !transient &&
      typeof lastSync === 'number' &&
      now - lastSync < STATUS_SYNC_INTERVAL_MS
    ) {
      continue;
    }
    await syncSingleWebsite(sql, {
      websiteId: row.id,
      domain: row.domain,
      organizationId,
    });
  }
}

/** The fetch-pages debounce window (the 0.4 SYNC_DEBOUNCE_MS). */
export function needsStatusSync(website: WebsiteRow): boolean {
  const lastSyncAt =
    isRecord(website.metadata) &&
    typeof website.metadata.lastStatusSyncAt === 'number'
      ? website.metadata.lastStatusSyncAt
      : 0;
  return Date.now() - lastSyncAt > STATUS_SYNC_INTERVAL_MS;
}

/** Interval change → corpus cadence sync (silent no-op when the org never
 * registered the domain — the 0.4 `setScanIntervalOp` posture). */
export async function syncScanIntervalToCorpus(
  sql: Sql,
  args: { organizationId: string; domain: string; scanInterval: string },
): Promise<void> {
  const orgSlug = await requireSlug(sql, args.organizationId);
  const pool = await getKnowledgePoolForOrg(orgSlug);
  if (!(await isMemberDomain(pool, orgSlug, args.domain))) return;
  await setScanInterval(
    pool,
    args.domain,
    scanIntervalToSeconds(args.scanInterval),
  );
}

/** Best-effort deregister + row delete (the 0.4 `deregisterAndDelete`):
 * an unreachable corpus must never block deleting the registration. */
export async function deregisterAndDeleteWebsite(
  sql: Sql,
  website: WebsiteRow,
): Promise<void> {
  try {
    const orgSlug = await requireSlug(sql, website.organizationId);
    const pool = await getKnowledgePoolForOrg(orgSlug);
    await deregisterDomain(pool, orgSlug, website.domain);
  } catch (error) {
    console.warn(
      `[websites] crawler deregister failed for ${website.domain}, deleting row anyway:`,
      error instanceof Error ? error.message : error,
    );
  }
  await deleteWebsiteRow(sql, website.id);
}

/** Resume paused scans and kick a verification scan now (the 0.4 twin). */
export async function resumeScanning(
  sql: Sql,
  website: WebsiteRow,
): Promise<void> {
  await patchWebsite(sql, {
    websiteId: website.id,
    status: 'scanning',
    metadata: {
      scanPausedAt: null,
      corpusConnectionFailures: null,
      lastScanAttemptAt: null,
      lastSyncError: null,
    },
  });
  const orgSlug = await requireSlug(sql, website.organizationId);
  await addJobInTx(sql, 'websites.scan', {
    domain: website.domain,
    orgSlug,
    organizationId: website.organizationId,
  });
}

// --------------------------------------------------------- corpus reads

export async function fetchWebsitePages(
  sql: Sql,
  website: WebsiteRow,
  args: { offset?: number; limit?: number },
): Promise<{
  pages: unknown[];
  total: number;
  offset: number;
  hasMore: boolean;
}> {
  const orgSlug = await requireSlug(sql, website.organizationId);
  const pool = await getKnowledgePoolForOrg(orgSlug);
  if (!(await isMemberDomain(pool, orgSlug, website.domain))) {
    return { pages: [], total: 0, offset: args.offset ?? 0, hasMore: false };
  }
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 100;
  const { pages, total } = await listWebsitePages(
    pool,
    website.domain,
    offset,
    limit,
  );
  return { pages, total, offset, hasMore: offset + pages.length < total };
}

export async function fetchPageChunks(
  sql: Sql,
  website: WebsiteRow,
  url: string,
): Promise<{ chunks: unknown[]; total: number }> {
  const orgSlug = await requireSlug(sql, website.organizationId);
  const pool = await getKnowledgePoolForOrg(orgSlug);
  if (!(await isMemberDomain(pool, orgSlug, website.domain))) {
    return { chunks: [], total: 0 };
  }
  return listPageChunks(pool, website.domain, url);
}

export async function searchWebsiteContent(
  sql: Sql,
  website: WebsiteRow,
  args: { query: string; limit?: number },
): Promise<{ results: unknown[]; total: number }> {
  const orgSlug = await requireSlug(sql, website.organizationId);
  const pool = await getKnowledgePoolForOrg(orgSlug);
  if (!(await isMemberDomain(pool, orgSlug, website.domain))) {
    return { results: [], total: 0 };
  }
  return searchDomainContent(
    pool,
    website.domain,
    args.query,
    args.limit ?? 10,
  );
}

// -------------------------------------------------------------------- jobs

/** The five-minute scheduler tick (the 0.4 cron) on the reused engine. */
export async function runWebsitesScanDue(sql: Sql): Promise<void> {
  await scanDueWebsitesImpl(crawlCtx(sql));
}

/** One continuation link of a domain scan (the reused engine body). */
export async function runWebsitesScan(
  sql: Sql,
  payload: {
    domain: string;
    orgSlug: string;
    organizationId: string;
    continuation?: number;
    scanStartedAt?: string;
  },
): Promise<void> {
  await scanWebsiteImpl(crawlCtx(sql), payload);
}

/** Corpus → row push for one (orgSlug, domain) — the fan-out target. */
export async function runWebsitesRowSync(
  sql: Sql,
  payload: { orgSlug: string; domain: string },
): Promise<void> {
  const orgs = await sql<{ id: string }[]>`
    SELECT "id" FROM "organization" WHERE "slug" = ${payload.orgSlug} LIMIT 1
  `;
  const organizationId = orgs[0]?.id;
  if (organizationId === undefined) return;
  const website = await getWebsiteByDomain(sql, organizationId, payload.domain);
  if (!website) return;
  await syncSingleWebsite(sql, {
    websiteId: website.id,
    domain: payload.domain,
    organizationId,
  });
}
