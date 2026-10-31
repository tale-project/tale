/**
 * What every settings kind's handler shares: the refusal a handler throws,
 * a change's config read through its kind's schema without a field lost to
 * normalization, the identity of a resource, pages of a listing, and the
 * person a change is recorded under. A handler (`backend/domains/<domain>/
 * settings-resource.ts`) adds only its kind's native reads and writers.
 */

import type { SettingsKind } from '@tale/shared/schemas/settings-kinds';

import { unstorableTexts } from '../../../../lib/shared/utils/storable-text.ts';
import { isRecord } from '../../../../lib/utils/type-utils.ts';
import {
  mintCursorFor,
  verifyCursorFor,
} from '../../../core/lib/signed_cursor.ts';
import {
  formatKeysetCursor,
  parseKeysetCursor,
} from '../../../lib/keyset-cursor.ts';
import type {
  SettingsChange,
  SettingsContext,
  SettingsResource,
} from './registry.ts';

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

/** Where in a change a value sits: its config, or the arguments of its act. */
type ChangePart = '/config' | '/args';

/** An RFC 6901 pointer into the change's config or act arguments. */
function changePointer(part: ChangePart, path: readonly PropertyKey[]): string {
  return `${part}${path.map((token) => `/${escapeToken(String(token))}`).join('')}`;
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
function parseIssues(part: ChangePart, error: ParseFailure): SettingsIssue[] {
  return error.issues.map((issue) => ({
    path: changePointer(part, issue.path),
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
  part: ChangePart = '/config',
): SettingsIssue[] {
  if (Array.isArray(sent)) {
    if (!Array.isArray(parsed)) return [];
    return sent.flatMap((item, index) =>
      droppedMembers(item, parsed[index], [...at, index], part),
    );
  }
  if (!isRecord(sent) || !isRecord(parsed)) return [];
  return Object.entries(sent).flatMap(([name, value]) =>
    Object.hasOwn(parsed, name)
      ? droppedMembers(value, parsed[name], [...at, name], part)
      : [
          {
            path: changePointer(part, [...at, name]),
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

/**
 * The refusal of a change whose config or arguments carry text Postgres
 * could not store — a NUL character, or half a surrogate pair — naming
 * every field it sits in; null when it carries none. Such a text fails the
 * write it rides in, or reaches the store silently altered, so a change is
 * refused before anything reads or writes it.
 */
export function unstorableTextRefusal(
  change: SettingsChange,
): SettingsRefusalError | null {
  const issues = [
    ...unstorableTexts(change.config).map(({ pointer, problem }) => ({
      path: `/config${pointer}`,
      code: 'unstorable_text',
      message: problem,
    })),
    ...unstorableTexts(change.args).map(({ pointer, problem }) => ({
      path: `/args${pointer}`,
      code: 'unstorable_text',
      message: problem,
    })),
  ];
  return issues.length === 0
    ? null
    : invalidSettings(`the ${change.kind} change`, issues);
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
  return parseChangePart('/config', schema, config, what);
}

/**
 * What an act takes, read through its schema as a config is: what the
 * writer would receive, or a refusal naming every problem — an argument the
 * act does not take among them — by its pointer into `/args`.
 */
export function parseSettingsArgs<T>(
  schema: ConfigSchema<T>,
  args: unknown,
  what: string,
): T {
  return parseChangePart('/args', schema, args, what);
}

function parseChangePart<T>(
  part: ChangePart,
  schema: ConfigSchema<T>,
  value: unknown,
  what: string,
): T {
  const parsed = schema.safeParse(value);
  const issues = parsed.success
    ? droppedMembers(value, parsed.data, [], part)
    : parseIssues(part, parsed.error);
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

/** The refusal of a cursor the listing did not answer. */
function invalidCursor(): SettingsRefusalError {
  return new SettingsRefusalError(
    'INVALID_CURSOR',
    'the cursor is not one this listing answered',
    {
      hint: 'pass the nextCursor get_settings answered for this kind, or none for its first page',
    },
  );
}

/** Where the page a cursor names starts; the first page when there is none. */
function offsetOf(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const match = CURSOR.exec(cursor);
  if (match === null) throw invalidCursor();
  return Number(match[1]);
}

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
  const offset = offsetOf(cursor);
  const end = offset + size;
  return {
    items: items.slice(offset, end),
    nextCursor: end < items.length ? `p${end}` : null,
  };
}

/** The most the configurations of one page may take, as JSON text. A page
 * of free text (instructions run to 20,000 characters each) stays under the
 * 250,000 characters `get_settings` advertises for its answer, whatever
 * `size` says. */
export const PAGE_CONFIG_CHARS = 200_000;

/**
 * One page of a listing whose resources are read one at a time: from where
 * the cursor says, up to `size` of them, cut once the configurations read so
 * far take {@link PAGE_CONFIG_CHARS} — the resource that crosses the line is
 * the last of its page, and a page always holds one — with the cursor of the
 * next page when ones remain. Reads only the resources it answers.
 */
export async function pageOfRead<T>(
  ids: readonly T[],
  cursor: string | undefined,
  size: number,
  read: (id: T) => Promise<SettingsResource>,
): Promise<{ items: SettingsResource[]; nextCursor: string | null }> {
  const items: SettingsResource[] = [];
  let next = offsetOf(cursor);
  let chars = 0;
  while (next < ids.length && items.length < size) {
    const id = ids[next];
    if (id === undefined) break;
    const item = await read(id);
    items.push(item);
    next += 1;
    chars += (JSON.stringify(item.config) ?? '').length;
    if (chars >= PAGE_CONFIG_CHARS) break;
  }
  return { items, nextCursor: next < ids.length ? `p${next}` : null };
}

/** Where a row stands in a listing keyed on `(<ts> DESC, id DESC)`. */
export interface KeysetPosition {
  readonly at: number;
  readonly id: string;
}

/**
 * One page of a listing its store pages on a keyset, so a page reads only
 * the rows it answers: `read` answers up to `limit` rows after `after` (the
 * first page for null) and whether more follow. The page is cut as
 * {@link pageOfRead} cuts it, by `size` and by
 * {@link PAGE_CONFIG_CHARS}, and its cursor is the position of the last
 * resource it holds, signed for this kind and organization, so a cursor
 * another listing answered, or one made up, is refused.
 */
export async function pageOfKeyset<T>(
  ctx: SettingsContext,
  kind: SettingsKind,
  cursor: string | undefined,
  size: number,
  read: (
    after: KeysetPosition | null,
    limit: number,
  ) => Promise<{ rows: readonly T[]; hasMore: boolean }>,
  resourceOf: (row: T) => SettingsResource,
  positionOf: (row: T) => KeysetPosition,
): Promise<{ items: SettingsResource[]; nextCursor: string | null }> {
  const listing = `mcp-settings:${kind}`;
  const organizationId = ctx.caller.organizationId;
  let after: KeysetPosition | null = null;
  if (cursor !== undefined) {
    after = parseKeysetCursor(verifyCursorFor(organizationId, listing, cursor));
    if (after === null) throw invalidCursor();
  }
  const { rows, hasMore } = await read(after, size);
  const items: SettingsResource[] = [];
  let last: T | undefined;
  let chars = 0;
  for (const row of rows) {
    if (items.length >= size) break;
    const item = resourceOf(row);
    items.push(item);
    last = row;
    chars += (JSON.stringify(item.config) ?? '').length;
    if (chars >= PAGE_CONFIG_CHARS) break;
  }
  const more = hasMore || items.length < rows.length;
  if (!more || last === undefined) return { items, nextCursor: null };
  const position = positionOf(last);
  return {
    items,
    nextCursor: mintCursorFor(
      organizationId,
      listing,
      formatKeysetCursor(position.at, position.id),
    ),
  };
}

/** The person a change acts as and is recorded under. */
export interface SettingsActor {
  readonly organizationId: string;
  readonly userId: string;
  readonly email?: string;
  readonly role: string;
}

const EMAILS = new WeakMap<
  SettingsContext['caller'],
  Promise<string | undefined>
>();

/** The caller's sign-in address, read once per request — every change a
 * call plans shares it: the writers record it on their audit rows, and the
 * deployment's editors are listed by it. */
export function callerEmail(ctx: SettingsContext): Promise<string | undefined> {
  let email = EMAILS.get(ctx.caller);
  if (email === undefined) {
    email = ctx.sql<{ email: string | null }[]>`
      SELECT "email" FROM "user" WHERE "id" = ${ctx.caller.userId} LIMIT 1
    `.then((rows) => rows[0]?.email ?? undefined);
    EMAILS.set(ctx.caller, email);
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
