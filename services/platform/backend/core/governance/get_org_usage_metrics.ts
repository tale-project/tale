import {
  bucketAgentSlug,
  classifyUsageRow,
  isAutomationSubject,
  usageLedgerSubject,
} from '../../../lib/shared/constants/usage';
import { buildPeriodKeyFromTimestamp } from './helpers';

export type PeriodDays = 7 | 30 | 90;
export type Granularity = 'daily' | 'weekly' | 'monthly';

const DAY_MS = 24 * 60 * 60 * 1000;
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
  // Real agent slug, or one of DIRECT_API_SLUG / CONNECTOR_SLUG /
  // TRANSCRIPTION_SLUG when the row has no owning assistant (direct-model
  // API call, agentless connector call, or file-pipeline transcription).
  // Never null — every ledger row resolves to exactly one bucket via
  // bucketAgentSlug() so the UI can render a precise label.
  agentSlug: string;
  /** The name behind a slug that is an id the read side resolved — a
   * project agent books under its id (`governance/README.md`). Absent for a
   * chat assistant's slug, an automation's name and the sentinels. */
  displayName?: string;
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

export interface UsageTopVoiceModel {
  provider: string;
  model: string;
  requests: number;
  characters: number;
  costCents: number;
}

/** An API key that is not a person, booking under its own identity
 * (`domains/api_keys/owners.ts`): the team, project or organization it
 * belongs to. */
export interface UsageApiKeyIdentity {
  kind: 'team' | 'project' | 'organization';
  teamName: string | null;
  projectName: string | null;
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
  /** Set when the row is an API key's own identity, not a person. */
  apiKey?: UsageApiKeyIdentity;
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

/** Prior equal-length window totals — drives the summary-card deltas. */
export interface UsagePrevSummary {
  totalRequests: number;
  totalTokens: number;
  totalCostCents: number;
  activeUsers: number;
}

export interface OrgUsageMetrics {
  summary: UsageSummary;
  previousSummary: UsagePrevSummary;
  series: UsageSeriesPoint[];
  topAgents: UsageTopAgent[];
  topModels: UsageTopModel[];
  topVoiceModels: UsageTopVoiceModel[];
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

/** A daily ledger row or SQL aggregate as the fold consumes it. Aggregates
 * must keep reporting windows and chart buckets separate; periodKey is a
 * representative daily key inside both. Fields stay host-neutral. */
export interface UsageLedgerFoldRow {
  userId: string;
  teamId?: string;
  periodKey: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costEstimate: number;
  agentSlug?: string;
  model?: string;
  provider?: string;
  connectorName?: string;
  audioDurationSec?: number;
  characterCount?: number;
}

/** The first period key the scan must cover (prior window's start). */
export function scanStartKeyFor(
  args: Pick<GetOrgUsageMetricsArgs, 'granularity' | 'periodDays'>,
  now: number,
): string {
  return buildPeriodKeyFromTimestamp(
    'daily',
    now - (args.periodDays * 2 - 1) * DAY_MS,
  );
}

/** The fold itself — pure over the pre-fetched rows the pg reader feeds it. */
export async function foldOrgUsageMetrics(
  fetchedRows: readonly UsageLedgerFoldRow[],
  capped: boolean,
  args: GetOrgUsageMetricsArgs,
  now: number,
  resolveUserNames: (userIds: string[]) => Promise<Map<string, string>>,
  resolveAgentNames?: (agentSlugs: string[]) => Promise<Map<string, string>>,
  /** Which of the subjects are API keys rather than people: no active user,
   * and a row the table labels as a key. */
  resolveApiKeyIdentities?: (
    userIds: string[],
  ) => Promise<Map<string, UsageApiKeyIdentity>>,
): Promise<OrgUsageMetrics> {
  const windowKeys = buildWindowKeys(args.granularity, args.periodDays, now);

  // Reporting windows use daily keys. SQL aggregates carry a representative
  // key after splitting windows and chart buckets; raw rows are grouped here.
  const currentKeySet = new Set(buildWindowKeys('daily', args.periodDays, now));
  const prevKeySet = new Set(
    buildWindowKeys('daily', args.periodDays, now - args.periodDays * DAY_MS),
  );

  let prevTotalRequests = 0;
  let prevTotalTokens = 0;
  let prevTotalCostCents = 0;
  const prevActiveUserIds = new Set<string>();

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
  const voiceModelBuckets = new Map<string, UsageTopVoiceModel>();
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

  for (const row of fetchedRows) {
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

    // The PERSON the row books under. Rows written before the workflow lane
    // derived the subject from the run's starter carry a door form
    // (`user:<id>`, `api-key:<id>`, `trigger:<id>`); they are the same
    // member's spend (or the automation bucket's) and fold onto one row.
    const subjectId = usageLedgerSubject(row.userId);

    if (!currentKeySet.has(row.periodKey)) {
      // Rows outside the current window but inside the prior one feed deltas.
      if (prevKeySet.has(row.periodKey)) {
        prevTotalRequests += row.requestCount;
        prevTotalTokens += row.totalTokens;
        prevTotalCostCents += row.costEstimate;
        if (row.requestCount > 0 && !isAutomationSubject(subjectId)) {
          prevActiveUserIds.add(subjectId);
        }
      }
      continue;
    }

    const chartKey = buildPeriodKeyFromTimestamp(
      args.granularity,
      Date.parse(`${row.periodKey}T00:00:00Z`),
    );
    const seriesPoint = seriesMap.get(chartKey);
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
    // The automation sentinel is a bucket, not a member — it holds the spend
    // of trigger-started runs and never counts as an active user.
    if (row.requestCount > 0 && !isAutomationSubject(subjectId)) {
      activeUserIds.add(subjectId);
    }

    // Classify by schema discriminator (connectorName / audioDurationSec /
    // model) so connector and transcription rows route to their own buckets
    // instead of collapsing under the LLM "Direct API" sentinel.
    const kind = classifyUsageRow(row);
    const agentSlugForBucket = bucketAgentSlug(row, kind);
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

    // Top Models is LLM-only — transcription rows remain excluded because
    // their per-minute billing has no first-class section yet. TTS rows
    // get their own `topVoiceModels` bucket below (character-billed), so
    // voice activity is no longer silently dropped from the usage UI.
    if (
      kind === 'llm' &&
      row.model !== undefined &&
      row.provider !== undefined
    ) {
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

    // TTS rows: bucket separately by (provider, model) and aggregate the
    // character count + cost. Parallel to the LLM Top Models block above
    // but unit is characters, not tokens.
    if (
      kind === 'tts' &&
      row.model !== undefined &&
      row.provider !== undefined
    ) {
      const voiceKey = `${row.provider}::${row.model}`;
      let voiceBucket = voiceModelBuckets.get(voiceKey);
      if (!voiceBucket) {
        voiceBucket = {
          provider: row.provider,
          model: row.model,
          requests: 0,
          characters: 0,
          costCents: 0,
        };
        voiceModelBuckets.set(voiceKey, voiceBucket);
      }
      voiceBucket.requests += row.requestCount;
      voiceBucket.characters += row.characterCount ?? 0;
      voiceBucket.costCents += row.costEstimate;
    }

    // One row per PERSON: the ledger's `team_id` is a retired dimension (no
    // lane books one), so folding by it split a member's spend into rows.
    const userKey = subjectId;
    let userBucket = userBuckets.get(userKey);
    if (!userBucket) {
      userBucket = {
        userId: subjectId,
        teamId: null,
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

  // Sort by cost descending — it's the only metric that compares fairly across
  // mixed row kinds. Token-desc penalises non-LLM activity: transcription rows
  // are billed per audio minute (tokens=0) and image-generation models use
  // prompt-token counts that are tiny relative to per-image cost. Cost-desc
  // matches what admins actually care about ($$ ranking). Tokens and slug
  // serve as deterministic tiebreakers so Top-N stays stable across calls.
  const rankedAgents = [...agentBuckets.values()]
    .sort(
      (a, b) =>
        b.costCents - a.costCents ||
        b.tokens - a.tokens ||
        a.agentSlug.localeCompare(b.agentSlug),
    )
    .slice(0, TOP_N);
  // A project agent books under its id; the table shows its name. The
  // buckets are this fold's own objects, so the name lands on them in place.
  const agentNameMap =
    resolveAgentNames === undefined
      ? new Map<string, string>()
      : await resolveAgentNames(rankedAgents.map((a) => a.agentSlug));
  for (const agent of rankedAgents) {
    const displayName = agentNameMap.get(agent.agentSlug);
    if (displayName !== undefined) agent.displayName = displayName;
  }
  const topAgents: UsageTopAgent[] = rankedAgents;

  const topModels: UsageTopModel[] = [...modelBuckets.values()]
    .sort(
      (a, b) =>
        b.costCents - a.costCents ||
        b.tokens - a.tokens ||
        `${a.provider}::${a.model}`.localeCompare(`${b.provider}::${b.model}`),
    )
    .slice(0, TOP_N);

  const topVoiceModels: UsageTopVoiceModel[] = [...voiceModelBuckets.values()]
    .sort(
      (a, b) =>
        b.costCents - a.costCents ||
        b.characters - a.characters ||
        `${a.provider}::${a.model}`.localeCompare(`${b.provider}::${b.model}`),
    )
    .slice(0, TOP_N);

  // Full user list (no Top-N cap) — admins need to see every user's usage
  // for team/budget drill-down, matching the pre-analytics UsageDashboard.
  const sortedUsers = [...userBuckets.values()].sort(
    (a, b) =>
      b.costCents - a.costCents ||
      b.tokens - a.tokens ||
      a.userId.localeCompare(b.userId),
  );
  const userNameMap = await resolveUserNames(sortedUsers.map((u) => u.userId));
  // A key that is not a person spends under an identity of its own: it is no
  // active user, and its row says which team, project or organization it
  // belongs to.
  const apiKeyIdentities =
    resolveApiKeyIdentities === undefined
      ? new Map<string, UsageApiKeyIdentity>()
      : await resolveApiKeyIdentities([
          ...new Set([
            ...sortedUsers.map((u) => u.userId),
            ...prevActiveUserIds,
          ]),
        ]);
  for (const identity of apiKeyIdentities.keys()) {
    activeUserIds.delete(identity);
    prevActiveUserIds.delete(identity);
  }
  const users: UsageUserRow[] = sortedUsers.map((u) => {
    const row: UsageUserRow = {
      userId: u.userId,
      displayName: userNameMap.get(u.userId) ?? u.userId,
      teamId: u.teamId,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      tokens: u.tokens,
      costCents: u.costCents,
      requests: u.requests,
    };
    const apiKey = apiKeyIdentities.get(u.userId);
    if (apiKey !== undefined) row.apiKey = apiKey;
    return row;
  });

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
    previousSummary: {
      totalRequests: prevTotalRequests,
      totalTokens: prevTotalTokens,
      totalCostCents: prevTotalCostCents,
      activeUsers: prevActiveUserIds.size,
    },
    series: [...seriesMap.values()],
    topAgents,
    topModels,
    topVoiceModels,
    users,
  };
}
