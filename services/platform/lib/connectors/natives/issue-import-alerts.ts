/**
 * GitHub security alert intake: the open code scanning, Dependabot and
 * secret scanning alerts of one repository, read the way the issue readers
 * read issues (`issue-import.ts`) — bounded, resumable, and only ever read.
 *
 * A repository can hold thousands of open alerts, most of them from one
 * scanner, so a source narrows its listing on GitHub's side: the kinds of
 * alert, the code scanning tools, and a severity floor. Each narrowing GitHub
 * takes one value of is a listing of its own (a lane): a code scanning lane
 * per tool and severity, one Dependabot lane (it takes several severities at
 * once), one secret scanning lane. One cursor walks the lanes in order, and
 * the reader checks each alert's tool and level again.
 *
 * The severity floor reads one scale over GitHub's two: a security alert's
 * critical, high, medium or low, and an alert that is not one's error,
 * warning or note, read as high, medium and low. A secret is always read as
 * critical. The secret itself is never asked for (`hide_secret`) and never
 * kept: a task names the kind of secret and where it was found.
 *
 * Identity: one task per alert. An alert's number is unique per repository
 * and kind, so a snapshot's id is `<repository id>/<kind>/<number>`.
 */

import { taskExternalIssueSchema } from '@tale/shared/schemas/task-external-issue';
import { z } from 'zod';

import { truncateImportedDescription } from '../../../backend/core/tasks/helpers';
import type {
  NativeConnectorContext,
  NativeConnectorImpl,
} from '../dispatcher';
import {
  answerRefresh,
  cursor,
  discover,
  get,
  invalid,
  laneStart,
  limit,
  parse,
  position,
  positionSchema,
  requireSuccess,
  rows,
  sourceTime,
  storable,
  unavailable,
  type ImportedIssue,
  type Position,
} from './issue-import';

/** The kinds of alert, in the order a source reads them. */
export const SECURITY_ALERT_KINDS = [
  'code-scanning',
  'dependabot',
  'secret-scanning',
] as const;

export type SecurityAlertKind = (typeof SECURITY_ALERT_KINDS)[number];

/** The severity floor's scale, lowest first. */
export const SECURITY_SEVERITIES = [
  'low',
  'medium',
  'high',
  'critical',
] as const;

export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number];

/** The code scanning severities GitHub filters by, each once, at or above a
 * floor: a security alert's level, and an alert that is not one's level read
 * on the same scale (error as high, warning as medium). Below medium, no
 * filter at all — every alert. */
const CODE_SCANNING_AT_LEAST: Record<SecuritySeverity, string[] | null> = {
  low: null,
  medium: ['critical', 'high', 'error', 'medium', 'warning'],
  high: ['critical', 'high', 'error'],
  critical: ['critical'],
};

const DEPENDABOT_AT_LEAST: Record<SecuritySeverity, string | null> = {
  low: null,
  medium: 'critical,high,medium',
  high: 'critical,high',
  critical: 'critical',
};

/** A code scanning tool's name as GitHub knows it (`CodeQL`, `Trivy`):
 * any text but a control character, which no tool's name carries, so a
 * typo is refused where the source is written, never on each run. The
 * listing encodes it into its address. The one rule for the sync's
 * sources and for the listing. */
export const securityToolName = z
  .string()
  .regex(/^[^\u0000-\u001f\u007f]*$/, {
    message: 'is a tool name without control characters',
  })
  .trim()
  .min(1)
  .max(100);

const listInput = z
  .object({
    owner: z
      .string()
      .regex(/^[A-Za-z0-9-]+$/)
      .max(100),
    repo: z
      .string()
      .regex(/^[A-Za-z0-9_.-]+$/)
      .max(100),
    alerts: z.array(z.enum(SECURITY_ALERT_KINDS)).min(1).max(3),
    minSeverity: z.enum(SECURITY_SEVERITIES).optional(),
    tools: z.array(securityToolName).max(10).optional(),
    limit,
    cursor,
  })
  .strict();

const alertRef = z
  .object({
    externalId: z.string().min(1),
    externalIssue: taskExternalIssueSchema.nullable(),
  })
  .passthrough();

/** The repository as `owner/name`, which the listing answered. */
const repositoryName = z
  .string()
  .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/)
  .max(201);

const getInput = z
  .object({
    issue: alertRef,
    repository: repositoryName,
    repositoryId: z.number().int().positive().safe().optional(),
  })
  .strict();

const refreshInput = z
  .object({
    issues: z.array(alertRef).max(500),
    repository: repositoryName,
    repositoryId: z.number().int().positive().safe().optional(),
    report: z.boolean().optional(),
  })
  .strict();

/** One listing of a source's alerts. */
type Lane =
  | { kind: 'code-scanning'; tool?: string; severity?: string }
  | { kind: 'dependabot'; severities?: string }
  | { kind: 'secret-scanning' };

/** The listings a source is read through, in order: its kinds as listed in
 * {@link SECURITY_ALERT_KINDS}, code scanning per tool (sorted) and
 * severity. */
export function alertLanes(input: {
  alerts: readonly SecurityAlertKind[];
  minSeverity?: SecuritySeverity | undefined;
  tools?: readonly string[] | undefined;
}): Lane[] {
  const floor = input.minSeverity ?? 'low';
  const lanes: Lane[] = [];
  for (const kind of SECURITY_ALERT_KINDS) {
    if (!input.alerts.includes(kind)) continue;
    if (kind === 'code-scanning') {
      const tools = [...new Set(input.tools ?? [])].sort();
      const severities = CODE_SCANNING_AT_LEAST[floor];
      for (const tool of tools.length === 0 ? [undefined] : tools) {
        for (const severity of severities ?? [undefined]) {
          lanes.push({
            kind,
            ...(tool !== undefined && { tool }),
            ...(severity !== undefined && { severity }),
          });
        }
      }
    } else if (kind === 'dependabot') {
      const severities = DEPENDABOT_AT_LEAST[floor];
      lanes.push({ kind, ...(severities !== null && { severities }) });
    } else {
      lanes.push({ kind });
    }
  }
  return lanes;
}

const alertUrl = z.string().url();

const codeScanningSchema = z
  .object({
    number: z.number().int().positive().safe(),
    html_url: alertUrl,
    state: z.string().nullable(),
    updated_at: z.string().nullable().optional(),
    rule: z
      .object({
        id: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        severity: z.string().nullable().optional(),
        security_severity_level: z.string().nullable().optional(),
        help: z.string().nullable().optional(),
      })
      .passthrough(),
    tool: z
      .object({ name: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    most_recent_instance: z
      .object({
        ref: z.string().nullable().optional(),
        message: z
          .object({ text: z.string().nullable().optional() })
          .passthrough()
          .nullable()
          .optional(),
        location: z
          .object({
            path: z.string().nullable().optional(),
            start_line: z.number().nullable().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const dependabotSchema = z
  .object({
    number: z.number().int().positive().safe(),
    html_url: alertUrl,
    state: z.string(),
    updated_at: z.string().nullable().optional(),
    dependency: z
      .object({
        package: z
          .object({
            ecosystem: z.string().nullable().optional(),
            name: z.string().nullable().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
        manifest_path: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    security_advisory: z
      .object({
        ghsa_id: z.string().nullable().optional(),
        cve_id: z.string().nullable().optional(),
        summary: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        severity: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    security_vulnerability: z
      .object({
        severity: z.string().nullable().optional(),
        vulnerable_version_range: z.string().nullable().optional(),
        first_patched_version: z
          .object({ identifier: z.string().nullable().optional() })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

// The secret's own value is never read: the schema leaves `secret` out, and
// the listing asks GitHub not to send it.
const secretScanningSchema = z.object({
  number: z.number().int().positive().safe(),
  html_url: alertUrl,
  state: z.string(),
  resolution: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  secret_type: z.string().nullable().optional(),
  secret_type_display_name: z.string().nullable().optional(),
  validity: z.string().nullable().optional(),
  first_location_detected: z
    .object({
      path: z.string().nullable().optional(),
      start_line: z.number().nullable().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
});

type SourceState = ImportedIssue['externalIssue']['state'];

/** An alert's state as a snapshot keeps it: open, resolved (fixed, or a
 * revoked secret), ignored (dismissed, or a secret resolved as a false
 * positive, not to be fixed, or used in tests), closed otherwise. */
export function alertState(
  kind: SecurityAlertKind,
  state: string | null,
  resolution?: string | null,
): SourceState {
  if (state === 'open') return 'open';
  if (kind === 'secret-scanning' && state === 'resolved') {
    if (resolution === 'revoked') return 'resolved';
    if (
      resolution === 'false_positive' ||
      resolution === 'wont_fix' ||
      resolution === 'used_in_tests'
    )
      return 'ignored';
    return 'closed';
  }
  if (state === 'fixed') return 'resolved';
  if (state === 'dismissed' || state === 'auto_dismissed') return 'ignored';
  return 'closed';
}

/** Text a description line can carry: one line, no NUL. */
function line(text: string | null | undefined): string {
  return storable(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The longest help or advisory text a description quotes. */
const QUOTED_TEXT_MAX = 8000;

/** A description of labelled facts, the blank ones left out, then a body. */
function describe(
  facts: Array<[string, string | null | undefined]>,
  body?: string | null,
): string {
  const lines = facts
    .map(([label, value]) => [label, line(value)] as const)
    .filter(([, value]) => value !== '')
    .map(([label, value]) => `- ${label}: ${value}`);
  const text = storable(body ?? '').trim();
  return [lines.join('\n'), text.slice(0, QUOTED_TEXT_MAX)]
    .filter((part) => part !== '')
    .join('\n\n');
}

/** A place in a file, `path:line`, or the path alone. */
function place(
  path: string | null | undefined,
  start: number | null | undefined,
): string {
  const file = line(path);
  if (file === '') return '';
  return typeof start === 'number' && start > 0 ? `${file}:${start}` : file;
}

/** The alert's link, checked: GitHub's own, of this kind and number. */
function checkedUrl(
  html: string,
  kind: SecurityAlertKind,
  number: number,
): { url: string; repository: string } {
  const url = new URL(html);
  const ref = /^\/([^/]+)\/([^/]+)\/security\/([a-z-]+)\/([1-9][0-9]*)$/.exec(
    url.pathname,
  );
  if (
    url.origin !== 'https://github.com' ||
    !ref ||
    ref[3] !== kind ||
    Number(ref[4]) !== number
  )
    invalid('GitHub returned an invalid security alert URL.');
  return { url: html, repository: `${ref[1]}/${ref[2]}` };
}

/** One alert as a task takes it. */
export function securityAlert(
  kind: SecurityAlertKind,
  raw: unknown,
  repositoryId: number,
): ImportedIssue {
  let number: number;
  let html: string;
  let title: string;
  let description: string;
  let state: SourceState;
  let updatedAt: string | undefined;
  if (kind === 'code-scanning') {
    const row = parse(codeScanningSchema, raw);
    const rule =
      line(row.rule.description) || line(row.rule.name) || line(row.rule.id);
    const location = place(
      row.most_recent_instance?.location?.path,
      row.most_recent_instance?.location?.start_line,
    );
    number = row.number;
    html = row.html_url;
    title = [rule || `Code scanning alert ${row.number}`, location]
      .filter((part) => part !== '')
      .join(' in ');
    description = describe(
      [
        ['Tool', row.tool?.name],
        ['Rule', row.rule.id],
        [
          'Severity',
          row.rule.security_severity_level ?? row.rule.severity ?? undefined,
        ],
        ['Location', location],
        ['Branch', row.most_recent_instance?.ref],
        ['Message', row.most_recent_instance?.message?.text],
      ],
      row.rule.help,
    );
    state = alertState(kind, row.state);
    updatedAt = sourceTime(row.updated_at);
  } else if (kind === 'dependabot') {
    const row = parse(dependabotSchema, raw);
    const advisory = row.security_advisory;
    const pkg = row.dependency?.package;
    number = row.number;
    html = row.html_url;
    title = [
      line(advisory?.summary) || `Dependabot alert ${row.number}`,
      line(pkg?.name),
    ]
      .filter((part) => part !== '')
      .join(' in ');
    description = describe(
      [
        [
          'Severity',
          row.security_vulnerability?.severity ?? advisory?.severity,
        ],
        [
          'Package',
          [line(pkg?.ecosystem), line(pkg?.name)]
            .filter((part) => part !== '')
            .join(' '),
        ],
        ['Manifest', row.dependency?.manifest_path],
        [
          'Vulnerable versions',
          row.security_vulnerability?.vulnerable_version_range,
        ],
        [
          'Patched in',
          row.security_vulnerability?.first_patched_version?.identifier,
        ],
        ['Advisory', advisory?.ghsa_id],
        ['CVE', advisory?.cve_id],
      ],
      advisory?.description,
    );
    state = alertState(kind, row.state);
    updatedAt = sourceTime(row.updated_at);
  } else {
    const row = parse(secretScanningSchema, raw);
    const secret =
      line(row.secret_type_display_name) || line(row.secret_type) || 'Secret';
    const location = place(
      row.first_location_detected?.path,
      row.first_location_detected?.start_line,
    );
    number = row.number;
    html = row.html_url;
    title = [`${secret} exposed`, location]
      .filter((part) => part !== '')
      .join(' in ');
    description = describe([
      ['Secret type', secret],
      ['Validity', row.validity],
      ['First found in', location],
      ['Resolution', row.resolution],
    ]);
    state = alertState(kind, row.state, row.resolution);
    updatedAt = sourceTime(row.updated_at);
  }
  const { url, repository } = checkedUrl(html, kind, number);
  const shown = title.trim() || `${kind} alert ${number}`;
  const text = description.slice(0, 100000);
  return {
    externalSystem: 'github-security',
    externalId: `${repository}/${kind}#${number}`.toLowerCase(),
    externalUrl: url,
    title: shown,
    description: truncateImportedDescription(text),
    externalIssue: {
      id: `${repositoryId}/${kind}/${number}`,
      title: shown,
      description: text,
      url,
      state,
      repositoryId,
      number,
      syncedAt: 0,
      ...(updatedAt !== undefined && { updatedAt }),
    },
  };
}

/** The address of one lane's page. */
function laneUrl(fullName: string, lane: Lane, at: Position): string {
  const base = `https://api.github.com/repos/${fullName}/${lane.kind}/alerts?state=open&sort=created&direction=asc&per_page=100`;
  if (lane.kind === 'code-scanning') {
    return (
      `${base}&page=${at.page}` +
      (lane.tool !== undefined
        ? `&tool_name=${encodeURIComponent(lane.tool)}`
        : '') +
      (lane.severity !== undefined ? `&severity=${lane.severity}` : '')
    );
  }
  if (lane.kind === 'dependabot') {
    // Dependabot's listing pages by cursor alone.
    return (
      base +
      (lane.severities !== undefined
        ? `&severity=${encodeURIComponent(lane.severities)}`
        : '') +
      (at.upstream !== '' ? `&after=${encodeURIComponent(at.upstream)}` : '')
    );
  }
  return `${base}&page=${at.page}&hide_secret=true`;
}

/** The `after` cursor of a Link header's next page, or null without one. */
function nextAfter(link: string | undefined): string | null {
  const next = (link ?? '').split(',').find((part) => /rel="next"/.test(part));
  if (next === undefined) return null;
  const address = /<([^>]+)>/.exec(next)?.[1];
  const after =
    address === undefined ? null : new URL(address).searchParams.get('after');
  if (after === null || after === '')
    invalid('GitHub returned a next page without its cursor.');
  return parse(positionSchema.shape.upstream, after);
}

/** An alert as its lane's page answered it, with the lane it was read in. */
class LaneRow {
  readonly kind: SecurityAlertKind;
  constructor(
    readonly lane: Lane,
    readonly row: unknown,
  ) {
    this.kind = lane.kind;
  }
}

/** The level a code scanning rule's own severity reads as on the floor's
 * scale. */
const RULE_LEVEL: Record<string, SecuritySeverity> = {
  error: 'high',
  warning: 'medium',
  note: 'low',
};

const levelRow = z
  .object({
    rule: z
      .object({
        severity: z.string().nullable().optional(),
        security_severity_level: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    tool: z
      .object({ name: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    security_advisory: z
      .object({ severity: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    security_vulnerability: z
      .object({ severity: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

/** An alert's level on the floor's scale, or null when it names none Tale
 * knows. */
export function alertLevel(
  kind: SecurityAlertKind,
  raw: unknown,
): SecuritySeverity | null {
  if (kind === 'secret-scanning') return 'critical';
  const row = levelRow.safeParse(raw);
  if (!row.success) return null;
  const level =
    kind === 'code-scanning'
      ? (row.data.rule?.security_severity_level ??
        RULE_LEVEL[row.data.rule?.severity ?? ''])
      : (row.data.security_vulnerability?.severity ??
        row.data.security_advisory?.severity);
  return SECURITY_SEVERITIES.find((known) => known === level) ?? null;
}

/**
 * Whether an alert its lane's listing answered is one the source asks for:
 * GitHub narrows every listing itself, and the reader checks the tool and
 * the floor again, as a listing that ignored a filter would answer more.
 * An alert whose level Tale cannot read is kept.
 */
function wanted(
  lane: Lane,
  raw: unknown,
  floor: SecuritySeverity | undefined,
): boolean {
  if (lane.kind === 'code-scanning' && lane.tool !== undefined) {
    const row = levelRow.safeParse(raw);
    if (row.success && (row.data.tool?.name ?? lane.tool) !== lane.tool)
      return false;
  }
  if (floor === undefined) return true;
  const level = alertLevel(lane.kind, raw);
  return (
    level === null ||
    SECURITY_SEVERITIES.indexOf(level) >= SECURITY_SEVERITIES.indexOf(floor)
  );
}

function laneRow(item: unknown): LaneRow {
  if (!(item instanceof LaneRow))
    throw new Error('an alert page row lost its lane');
  return item;
}

function alertNumber(item: unknown): string {
  const { row } = laneRow(item);
  if (typeof row !== 'object' || row === null || !('number' in row))
    invalid('GitHub returned an alert without its number.');
  return String(row.number);
}

/** The kind and number a snapshot's id names, in its repository. */
function alertOf(
  id: string,
): { repositoryId: number; kind: SecurityAlertKind; number: number } | null {
  const ref = /^([1-9][0-9]*)\/([a-z-]+)\/([1-9][0-9]*)$/.exec(id);
  const kind = SECURITY_ALERT_KINDS.find((known) => known === ref?.[2]);
  if (!ref || kind === undefined) return null;
  return { repositoryId: Number(ref[1]), kind, number: Number(ref[3]) };
}

export function securityAlertNatives(): Readonly<
  Record<string, NativeConnectorImpl>
> {
  const readOne = async (
    ctx: NativeConnectorContext,
    input: z.infer<typeof getInput>,
    action: string,
  ): Promise<ImportedIssue> => {
    const syncedAt = Date.now();
    const source = input.issue.externalIssue;
    const alert = source === null ? null : alertOf(source.id);
    if (source === null || alert === null)
      invalid(
        'This task has no GitHub security alert snapshot to refresh. Sync it again from its repository.',
      );
    if (
      input.repositoryId !== undefined &&
      alert.repositoryId !== input.repositoryId
    )
      invalid('This alert belongs to a different repository.');
    const response = await get(
      ctx,
      'GitHub',
      `https://api.github.com/repos/${input.repository}/${alert.kind}/alerts/${alert.number}${alert.kind === 'secret-scanning' ? '?hide_secret=true' : ''}`,
    );
    if (response.status === 404 || response.status === 410)
      return unavailable('github-security', input.issue, syncedAt);
    const result = securityAlert(
      alert.kind,
      requireSuccess(response, 'GitHub', action),
      alert.repositoryId,
    );
    if (result.externalIssue.id !== source.id)
      invalid('GitHub returned a different alert identity.');
    result.externalIssue.syncedAt = syncedAt;
    return result;
  };

  return {
    'github.list_import_alerts': async (raw, ctx) => {
      const input = parse(listInput, raw);
      const action = 'github.list_import_alerts';
      const metadata = parse(
        z.object({
          id: z.number().int().positive().safe(),
          full_name: repositoryName,
        }),
        requireSuccess(
          await get(
            ctx,
            'GitHub',
            `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`,
          ),
          'GitHub',
          action,
        ),
      );
      const lanes = alertLanes(input);
      // A cursor belongs to the repository and to the lanes it walks: a
      // change of kinds, tools or floor starts the pass over.
      const scope = `${metadata.id}:security:${JSON.stringify(lanes)}`;
      const start = position(input.cursor, scope);
      const syncedAt = Date.now();
      const laneOf = (at: Position): Lane => {
        const lane = lanes[at.lane ?? 0];
        if (lane === undefined)
          invalid('The alert cursor names no listing of this source.');
        return lane;
      };
      const result = await discover({
        limit: input.limit,
        start,
        identity: alertNumber,
        nextLane: (current) => {
          const next = (current.lane ?? 0) + 1;
          return next < lanes.length ? laneStart(scope, next) : null;
        },
        normalize: (item) => {
          const { kind, lane, row } = laneRow(item);
          if (!wanted(lane, row, input.minSeverity)) return null;
          const alert = securityAlert(kind, row, metadata.id);
          alert.externalIssue.syncedAt = syncedAt;
          return alert;
        },
        fetch: async (at) => {
          const lane = laneOf(at);
          const response = await get(
            ctx,
            'GitHub',
            laneUrl(metadata.full_name, lane, at),
          );
          const data = rows(response, 'GitHub', action);
          const link = response.headers.link ?? response.headers.Link;
          if (lane.kind === 'dependabot') {
            const after = nextAfter(link);
            return {
              rows: data.map((row) => new LaneRow(lane, row)),
              next:
                after === null
                  ? null
                  : { ...at, page: at.page + 1, upstream: after, offset: 0 },
            };
          }
          const more = link ? /rel="next"/.test(link) : data.length === 100;
          return {
            rows: data.map((row) => new LaneRow(lane, row)),
            next: more ? { ...at, page: at.page + 1, offset: 0 } : null,
          };
        },
      });
      return {
        ...result,
        repositoryId: metadata.id,
        repository: metadata.full_name,
      };
    },
    'github.get_import_alert': async (raw, ctx) =>
      readOne(ctx, parse(getInput, raw), 'github.get_import_alert'),
    'github.refresh_import_alerts': async (raw, ctx) => {
      const input = parse(refreshInput, raw);
      return answerRefresh(
        'github-security',
        input.issues,
        input.report,
        (issue) =>
          readOne(
            ctx,
            {
              issue: parse(alertRef, issue),
              repository: input.repository,
              ...(input.repositoryId !== undefined && {
                repositoryId: input.repositoryId,
              }),
            },
            'github.refresh_import_alerts',
          ),
      );
    },
  };
}
