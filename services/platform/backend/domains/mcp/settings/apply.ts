/**
 * Applying settings changes over MCP: compare-and-set on every one, all of
 * it checked before the first write, then each change through its kind's
 * native writer, in its kind's order.
 *
 * Every change names the hash it expects (`expected`, keyed by the
 * resource's address; null for one it creates). Before anything is
 * written, every change is planned again against a fresh read: a refusal,
 * or a resource whose hash is no longer the expected one, applies nothing.
 * Then the changes run in their kinds' order, so what a resource refers to
 * exists first; each writer re-checks its hash under its own lock. A
 * failure stops there: the answer says what landed, what failed and what
 * was skipped. No writer can undo another's change, so nothing that landed
 * is rolled back — the same as a declaration the CLI applies.
 */

import { reportError } from '../../../error-reporting.ts';
import { currentRequestChannel } from '../../../lib/request-channel.ts';
import { type McpRefusal, refusalFromThrown } from '../refusals.ts';
import {
  addressOf,
  type PreparedChange,
  prepareChanges,
  type SettingsAction,
} from './plan.ts';
import type {
  SettingsChange,
  SettingsContext,
  SettingsRegistry,
} from './registry.ts';

/** One change that landed — or that already was so (`unchanged`). */
interface AppliedChange {
  readonly kind: string;
  readonly id: string | null;
  readonly key: string;
  readonly action: SettingsAction;
  /** The resource's hash now; null once it is removed. */
  readonly hash: string | null;
}

/** One change that never ran. */
interface SkippedChange {
  readonly kind: string;
  readonly id: string | null;
  readonly key: string;
}

/** The code every configuration writer raises, under its lock, when the
 * hash a change expects is no longer the stored one (`assertExpectedHash`). */
const WRITER_STALE = 'CONFIG_VERSION_CONFLICT';

/** One problem with `expected`, as an argument refusal lists it. */
interface ExpectedIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

function invalidExpected(
  issues: readonly ExpectedIssue[],
): Record<string, unknown> {
  const sorted = [...issues].sort((a, b) =>
    a.path === b.path ? 0 : a.path < b.path ? -1 : 1,
  );
  const [first] = sorted;
  const more = sorted.length > 1 ? ` (and ${sorted.length - 1} more)` : '';
  return {
    error: `invalid arguments for apply_settings: "${first?.path ?? 'expected'}" ${first?.message ?? 'does not match the changes'}${more}`,
    code: 'INVALID_ARGUMENTS',
    hint: 'expected names every changed resource by its key, with the hash get_settings or plan_settings answered (null for one you create), and nothing else',
    data: { issues: sorted },
  };
}

/** The refusal of a change whose resource moved since it was read. */
function stale(key: string, currentHash: string | null): McpRefusal {
  return {
    error: `${key} changed since it was read: its hash is no longer the one expected`,
    code: 'SETTINGS_STALE',
    hint: 'read it again with get_settings, plan the change against what is stored now, and apply with that hash',
    data: { currentHash },
  };
}

function entryOf(prepared: PreparedChange): SkippedChange {
  const { kind, id, key } = prepared.planned;
  return { kind, id, key };
}

/** The answer of an apply that stopped at `at`. */
function stopped(
  refusal: McpRefusal,
  at: PreparedChange,
  applied: readonly AppliedChange[],
  skipped: readonly PreparedChange[],
): Record<string, unknown> {
  const currentHash = refusal.data?.currentHash;
  return {
    error: refusal.error,
    code: refusal.code,
    ...(refusal.hint === undefined ? {} : { hint: refusal.hint }),
    ...(refusal.data === undefined ? {} : { data: refusal.data }),
    applied,
    failed: {
      ...entryOf(at),
      code: refusal.code,
      error: refusal.error,
      ...(refusal.hint === undefined ? {} : { hint: refusal.hint }),
      ...(currentHash === undefined ? {} : { currentHash }),
    },
    skipped: skipped.map(entryOf),
  };
}

/** What an agent hears of a writer that failed unexpectedly: that it did,
 * and the request id to quote — nothing of the error itself. */
function fault(ctx: SettingsContext, at: PreparedChange): McpRefusal {
  const requestId =
    currentRequestChannel()?.requestId ?? ctx.caller.requestId ?? null;
  return {
    error: `changing ${at.planned.key} failed unexpectedly`,
    code: 'INTERNAL_ERROR',
    hint: 'read what landed with get_settings before trying again; if it keeps failing, give data.requestId to whoever runs this Tale',
    data: { requestId },
  };
}

/** The hash stored now, or null when it cannot be read. */
async function hashNow(
  ctx: SettingsContext,
  prepared: PreparedChange,
): Promise<string | null> {
  if (prepared.ready === undefined) return null;
  try {
    const current = await prepared.ready.handler.read(ctx, prepared.planned.id);
    return current?.hash ?? null;
  } catch (error) {
    console.warn(
      `[mcp] settings: could not read ${prepared.planned.key} after a stale write:`,
      error,
    );
    return null;
  }
}

/** What `apply_settings` answers. */
export async function applySettings(
  ctx: SettingsContext,
  registry: SettingsRegistry,
  changes: readonly SettingsChange[],
  expected: Readonly<Record<string, string | null>>,
): Promise<Record<string, unknown>> {
  // The arguments first: every change's resource has an expected hash, and
  // nothing else does. Nothing is read until they agree.
  const keys = changes.map((change) => addressOf(registry, change).key);
  const issues: ExpectedIssue[] = [];
  for (const [index, key] of keys.entries()) {
    if (!Object.hasOwn(expected, key)) {
      issues.push({
        path: `expected.${key}`,
        code: 'missing',
        message: `names no hash for changes.${index}: the one get_settings answered, or null for a resource you create`,
      });
    }
  }
  const named = new Set(keys);
  for (const key of Object.keys(expected)) {
    if (!named.has(key)) {
      issues.push({
        path: `expected.${key}`,
        code: 'unrecognized_key',
        message: 'names a resource no change in this call changes',
      });
    }
  }
  if (issues.length > 0) return invalidExpected(issues);

  // Then every change against a fresh read, before any write.
  const prepared = await prepareChanges(ctx, registry, changes);
  for (const entry of prepared) {
    const { refusal } = entry.planned;
    if (refusal !== undefined) {
      return stopped(
        refusal,
        entry,
        [],
        prepared.filter((other) => other !== entry),
      );
    }
  }
  for (const entry of prepared) {
    const currentHash = entry.planned.currentHash ?? null;
    if (expected[entry.planned.key] !== currentHash) {
      return stopped(
        stale(entry.planned.key, currentHash),
        entry,
        [],
        prepared.filter((other) => other !== entry),
      );
    }
  }

  // Then each through its writer, in its kind's order.
  const ordered = [...prepared].sort(
    (a, b) => a.order - b.order || a.index - b.index,
  );
  const applied: AppliedChange[] = [];
  for (const [position, entry] of ordered.entries()) {
    const { planned, ready } = entry;
    if (ready === undefined || planned.action === undefined) continue;
    if (planned.action === 'unchanged') {
      applied.push({
        ...entryOf(entry),
        action: 'unchanged',
        hash: planned.currentHash ?? null,
      });
      continue;
    }
    try {
      const { hash } = await ready.handler.apply(
        ctx,
        ready.change,
        expected[planned.key] ?? null,
      );
      applied.push({ ...entryOf(entry), action: planned.action, hash });
    } catch (error) {
      const rest = ordered.slice(position + 1);
      const refusal = refusalFromThrown(error);
      if (refusal === null) {
        console.error(
          `[mcp] settings: writing ${planned.key} failed unexpectedly:`,
          error,
        );
        reportError(error, { tags: { 'mcp.settings.kind': planned.kind } });
        return stopped(fault(ctx, entry), entry, applied, rest);
      }
      if (refusal.code === WRITER_STALE) {
        return stopped(
          stale(planned.key, await hashNow(ctx, entry)),
          entry,
          applied,
          rest,
        );
      }
      return stopped(refusal, entry, applied, rest);
    }
  }
  return { applied, skipped: [] };
}
