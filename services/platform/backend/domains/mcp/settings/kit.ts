/**
 * What every settings kind's handler shares: the refusal a handler throws,
 * a change's config read through its kind's schema without a field lost to
 * normalization, the identity of a resource, pages of a listing, and the
 * person a change is recorded under. A handler (`backend/domains/<domain>/
 * settings-resource.ts`) adds only its kind's native reads and writers.
 */

import type { SettingsKind } from '@tale/shared/schemas/settings-kinds';

import { isRecord } from '../../../../lib/utils/type-utils.ts';
import type { SettingsChange, SettingsContext } from './registry.ts';

/** One problem with a change, as a refusal lists it: where (a pointer into
 * the change), what kind of problem, and why — never the value sent. */
export interface SettingsIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/**
 * A refusal a settings handler throws: a stable code, its own sentence, a
 * hint naming what to do instead, and data. `refusalFromThrown` answers it
 * as the agent reads every refusal, with a 4xx status that marks it as one.
 */
export class SettingsRefusalError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;
  readonly hint?: string;
  readonly data?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: {
      readonly status?: 400 | 403 | 404 | 409;
      readonly hint?: string;
      readonly data?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = 'SettingsRefusalError';
    this.code = code;
    this.status = options.status ?? 400;
    if (options.hint !== undefined) this.hint = options.hint;
    if (options.data !== undefined) this.data = options.data;
  }
}

/** How many problems one refusal lists. */
const MAX_ISSUES = 20;

function escapeToken(token: string): string {
  return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** An RFC 6901 pointer into the change's config. */
function configPointer(path: readonly PropertyKey[]): string {
  return `/config${path.map((part) => `/${escapeToken(String(part))}`).join('')}`;
}

/** A parse's failure as a schema library reports it. */
interface ParseFailure {
  readonly issues: ReadonlyArray<{
    readonly path: readonly PropertyKey[];
    readonly code: string;
    readonly message: string;
  }>;
}

/** The problems of a failed parse, as issues of the change. */
function configIssues(error: ParseFailure): SettingsIssue[] {
  return error.issues.map((issue) => ({
    path: configPointer(issue.path),
    code: issue.code,
    message: issue.message,
  }));
}

/**
 * The members of what a change sent that its kind's parse dropped: a field
 * the setting does not have would otherwise vanish without a word, and the
 * change would read as made.
 */
export function droppedMembers(
  sent: unknown,
  parsed: unknown,
  at: readonly PropertyKey[] = [],
): SettingsIssue[] {
  if (Array.isArray(sent)) {
    if (!Array.isArray(parsed)) return [];
    return sent.flatMap((item, index) =>
      droppedMembers(item, parsed[index], [...at, index]),
    );
  }
  if (!isRecord(sent) || !isRecord(parsed)) return [];
  return Object.entries(sent).flatMap(([name, value]) =>
    Object.hasOwn(parsed, name)
      ? droppedMembers(value, parsed[name], [...at, name])
      : [
          {
            path: configPointer([...at, name]),
            code: 'unrecognized_key',
            message: 'is not a field of this setting',
          },
        ],
  );
}

/** The refusal of a change whose config its kind does not take. */
function invalidSettings(
  what: string,
  issues: readonly SettingsIssue[],
): SettingsRefusalError {
  const listed = issues.slice(0, MAX_ISSUES);
  const [first] = listed;
  const more =
    issues.length > 1 ? ` (and ${issues.length - 1} more problems)` : '';
  return new SettingsRefusalError(
    'SETTINGS_INVALID',
    `${what} is not valid${first === undefined ? '' : `: ${first.path} ${first.message}`}${more}`,
    {
      hint: 'fix every problem in data.issues and plan again; tale://docs/settings names the fields of each kind',
      data: { issues: listed },
    },
  );
}

/** A schema as a handler reads a change's config through it. */
interface ConfigSchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: ParseFailure };
}

/**
 * A change's config read through its kind's schema: what the native writer
 * would store, or a refusal naming every problem — a field the schema does
 * not have among them.
 */
export function parseSettingsConfig<T>(
  schema: ConfigSchema<T>,
  config: unknown,
  what: string,
): T {
  const parsed = schema.safeParse(config);
  const issues = parsed.success
    ? droppedMembers(config, parsed.data)
    : configIssues(parsed.error);
  if (!parsed.success || issues.length > 0) {
    throw invalidSettings(what, issues);
  }
  return parsed.data;
}

/** The identity of a kind with one resource: a change names none. */
export function identifySingle(
  kind: SettingsKind,
): (change: SettingsChange) => null {
  return (change) => {
    if (change.id !== undefined) {
      throw new SettingsRefusalError(
        'SETTINGS_ID_INVALID',
        `${kind} has a single resource, so a change names no id`,
        { hint: 'leave id out' },
      );
    }
    return null;
  };
}

/**
 * The id of a resource a change names — by `id`, by what its config
 * carries, or both when they agree.
 */
export function identityOf(
  kind: SettingsKind,
  named: string | undefined,
  carried: string | undefined,
  form: string,
): string {
  if (named !== undefined && carried !== undefined && named !== carried) {
    throw new SettingsRefusalError(
      'SETTINGS_ID_INVALID',
      `the id of this ${kind} change names another resource than its config does`,
      {
        hint: `the id is ${form}; send the id get_settings answered, with the config of that same resource`,
      },
    );
  }
  const id = named ?? carried;
  if (id === undefined) {
    throw new SettingsRefusalError(
      'SETTINGS_ID_REQUIRED',
      `a ${kind} change names the resource it changes`,
      { hint: `the id is ${form}; get_settings with kinds lists them` },
    );
  }
  return id;
}

/** A cursor this listing answered: the place its next page starts. */
const CURSOR = /^p([1-9]\d{0,6})$/;

/**
 * One page of a listing that reads everything it lists at once: `size`
 * resources from where the cursor says, and the cursor of the next page
 * when there is one.
 */
export function pageOf<T>(
  items: readonly T[],
  cursor: string | undefined,
  size: number,
): { items: T[]; nextCursor: string | null } {
  let offset = 0;
  if (cursor !== undefined) {
    const match = CURSOR.exec(cursor);
    if (match === null) {
      throw new SettingsRefusalError(
        'INVALID_CURSOR',
        'the cursor is not one this listing answered',
        {
          hint: 'pass the nextCursor get_settings answered for this kind, or none for its first page',
        },
      );
    }
    offset = Number(match[1]);
  }
  const end = offset + size;
  return {
    items: items.slice(offset, end),
    nextCursor: end < items.length ? `p${end}` : null,
  };
}

/** The person a change acts as and is recorded under. */
export interface SettingsActor {
  readonly organizationId: string;
  readonly userId: string;
  readonly email?: string;
  readonly role: string;
}

const EMAILS = new WeakMap<SettingsContext, Promise<string | undefined>>();

/** The caller's sign-in address, read once per call: the writers record it
 * on their audit rows, and the deployment's editors are listed by it. */
export function callerEmail(ctx: SettingsContext): Promise<string | undefined> {
  let email = EMAILS.get(ctx);
  if (email === undefined) {
    email = ctx.sql<{ email: string | null }[]>`
      SELECT "email" FROM "user" WHERE "id" = ${ctx.caller.userId} LIMIT 1
    `.then((rows) => rows[0]?.email ?? undefined);
    EMAILS.set(ctx, email);
  }
  return email;
}

/** The caller as the native writers take an actor. */
export async function settingsActor(
  ctx: SettingsContext,
): Promise<SettingsActor> {
  const email = await callerEmail(ctx);
  return {
    organizationId: ctx.caller.organizationId,
    userId: ctx.caller.userId,
    ...(email === undefined ? {} : { email }),
    role: ctx.caller.role,
  };
}
