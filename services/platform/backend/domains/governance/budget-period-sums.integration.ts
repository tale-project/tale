/** Real Postgres proof; mounted by backend/integration-check.ts. */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { buildPeriodKeyFromTimestamp } from '../../core/governance/helpers.ts';
import {
  explainSentStatement,
  type PlanNode,
  planExecutionMs,
  planLine,
  planNodes,
  type RecordCheck,
  withCleanup,
} from '../../integration-lane-helpers.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import {
  type BudgetReservations,
  type BudgetViolation,
  findBudgetViolation,
  loadBudgetSubject,
  type OrgBudgetSubject,
  type ReservedSpend,
} from './budget-gate.ts';

/**
 * The budget gate's period sums over a ledger that holds many rows (#4710).
 * Every chat turn's admission sums, per cap, what was booked this period, in
 * the organization's admission lock. A person's, a team's and a key's sum
 * read their own rows through an index — the ledger's bucket index (`org_id,
 * user_id, period_key`) for a person and a team, `usage_ledger_api_key_period`
 * for a key — and only the organization's sum reads its whole period.
 *
 * The lane books a month no other lane books in (January 2099), in both
 * ledger tables: a crowd of members with a few hundred rows each, around the
 * people the caps are about — Ada and Ben, a team of the two, the team's own
 * key, and Ada's key — under every form the ledger has known a person as,
 * beside ids that only look like theirs, rows of other periods and the same
 * ids in another organization. Then:
 *
 * - each cap decides from what its scope booked plus what its work in flight
 *   holds: one unit under the cap admits, at the cap and one over it refuse,
 *   for tokens, cost and requests alike; a team's sum decides as the
 *   statement it replaced did, and a key's as it did before its index;
 * - the plans of a person's, a team's and a key's sum take exactly their
 *   scope's rows from those indexes, custom and generic alike;
 * - a benchmark sets the rows each sum reads, and how long it runs, against
 *   the way it read before, and times one admission both ways. Timings are
 *   reported, never asserted: a shared runner's clock says little, the rows
 *   read say it.
 */

/** The moment the admissions run at, in a month no other lane books in. */
const NOW = Date.UTC(2099, 0, 14, 12);
const MONTH = buildPeriodKeyFromTimestamp('monthly', NOW);
const LAST_MONTH = buildPeriodKeyFromTimestamp(
  'monthly',
  Date.UTC(2098, 11, 14, 12),
);
const TODAY = buildPeriodKeyFromTimestamp('daily', NOW);

/** The members around the people the caps are about, and the rows each
 * books this month (and a quarter as many today). */
const CROWD = 240;
const ROWS_EACH = 160;
/** Ledger rows per insert. */
const CHUNK = 10_000;
/** A bound no sum reaches. */
const HIGH = 1e12;
/** Admissions timed each way, after the ones that warm the caches. */
const WARMUPS = 2;
const RUNS = 15;

const BUCKET_INDEXES = ['usage_ledger_bucket', 'usage_ledger_provider_bucket'];
const KEY_INDEXES = [
  'usage_ledger_api_key_period',
  'usage_ledger_provider_api_key_period',
];
const LEDGER_TABLES = new Set(['usage_ledger', 'usage_ledger_provider']);
/** What every ledger sum's statement holds. */
const LEDGER_SUM = 'FROM app.usage_ledger';

/** What work in flight holds in each bucket: added to what was booked before
 * any cap is compared. */
const HOLDS = {
  user: { tokens: 17, costCents: 6.5, requests: 2 },
  team: { tokens: 29, costCents: 8.25, requests: 3 },
  apiKey: { tokens: 13, costCents: 4.75, requests: 1 },
  org: { tokens: 41, costCents: 12.5, requests: 5 },
} satisfies Record<string, ReservedSpend>;

/** One seeded ledger row. Its place in the seed list gives its numbers and
 * its table: an even one goes to `app.usage_ledger_provider`, as the current
 * image books, an odd one to `app.usage_ledger`, as the previous one did. */
interface Seed {
  org: string;
  user: string;
  period: string;
  key: string | null;
  connector: boolean;
}

const tokensAt = (index: number): number => 1 + ((index * 37) % 1000);
const costAt = (index: number): number => ((index * 13) % 41) / 4;
/** A connector's row carries the request it once counted; no sum takes it. */
const requestsAt = (seed: Seed, index: number): number =>
  seed.connector ? 1 : index % 3;

/** What a sum folds, and how many rows it takes. */
interface Totals extends ReservedSpend {
  rows: number;
}

/** The oracle: what the rows of `org`'s month that `counts` takes add up to,
 * from the seeds alone. */
function totalsOf(
  seeds: readonly Seed[],
  org: string,
  counts: (seed: Seed) => boolean,
): Totals {
  const totals: Totals = { tokens: 0, costCents: 0, requests: 0, rows: 0 };
  for (const [index, seed] of seeds.entries()) {
    if (seed.org !== org || seed.period !== MONTH || !counts(seed)) continue;
    totals.tokens += tokensAt(index);
    totals.costCents += costAt(index);
    if (!seed.connector) totals.requests += requestsAt(seed, index);
    totals.rows += 1;
  }
  return totals;
}

/** Every form the ledger has booked a person as — written out here, not
 * taken from the code under test. */
const formsOf = (id: string): string[] => [id, `user:${id}`, `api-key:${id}`];

interface SeedIds {
  org: string;
  otherOrg: string;
  ada: string;
  ben: string;
  identity: string;
  adaKey: string;
  teamKey: string;
  prefix: string;
}

/** The month's rows: the people the caps are about under every form, ids
 * that only look like theirs, the crowd, and the same people in another
 * period and in another organization. */
function seedsFor(ids: SeedIds): Seed[] {
  const seeds: Seed[] = [];
  const add = (
    count: number,
    user: string,
    how: {
      key?: string;
      connector?: boolean;
      org?: string;
      period?: string;
    } = {},
  ): void => {
    for (let n = 0; n < count; n += 1) {
      seeds.push({
        org: how.org ?? ids.org,
        user,
        period: how.period ?? MONTH,
        key: how.key ?? null,
        connector: how.connector ?? false,
      });
    }
  };
  // Ada under the bare id and the door forms, keyed and not, and a
  // connector's calls.
  add(24, ids.ada);
  add(12, `user:${ids.ada}`);
  add(12, `api-key:${ids.ada}`);
  add(10, ids.ada, { key: ids.adaKey });
  add(4, `api-key:${ids.ada}`, { key: ids.adaKey });
  add(6, ids.ada, { connector: true });
  add(16, ids.ben);
  add(8, `user:${ids.ben}`);
  add(4, `api-key:${ids.ben}`, { connector: true });
  // The team's key: its identity, keyed and not, and in the door forms.
  add(12, ids.identity, { key: ids.teamKey });
  add(6, ids.identity);
  add(3, `api-key:${ids.identity}`);
  add(3, `user:${ids.identity}`, { key: ids.teamKey });
  // Booked to a key under nobody's id: the key's spend, no person's.
  add(3, '__automation__', { key: ids.adaKey });
  add(2, '__automation__', { key: ids.teamKey });
  add(3, '__automation__');
  // Ids that only look like Ada's.
  for (const lookalike of [
    `user:user:${ids.ada}`,
    `xuser:${ids.ada}`,
    `trigger:${ids.ada}`,
    `${ids.ada}-twin`,
  ]) {
    add(3, lookalike);
  }
  for (let person = 0; person < CROWD; person += 1) {
    const id = `${ids.prefix}-p${person}`;
    const ownKey = person % 7 === 0 ? `${ids.prefix}-key-${person}` : null;
    for (let row = 0; row < ROWS_EACH; row += 1) {
      seeds.push({
        org: ids.org,
        user: row % 10 === 0 ? `user:${id}` : id,
        period: MONTH,
        key: ownKey !== null && row % 3 === 0 ? ownKey : null,
        connector: row % 11 === 0,
      });
    }
    add(ROWS_EACH / 4, id, { period: TODAY });
  }
  // The same people and keys in other periods, and in another organization.
  for (const period of [LAST_MONTH, TODAY]) {
    add(5, ids.ada, { period });
    add(5, ids.ada, { period, key: ids.adaKey });
    add(5, ids.identity, { period, key: ids.teamKey });
  }
  for (const user of [ids.ada, `user:${ids.ada}`, ids.ben, ids.identity]) {
    add(5, user, { org: ids.otherOrg });
  }
  add(5, ids.ada, { org: ids.otherOrg, key: ids.adaKey });
  add(5, ids.identity, { org: ids.otherOrg, key: ids.teamKey });
  return seeds;
}

/** Books the seeds, each in its table, a chunk of rows per statement. */
async function insertSeeds(sql: Sql, seeds: readonly Seed[]): Promise<void> {
  const updatedAt = Date.now();
  const placed = [...seeds.entries()];
  for (const provider of [true, false]) {
    const rows = placed.filter(([index]) => (index % 2 === 0) === provider);
    for (let start = 0; start < rows.length; start += CHUNK) {
      const chunk = rows.slice(start, start + CHUNK);
      await sql`
        INSERT INTO ${provider ? sql`app.usage_ledger_provider` : sql`app.usage_ledger`} (
          org_id, user_id, period_key, granularity, agent_slug, model,
          provider, api_key_id, connector_name, connector_operation,
          input_tokens, total_tokens, cost_estimate_cents, request_count,
          connector_call_count, updated_at_ms
        )
        SELECT b.org_id, b.user_id, b.period_key, b.granularity, b.agent_slug,
               'itest-model', ${provider ? 'itest-provider' : null}::text,
               NULLIF(b.api_key_id, ''), NULLIF(b.connector_name, ''),
               CASE WHEN b.connector_name = '' THEN NULL ELSE 'itest-call' END,
               b.tokens, b.tokens, b.cost, b.requests,
               CASE WHEN b.connector_name = '' THEN 0 ELSE 1 END,
               ${updatedAt}::bigint
        FROM unnest(
          ${chunk.map(([, seed]) => seed.org)}::text[],
          ${chunk.map(([, seed]) => seed.user)}::text[],
          ${chunk.map(([, seed]) => seed.period)}::text[],
          ${chunk.map(([, seed]) => (seed.period === TODAY ? 'daily' : 'monthly'))}::text[],
          ${chunk.map(([index]) => `bench-${index}`)}::text[],
          ${chunk.map(([, seed]) => seed.key ?? '')}::text[],
          ${chunk.map(([, seed]) => (seed.connector ? 'itest-connector' : ''))}::text[],
          ${chunk.map(([index]) => tokensAt(index))}::bigint[],
          ${chunk.map(([index]) => costAt(index))}::float8[],
          ${chunk.map(([index, seed]) => requestsAt(seed, index))}::int[]
        ) AS b(org_id, user_id, period_key, granularity, agent_slug,
               api_key_id, connector_name, tokens, cost, requests)
      `;
    }
  }
}

const isTemplate = (value: unknown): value is TemplateStringsArray =>
  Array.isArray(value) && 'raw' in value;

const teamSumValues = z.tuple([z.string(), z.string(), z.string()]);
const keySumValues = z.tuple([
  z.string(),
  z.string(),
  z.string(),
  z.array(z.string()),
]);

/**
 * The gate as it read before #4710: a team's sum through the statement it
 * replaced, which strips the door prefixes off every row of the
 * organization's period before it compares one, and a key's through its own
 * statement with the key compared in a form no index serves — `api_key_id ||
 * ''` is the key on every keyed row and null on the rest, so the rows are the
 * same and the plan reads the period as it did before the key had an index.
 * Every other statement goes as it is.
 */
function readingAsBefore(tag: Sql | TransactionSql): Sql | TransactionSql {
  return new Proxy(tag, {
    apply(target, thisArg: unknown, args: unknown[]): unknown {
      const [strings, ...values] = args;
      const text = isTemplate(strings) ? strings.join(' ') : '';
      if (text.includes(LEDGER_SUM) && text.includes('"teamMember"')) {
        const [organizationId, periodKey, teamId] = teamSumValues.parse(
          values.slice(0, 3),
        );
        return target`
          SELECT coalesce(sum(total_tokens), 0)::float8 AS "totalTokens",
                 coalesce(sum(cost_estimate_cents), 0)::float8 AS "costEstimate",
                 coalesce(sum(request_count) FILTER (WHERE connector_name IS NULL), 0)::float8
                   AS "requestCount"
          FROM app.usage_ledger
          WHERE org_id = ${organizationId} AND period_key = ${periodKey}
            AND regexp_replace(user_id, '^(user|api-key):', '') IN (
              SELECT tm."userId" FROM "teamMember" tm
              JOIN "team" t ON t."id" = tm."teamId"
              WHERE tm."teamId" = ${teamId}
                AND t."organizationId" = ${organizationId}
              UNION ALL
              SELECT o.principal_user_id FROM app.api_key_owners o
              WHERE o.team_id = ${teamId}
                AND o.org_id = ${organizationId}
                AND o.owner_kind = 'team'
            )
        `;
      }
      if (text.includes(LEDGER_SUM) && text.includes('api_key_id =')) {
        const [organizationId, periodKey, apiKeyId, forms] =
          keySumValues.parse(values);
        return target`
          SELECT coalesce(sum(total_tokens), 0)::float8 AS "totalTokens",
                 coalesce(sum(cost_estimate_cents), 0)::float8 AS "costEstimate",
                 coalesce(sum(request_count) FILTER (WHERE connector_name IS NULL), 0)::float8
                   AS "requestCount"
          FROM app.usage_ledger
          WHERE org_id = ${organizationId} AND period_key = ${periodKey}
            AND ((api_key_id || '') = ${apiKeyId}
                 OR user_id = ANY(${forms}))
        `;
      }
      const passed: unknown = Reflect.apply(target, thisArg, args);
      return passed;
    },
  });
}

/** The ledger rows a plan that ran read: what each scan of a ledger table
 * returned or threw away, over every loop of it. */
function ledgerRowsRead(nodes: readonly PlanNode[] | null): number | null {
  if (nodes === null) return null;
  let read = 0;
  for (const node of nodes) {
    if (!LEDGER_TABLES.has(node['Relation Name'] ?? '')) continue;
    read +=
      ((node['Actual Rows'] ?? 0) +
        (node['Rows Removed by Filter'] ?? 0) +
        (node['Rows Removed by Index Recheck'] ?? 0)) *
      (node['Actual Loops'] ?? 1);
  }
  return read;
}

/** Whether a plan reads the ledger through each `required` index, through no
 * index but the `allowed` ones, and never scans a ledger table whole. */
function readsThrough(
  nodes: readonly PlanNode[] | null,
  required: readonly string[],
  allowed: readonly string[],
): boolean {
  if (nodes === null) return false;
  const taken = new Set<string>();
  for (const node of nodes) {
    const index = node['Index Name'];
    if (index?.startsWith('usage_ledger') === true) taken.add(index);
  }
  return (
    required.every((index) => taken.has(index)) &&
    [...taken].every((index) => allowed.includes(index)) &&
    !nodes.some(
      (node) =>
        node['Node Type'] === 'Seq Scan' &&
        LEDGER_TABLES.has(node['Relation Name'] ?? ''),
    )
  );
}

/** The median and the 95th percentile of `samples`, in milliseconds. */
function spread(samples: readonly number[]): {
  medianMs: number;
  p95Ms: number;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (quantile: number): number =>
    Math.round(
      (sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] ??
        Number.NaN) * 100,
    ) / 100;
  return { medianMs: at(0.5), p95Ms: at(0.95) };
}

/** One admission timed as the gate reads now and as it read before, each in
 * a transaction as a turn's admission runs, alternating which goes first. */
async function timeAdmissions(
  sql: Sql,
  admit: (tag: Sql | TransactionSql) => Promise<unknown>,
): Promise<{
  before: ReturnType<typeof spread>;
  after: ReturnType<typeof spread>;
}> {
  const before: number[] = [];
  const after: number[] = [];
  for (let run = 0; run < WARMUPS + RUNS; run += 1) {
    for (const asBefore of run % 2 === 0 ? [true, false] : [false, true]) {
      const started = performance.now();
      await sql.begin((tx) => admit(asBefore ? readingAsBefore(tx) : tx));
      const took = performance.now() - started;
      if (run < WARMUPS) continue;
      if (asBefore) before.push(took);
      else after.push(took);
    }
  }
  return { before: spread(before), after: spread(after) };
}

/** A budget rule as the budgets file holds it, for the scopes this lane
 * caps. */
interface Rule {
  scope: 'user' | 'team' | 'apiKey' | 'org';
  scopeId?: string;
  apiKeyId?: string;
  period: 'monthly';
  maxTokens: number;
  maxCostCents: number;
  maxRequests: number;
}
type RuleTarget = Pick<Rule, 'scope' | 'scopeId' | 'apiKeyId'>;
type CapField = 'maxTokens' | 'maxCostCents' | 'maxRequests';

/** A rule for `target` with `cap` on `field`, and every other bound out of
 * reach. */
const capped = (
  target: RuleTarget,
  field: CapField | null,
  cap: number = HIGH,
): Rule => ({
  ...target,
  period: 'monthly',
  maxTokens: field === 'maxTokens' ? cap : HIGH,
  maxCostCents: field === 'maxCostCents' ? cap : HIGH,
  maxRequests: field === 'maxRequests' ? cap : HIGH,
});

/** The three bounds a cap sets, each with the code its refusal names. */
const KINDS = [
  {
    field: 'maxTokens',
    code: 'TOKEN_LIMIT',
    of: (spend: ReservedSpend) => spend.tokens,
  },
  {
    field: 'maxCostCents',
    code: 'COST_LIMIT',
    of: (spend: ReservedSpend) => spend.costCents,
  },
  {
    field: 'maxRequests',
    code: 'REQUEST_LIMIT',
    of: (spend: ReservedSpend) => spend.requests,
  },
] as const;

/** Each cap one unit over what was spent, at it, and one under it. */
const ROOMS = [1, 0, -1];

/** A refusal as a boundary expects it. */
interface Refusal {
  scope: BudgetViolation['scope'];
  teamId: string | undefined;
  code: BudgetViolation['code'];
  used: number;
  limit: number;
}

const decides = (got: BudgetViolation | null, want: Refusal | null): boolean =>
  want === null
    ? got === null
    : got !== null &&
      got.scope === want.scope &&
      got.teamId === want.teamId &&
      got.code === want.code &&
      got.used === want.used &&
      got.limit === want.limit;

/** One bucket the boundaries walk. */
interface Bucket {
  /** What the record says of it, and the rules it proves. */
  says: string;
  tags: string;
  scope: BudgetViolation['scope'];
  teamId?: string;
  target: RuleTarget;
  subject: OrgBudgetSubject;
  booked: Totals;
  held: ReservedSpend;
  /** Whether its sum read otherwise before #4710. */
  replaced: boolean;
}

/** One sum whose plan the lane reads. */
interface SumUnderTest {
  sum: string;
  subject: OrgBudgetSubject;
  sends: (template: string) => boolean;
  rows: number;
  /** The indexes it must read through, and the ones it may; null for the
   * organization's sum, which reads the whole period by design. */
  indexes: { required: string[]; allowed: string[] } | null;
  replaced: boolean;
}

export async function checkBudgetPeriodSums(
  sql: Sql,
  record: RecordCheck,
): Promise<void> {
  const prefix = `itest-budget-sums-${randomUUID().slice(0, 8)}`;
  const ids: SeedIds = {
    org: prefix,
    otherOrg: `${prefix}-other`,
    ada: `${prefix}-ada`,
    ben: `${prefix}-ben`,
    identity: `${prefix}-team-key`,
    adaKey: `${prefix}-ada-key`,
    teamKey: `${prefix}-team-key-id`,
    prefix,
  };
  const teamId = `${prefix}-team`;
  const orgDir = path.join(process.env.TALE_CONFIG_DIR ?? '', ids.org);
  const governanceDir = path.join(orgDir, 'governance');
  const writePolicy = async (rules: readonly Rule[]): Promise<void> => {
    await writeFile(
      path.join(governanceDir, 'budgets.yml'),
      JSON.stringify({ enabled: true, rules }),
    );
    clearOrgConfigCaches();
  };
  const everyCapOutOfReach = [
    capped({ scope: 'user', scopeId: ids.ada }, null),
    capped({ scope: 'team', scopeId: teamId }, null),
    capped({ scope: 'apiKey', apiKeyId: ids.adaKey }, null),
    capped({ scope: 'apiKey', apiKeyId: ids.teamKey }, null),
    capped({ scope: 'org' }, null),
  ];
  const reservations: BudgetReservations = {
    user: HOLDS.user,
    teams: { [teamId]: HOLDS.team },
    apiKey: HOLDS.apiKey,
    org: HOLDS.org,
  };
  const admitting = { reservations, now: NOW };

  await withCleanup(
    [
      [
        'deletes its ledger rows',
        () =>
          sql`DELETE FROM app.usage_ledger WHERE org_id IN (${ids.org}, ${ids.otherOrg})`,
      ],
      [
        "deletes its team key's owner row",
        () =>
          sql`DELETE FROM app.api_key_owners WHERE api_key_id = ${ids.teamKey}`,
      ],
      [
        'deletes its team',
        async () => {
          await sql`DELETE FROM "teamMember" WHERE "teamId" = ${teamId}`;
          await sql`DELETE FROM "team" WHERE "id" = ${teamId}`;
        },
      ],
      [
        'deletes its memberships',
        () => sql`DELETE FROM "member" WHERE "organizationId" = ${ids.org}`,
      ],
      [
        'deletes its organization',
        () => sql`DELETE FROM "organization" WHERE "id" = ${ids.org}`,
      ],
      [
        'deletes its users',
        () => sql`DELETE FROM "user" WHERE "id" IN (${ids.ada}, ${ids.ben})`,
      ],
      [
        'removes its policy file',
        async () => {
          await rm(orgDir, { recursive: true, force: true });
          clearOrgConfigCaches();
        },
      ],
      [
        "refreshes the ledger's statistics",
        () => sql`ANALYZE app.usage_ledger, app.usage_ledger_provider`,
      ],
    ],
    async () => {
      // The policy is on disk before its organization exists, so no read
      // caches the organization without it.
      await mkdir(governanceDir, { recursive: true });
      await writePolicy(everyCapOutOfReach);
      const stamp = new Date();
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO "organization" ("id", "name", "slug", "createdAt")
          VALUES (${ids.org}, 'Budget period sums fixture', ${ids.org}, ${stamp})
        `;
        for (const id of [ids.ada, ids.ben]) {
          await tx`
            INSERT INTO "user" ("id", "email", "name", "emailVerified",
                                "createdAt", "updatedAt")
            VALUES (${id}, ${`${id}@example.test`}, 'Budget period sums fixture',
                    true, ${stamp}, ${stamp})
          `;
          await tx`
            INSERT INTO "member" ("id", "organizationId", "userId", "role",
                                  "createdAt")
            VALUES (${`${id}-seat`}, ${ids.org}, ${id}, 'member', ${stamp})
          `;
        }
        await tx`
          INSERT INTO "team" ("id", "name", "organizationId", "createdAt")
          VALUES (${teamId}, 'Budget period sums fixture', ${ids.org}, ${stamp})
        `;
        for (const id of [ids.ada, ids.ben]) {
          await tx`
            INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
            VALUES (${`${id}-in-team`}, ${teamId}, ${id}, ${stamp})
          `;
        }
        // The team's own key: an identity of its own, with no membership.
        await tx`
          INSERT INTO app.api_key_owners (
            api_key_id, org_id, owner_kind, key_user_id, principal_user_id,
            team_id, role, name, created_by, created_at_ms
          ) VALUES (
            ${ids.teamKey}, ${ids.org}, 'team', ${ids.identity}, ${ids.identity},
            ${teamId}, 'member', 'Budget period sums fixture', ${ids.ada},
            ${stamp.getTime()}
          )
        `;
      });
      const seeds = seedsFor(ids);
      await insertSeeds(sql, seeds);
      // The planner reads the month's statistics, as it does once autovacuum
      // has analyzed a ledger this size.
      await sql`ANALYZE app.usage_ledger, app.usage_ledger_provider`;

      const person = new Set(formsOf(ids.ada));
      const team = new Set(
        [ids.ada, ids.ben, ids.identity].flatMap((id) => formsOf(id)),
      );
      const identityForms = new Set(formsOf(ids.identity));
      const oracle = {
        person: totalsOf(seeds, ids.org, (seed) => person.has(seed.user)),
        team: totalsOf(seeds, ids.org, (seed) => team.has(seed.user)),
        adaKey: totalsOf(seeds, ids.org, (seed) => seed.key === ids.adaKey),
        teamKey: totalsOf(
          seeds,
          ids.org,
          (seed) => seed.key === ids.teamKey || identityForms.has(seed.user),
        ),
        org: totalsOf(seeds, ids.org, () => true),
      };
      const ada = await loadBudgetSubject(sql, {
        organizationId: ids.org,
        userId: ids.ada,
      });
      const adaKeyed = await loadBudgetSubject(sql, {
        organizationId: ids.org,
        userId: ids.ada,
        apiKeyId: ids.adaKey,
      });
      const teamKeyed = await loadBudgetSubject(sql, {
        organizationId: ids.org,
        userId: ids.identity,
      });
      const subjects = `subjects: Ada in teams ${JSON.stringify(ada.userTeamIds)}, the team key ${teamKeyed.impersonal === true ? 'impersonal' : 'a person'} with key ${teamKeyed.apiKeyId} in teams ${JSON.stringify(teamKeyed.userTeamIds)}`;

      const buckets: Bucket[] = [
        {
          says: "a person's cap counts what they booked under every form the ledger has known them as, plus their holds",
          tags: '[GOV-R1] [GOV-R4] [GOV-R5]',
          scope: 'user',
          target: { scope: 'user', scopeId: ids.ada },
          subject: ada,
          booked: oracle.person,
          held: HOLDS.user,
          replaced: false,
        },
        {
          says: "a team's cap counts what its members and its own key booked under every form, plus the team's holds",
          tags: '[GOV-R2] [GOV-R4] [GOV-R5]',
          scope: 'team',
          teamId,
          target: { scope: 'team', scopeId: teamId },
          subject: ada,
          booked: oracle.team,
          held: HOLDS.team,
          replaced: true,
        },
        {
          says: "a member's key cap counts what was booked to the key, whoever it was booked under, plus the key's holds",
          tags: '[GOV-R3] [GOV-R4] [GOV-R5]',
          scope: 'apiKey',
          target: { scope: 'apiKey', apiKeyId: ids.adaKey },
          subject: adaKeyed,
          booked: oracle.adaKey,
          held: HOLDS.apiKey,
          replaced: true,
        },
        {
          says: "a team key's cap counts everything its identity booked, keyed or not, plus the key's holds",
          tags: '[GOV-R3] [GOV-R4] [GOV-R5]',
          scope: 'apiKey',
          target: { scope: 'apiKey', apiKeyId: ids.teamKey },
          subject: teamKeyed,
          booked: oracle.teamKey,
          held: HOLDS.apiKey,
          replaced: true,
        },
        {
          says: "the organization's cap counts what everyone in it booked, plus its holds",
          tags: '[GOV-R4] [GOV-R5]',
          scope: 'org',
          target: { scope: 'org' },
          subject: ada,
          booked: oracle.org,
          held: HOLDS.org,
          replaced: false,
        },
      ];
      for (const bucket of buckets) {
        const spent: string[] = [];
        const misses: string[] = [];
        for (const kind of KINDS) {
          const used = kind.of(bucket.booked) + kind.of(bucket.held);
          spent.push(
            `${kind.code} ${kind.of(bucket.booked)} booked + ${kind.of(bucket.held)} held`,
          );
          for (const room of ROOMS) {
            const cap = used + room;
            await writePolicy([capped(bucket.target, kind.field, cap)]);
            const want: Refusal | null =
              room > 0
                ? null
                : {
                    scope: bucket.scope,
                    teamId: bucket.teamId,
                    code: kind.code,
                    used,
                    limit: cap,
                  };
            const readings: [string, BudgetViolation | null][] = [
              [
                'now',
                await findBudgetViolation(sql, bucket.subject, admitting),
              ],
            ];
            if (bucket.replaced) {
              readings.push([
                'before',
                await findBudgetViolation(
                  readingAsBefore(sql),
                  bucket.subject,
                  admitting,
                ),
              ]);
            }
            for (const [gate, got] of readings) {
              if (decides(got, want)) continue;
              misses.push(
                `${gate}, ${kind.code} cap ${cap}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
              );
            }
          }
        }
        record(
          `budget period sums: ${bucket.says} — one unit under the cap admits, at it and one over it refuse, for tokens, cost and requests${bucket.replaced ? ', as the sum read before' : ''} ${bucket.tags}`,
          misses.length === 0,
          `${spent.join(', ')} in ${bucket.booked.rows} rows; ${misses.length === 0 ? 'every cap decided as expected' : misses.join(' | ')}; ${subjects}`,
        );
      }

      await writePolicy(everyCapOutOfReach);
      const keySum = (template: string): boolean =>
        template.includes(LEDGER_SUM) &&
        template.includes('api_key_id') &&
        !template.includes('"teamMember"');
      const bucketIndexes = {
        required: BUCKET_INDEXES,
        allowed: BUCKET_INDEXES,
      };
      const keyIndexes = {
        required: KEY_INDEXES,
        allowed: [...KEY_INDEXES, ...BUCKET_INDEXES],
      };
      const sums: SumUnderTest[] = [
        {
          sum: 'person',
          subject: adaKeyed,
          sends: (template) =>
            template.includes(LEDGER_SUM) &&
            template.includes('user_id = ANY(') &&
            !template.includes('"teamMember"') &&
            !template.includes('api_key_id'),
          rows: oracle.person.rows,
          indexes: bucketIndexes,
          replaced: false,
        },
        {
          sum: 'team',
          subject: adaKeyed,
          sends: (template) =>
            template.includes(LEDGER_SUM) && template.includes('"teamMember"'),
          rows: oracle.team.rows,
          indexes: bucketIndexes,
          replaced: true,
        },
        {
          sum: "member's key",
          subject: adaKeyed,
          sends: keySum,
          rows: oracle.adaKey.rows,
          indexes: keyIndexes,
          replaced: true,
        },
        {
          sum: "team's key",
          subject: teamKeyed,
          sends: keySum,
          rows: oracle.teamKey.rows,
          indexes: keyIndexes,
          replaced: true,
        },
        {
          sum: 'organization',
          subject: adaKeyed,
          sends: (template) =>
            template.includes(LEDGER_SUM) &&
            !template.includes('user_id') &&
            !template.includes('api_key_id'),
          rows: oracle.org.rows,
          indexes: null,
          replaced: false,
        },
      ];
      const explain = (sum: SumUnderTest, asBefore: boolean) =>
        explainSentStatement<{ 'QUERY PLAN': unknown }>(
          sql,
          sum.sends,
          async (tx) => {
            // One process per scan, so a node's rows are all it read.
            await tx`SET LOCAL max_parallel_workers_per_gather = 0`;
            return findBudgetViolation(
              asBefore ? readingAsBefore(tx) : tx,
              sum.subject,
              admitting,
            );
          },
          { analyze: true, json: true },
        );
      let plansOk = true;
      let fewerRows = true;
      const plans: string[] = [];
      const measured: Record<string, unknown> = {};
      for (const sum of sums) {
        const after = await explain(sum, false);
        const custom = planNodes(after.custom);
        const generic = planNodes(after.generic);
        const read = ledgerRowsRead(custom);
        if (sum.indexes !== null) {
          plansOk &&=
            readsThrough(custom, sum.indexes.required, sum.indexes.allowed) &&
            readsThrough(generic, sum.indexes.required, sum.indexes.allowed) &&
            read === sum.rows;
        }
        plans.push(
          `${sum.sum}: read ${read} of its ${sum.rows} rows; custom ${planLine(custom)}; generic ${planLine(generic)}`,
        );
        if (!sum.replaced) {
          measured[sum.sum] = {
            rowsRead: read,
            executionMs: planExecutionMs(after.custom),
          };
          continue;
        }
        const before = await explain(sum, true);
        const readBefore = ledgerRowsRead(planNodes(before.custom));
        fewerRows &&= read !== null && readBefore !== null && read < readBefore;
        measured[sum.sum] = {
          rowsRead: { before: readBefore, after: read },
          executionMs: {
            before: planExecutionMs(before.custom),
            after: planExecutionMs(after.custom),
          },
        };
      }
      record(
        "budget period sums: a person's, a team's and a key's sum read only their own rows, through the ledger's bucket index or usage_ledger_api_key_period on both ledger tables, in their custom and generic plans [GOV-R1] [GOV-R2] [GOV-R3]",
        plansOk,
        plans.join(' | '),
      );

      const admitAda = (tag: Sql | TransactionSql) =>
        findBudgetViolation(tag, adaKeyed, admitting);
      await writePolicy(everyCapOutOfReach.slice(0, 3));
      const personTeamKey = await timeAdmissions(sql, admitAda);
      await writePolicy(everyCapOutOfReach);
      const withOrganizationCap = await timeAdmissions(sql, admitAda);
      record(
        "budget period sums: benchmark — a team's and a key's sum read fewer of the organization's month of ledger rows than they did before; one admission's time reported, not asserted",
        fewerRows,
        JSON.stringify({
          seededRows: seeds.length,
          organizationMonthRows: oracle.org.rows,
          sums: measured,
          admission: {
            runs: RUNS,
            personTeamAndKeyCaps: personTeamKey,
            withOrganizationCap,
          },
          latencyThresholdAsserted: false,
        }),
      );
    },
  );
}
