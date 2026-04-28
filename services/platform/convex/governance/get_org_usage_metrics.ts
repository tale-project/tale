import { DIRECT_API_SLUG } from '../../lib/shared/constants/usage';
import type { QueryCtx } from '../_generated/server';
import { getUserNamesBatch } from '../documents/get_user_names_batch';
import { buildPeriodKeyFromTimestamp } from './helpers';

export type PeriodDays = 7 | 30 | 90;
export type Granularity = 'daily' | 'weekly' | 'monthly';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SCAN = 20000;
const TOP_N = 10;

export interface GetOrgUsageMetricsArgs {
  organizationId: string;
  periodDays: PeriodDays;
  granularity: Granularity;
  agentSlug?: string;
  model?: string;
  provider?: string;
}

export interface UsageSeriesPoint {
  periodKey: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  costCents: number;
}

export interface UsageTopAgent {
  // Either a real agent slug or the DIRECT_API_SLUG sentinel for OpenAI-compat
  // direct-model calls (no assistant context). Never null — every ledger row
  // resolves to one of these two precise categories.
  agentSlug: string;
  requests: number;
  tokens: number;
  costCents: number;
}

export interface UsageTopModel {
  provider: string;
  model: string;
  requests: number;
  tokens: number;
  costCents: number;
}

export interface UsageUserRow {
  userId: string;
  displayName: string;
  teamId: string | null;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  costCents: number;
  requests: number;
}

export interface UsageSummary {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostCents: number;
  activeUsers: number;
  capped: boolean;
}

export interface OrgUsageMetrics {
  summary: UsageSummary;
  series: UsageSeriesPoint[];
  topAgents: UsageTopAgent[];
  topModels: UsageTopModel[];
  users: UsageUserRow[];
}

function buildWindowKeys(
  granularity: Granularity,
  periodDays: PeriodDays,
  now: number,
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  // Walk backward in 1-day steps and collect distinct period keys. This
  // naturally dedupes weekly/monthly buckets and guarantees pre-seed keys
  // match what buildPeriodKeyFromTimestamp produced on write.
  for (let i = periodDays - 1; i >= 0; i--) {
    const ts = now - i * DAY_MS;
    const key = buildPeriodKeyFromTimestamp(granularity, ts);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

export async function getOrgUsageMetrics(
  ctx: QueryCtx,
  args: GetOrgUsageMetricsArgs,
): Promise<OrgUsageMetrics> {
  const now = Date.now();
  const windowKeys = buildWindowKeys(args.granularity, args.periodDays, now);
  const windowStartKey = windowKeys[0] ?? '';

  const seriesMap = new Map<string, UsageSeriesPoint>();
  for (const key of windowKeys) {
    seriesMap.set(key, {
      periodKey: key,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      tokens: 0,
      costCents: 0,
    });
  }

  const agentBuckets = new Map<string, UsageTopAgent>();
  const modelBuckets = new Map<string, UsageTopModel>();
  const userBuckets = new Map<
    string,
    {
      userId: string;
      teamId: string | null;
      inputTokens: number;
      outputTokens: number;
      tokens: number;
      costCents: number;
      requests: number;
    }
  >();

  let totalRequests = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let totalCostCents = 0;
  const activeUserIds = new Set<string>();

  let scanned = 0;
  let capped = false;

  for await (const row of ctx.db
    .query('usageLedger')
    .withIndex('by_org_granularity_period', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('granularity', args.granularity)
        .gte('periodKey', windowStartKey),
    )) {
    scanned++;
    if (scanned > MAX_SCAN) {
      capped = true;
      break;
    }

    // Post-scan filters (cheap — rows already narrowed by index).
    if (args.agentSlug !== undefined && row.agentSlug !== args.agentSlug) {
      continue;
    }
    if (args.model !== undefined && row.model !== args.model) {
      continue;
    }
    if (args.provider !== undefined && row.provider !== args.provider) {
      continue;
    }

    const seriesPoint = seriesMap.get(row.periodKey);
    if (!seriesPoint) continue;

    seriesPoint.requests += row.requestCount;
    seriesPoint.inputTokens += row.inputTokens;
    seriesPoint.outputTokens += row.outputTokens;
    seriesPoint.tokens += row.totalTokens;
    seriesPoint.costCents += row.costEstimate;

    totalRequests += row.requestCount;
    totalInputTokens += row.inputTokens;
    totalOutputTokens += row.outputTokens;
    totalTokens += row.totalTokens;
    totalCostCents += row.costEstimate;
    if (row.requestCount > 0) activeUserIds.add(row.userId);

    // Bucket under the real agent slug, or under the DIRECT_API_SLUG sentinel
    // for LLM rows that came from the OpenAI-compat direct-model endpoint
    // (no assistant context). Integration rows always carry agentSlug.
    const agentSlugForBucket = row.agentSlug ?? DIRECT_API_SLUG;
    let agentBucket = agentBuckets.get(agentSlugForBucket);
    if (!agentBucket) {
      agentBucket = {
        agentSlug: agentSlugForBucket,
        requests: 0,
        tokens: 0,
        costCents: 0,
      };
      agentBuckets.set(agentSlugForBucket, agentBucket);
    }
    agentBucket.requests += row.requestCount;
    agentBucket.tokens += row.totalTokens;
    agentBucket.costCents += row.costEstimate;

    // Top Models is LLM-only. Integration rows have no model by design — their
    // cost is still attributed to the calling agent above.
    if (row.model !== undefined && row.provider !== undefined) {
      const modelKey = `${row.provider}::${row.model}`;
      let modelBucket = modelBuckets.get(modelKey);
      if (!modelBucket) {
        modelBucket = {
          provider: row.provider,
          model: row.model,
          requests: 0,
          tokens: 0,
          costCents: 0,
        };
        modelBuckets.set(modelKey, modelBucket);
      }
      modelBucket.requests += row.requestCount;
      modelBucket.tokens += row.totalTokens;
      modelBucket.costCents += row.costEstimate;
    }

    const userKey = `${row.userId}::${row.teamId ?? ''}`;
    let userBucket = userBuckets.get(userKey);
    if (!userBucket) {
      userBucket = {
        userId: row.userId,
        teamId: row.teamId ?? null,
        inputTokens: 0,
        outputTokens: 0,
        tokens: 0,
        costCents: 0,
        requests: 0,
      };
      userBuckets.set(userKey, userBucket);
    }
    userBucket.inputTokens += row.inputTokens;
    userBucket.outputTokens += row.outputTokens;
    userBucket.tokens += row.totalTokens;
    userBucket.costCents += row.costEstimate;
    userBucket.requests += row.requestCount;
  }

  const topAgents: UsageTopAgent[] = [...agentBuckets.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, TOP_N);

  const topModels: UsageTopModel[] = [...modelBuckets.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, TOP_N);

  // Full user list (no Top-N cap) — admins need to see every user's usage
  // for team/budget drill-down, matching the pre-analytics UsageDashboard.
  const sortedUsers = [...userBuckets.values()].sort(
    (a, b) => b.tokens - a.tokens,
  );
  const userNameMap = await getUserNamesBatch(
    ctx,
    sortedUsers.map((u) => u.userId),
  );
  const users: UsageUserRow[] = sortedUsers.map((u) => ({
    userId: u.userId,
    displayName: userNameMap.get(u.userId) ?? u.userId,
    teamId: u.teamId,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    tokens: u.tokens,
    costCents: u.costCents,
    requests: u.requests,
  }));

  return {
    summary: {
      totalRequests,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      totalCostCents,
      activeUsers: activeUserIds.size,
      capped,
    },
    series: [...seriesMap.values()],
    topAgents,
    topModels,
    users,
  };
}
