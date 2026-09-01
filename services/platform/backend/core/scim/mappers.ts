/**
 * Pure SCIM mapping/parsing — no Convex imports, so it is fully unit-testable.
 *
 * Covers: internal record → SCIM wire resource, the `… eq "…"` filter subset,
 * inbound resource parsing (POST/PUT), and PATCH-op normalization for the
 * operation shapes Okta and Microsoft Entra actually emit. Arbitrary filter
 * path expressions beyond `members[value eq "…"]` are intentionally NOT
 * supported (documented in the SCIM handlers).
 */

import { isRecord } from '../../../lib/utils/type-utils';
import { normalizeAuthEmail } from '../lib/auth/normalize_auth_email';
import {
  SCIM_GROUP_SCHEMA,
  SCIM_USER_SCHEMA,
  type GroupPatch,
  type ScimGroupRecord,
  type ScimGroupResource,
  type ScimPatchOperation,
  type ScimUserRecord,
  type ScimUserResource,
  type UserPatch,
} from './types';

// ---------------------------------------------------------------------------
// Small value coercions
// ---------------------------------------------------------------------------

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** SCIM `active` arrives as a real boolean or a string ("True"/"false"). */
export function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Split a single display name into best-effort given/family parts. */
function splitName(name: string): { givenName?: string; familyName?: string } {
  const trimmed = name.trim();
  if (!trimmed) return {};
  const idx = trimmed.indexOf(' ');
  if (idx === -1) return { givenName: trimmed };
  return {
    givenName: trimmed.slice(0, idx),
    familyName: trimmed.slice(idx + 1).trim() || undefined,
  };
}

/** Combine SCIM name parts into the single name we store on the user row. */
export function combineName(
  givenName: string | undefined,
  familyName: string | undefined,
  displayName: string | undefined,
  fallback: string,
): string {
  const joined = [givenName, familyName].filter(Boolean).join(' ').trim();
  return joined || displayName || fallback;
}

/**
 * Pull an email string out of a SCIM `emails` value, which may be a string or
 * an array of `{ value, primary }`. Prefers the primary entry.
 */
function extractEmailValue(value: unknown): string | undefined {
  if (typeof value === 'string') return asString(value);
  if (!Array.isArray(value)) return undefined;
  const records = value.filter(isRecord);
  const primary = records.find((e) => e.primary === true);
  const chosen = primary ?? records[0];
  return chosen ? asString(chosen.value) : undefined;
}

/** Pull member ids out of a SCIM `members` value (array or single object). */
function extractMemberIds(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : value != null ? [value] : [];
  const ids: string[] = [];
  for (const entry of entries) {
    if (isRecord(entry)) {
      const id = asString(entry.value);
      if (id) ids.push(id);
    } else if (typeof entry === 'string') {
      const id = asString(entry);
      if (id) ids.push(id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Filters: `<attribute> eq "<value>"`
// ---------------------------------------------------------------------------

/**
 * Parse the single SCIM filter form IdPs use during sync: `attr eq "value"`.
 * Returns the value when the filter targets `attribute`, else null. Attribute
 * and operator are matched case-insensitively.
 */
export function parseEqFilter(
  filter: string | undefined | null,
  attribute: string,
): string | null {
  if (!filter) return null;
  const match = filter.trim().match(/^([\w.]+)\s+eq\s+"((?:[^"\\]|\\.)*)"$/i);
  if (!match) return null;
  if (match[1].toLowerCase() !== attribute.toLowerCase()) return null;
  return match[2].replace(/\\"/g, '"');
}

// ---------------------------------------------------------------------------
// Internal record → SCIM wire resource
// ---------------------------------------------------------------------------

export function toScimUser(
  record: ScimUserRecord,
  baseUrl?: string,
): ScimUserResource {
  const { givenName, familyName } = splitName(record.name);
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: record.userId,
    ...(record.externalId ? { externalId: record.externalId } : {}),
    userName: record.email,
    ...(record.name ? { displayName: record.name } : {}),
    name: {
      ...(givenName ? { givenName } : {}),
      ...(familyName ? { familyName } : {}),
      ...(record.name ? { formatted: record.name } : {}),
    },
    emails: record.email
      ? [{ value: record.email, primary: true, type: 'work' }]
      : [],
    active: record.active,
    meta: {
      resourceType: 'User',
      ...(record.createdAt ? { created: iso(record.createdAt) } : {}),
      ...(record.updatedAt ? { lastModified: iso(record.updatedAt) } : {}),
      ...(baseUrl ? { location: `${baseUrl}/Users/${record.userId}` } : {}),
    },
  };
}

export function toScimGroup(
  record: ScimGroupRecord,
  baseUrl?: string,
): ScimGroupResource {
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: record.teamId,
    ...(record.externalId ? { externalId: record.externalId } : {}),
    displayName: record.displayName,
    members: record.memberUserIds.map((value) => ({ value })),
    meta: {
      resourceType: 'Group',
      ...(record.createdAt ? { created: iso(record.createdAt) } : {}),
      ...(record.updatedAt ? { lastModified: iso(record.updatedAt) } : {}),
      ...(baseUrl ? { location: `${baseUrl}/Groups/${record.teamId}` } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Inbound resource parsing (POST / PUT bodies)
// ---------------------------------------------------------------------------

export interface ScimUserInput {
  email: string;
  displayName?: string;
  givenName?: string;
  familyName?: string;
  externalId?: string;
  active: boolean;
  /** Combined name we persist on the user row. */
  name: string;
}

export function parseUserResource(body: unknown): ScimUserInput | null {
  if (!isRecord(body)) return null;
  const userName = asString(body.userName);
  if (!userName) return null;
  const nameObj = isRecord(body.name) ? body.name : undefined;
  const givenName = nameObj ? asString(nameObj.givenName) : undefined;
  const familyName = nameObj ? asString(nameObj.familyName) : undefined;
  const displayName = asString(body.displayName);
  const externalId = asString(body.externalId);
  const active = 'active' in body ? coerceBoolean(body.active) : true;
  const email = normalizeAuthEmail(extractEmailValue(body.emails) ?? userName);
  return {
    email,
    displayName,
    givenName,
    familyName,
    externalId,
    active,
    name: combineName(givenName, familyName, displayName, email),
  };
}

export interface ScimGroupInput {
  displayName: string;
  externalId?: string;
  memberIds: string[];
}

export function parseGroupResource(body: unknown): ScimGroupInput | null {
  if (!isRecord(body)) return null;
  const displayName = asString(body.displayName);
  if (!displayName) return null;
  return {
    displayName,
    externalId: asString(body.externalId),
    memberIds: extractMemberIds(body.members),
  };
}

/**
 * Resolve the new display name from a user PATCH against the existing one.
 * Returns `undefined` when the patch carries no name change. A lone
 * `displayName` replaces wholesale; given/family patches merge with the
 * existing split so a partial name update doesn't drop the other half.
 */
export function resolvePatchedName(
  existingName: string,
  patch: { displayName?: string; givenName?: string; familyName?: string },
): string | undefined {
  const { displayName, givenName, familyName } = patch;
  if (
    displayName === undefined &&
    givenName === undefined &&
    familyName === undefined
  ) {
    return undefined;
  }
  if (
    displayName !== undefined &&
    givenName === undefined &&
    familyName === undefined
  ) {
    return displayName;
  }
  const existing = splitName(existingName);
  return combineName(
    givenName ?? existing.givenName,
    familyName ?? existing.familyName,
    displayName,
    existingName,
  );
}

// ---------------------------------------------------------------------------
// PATCH normalization
// ---------------------------------------------------------------------------

function patchOperations(body: unknown): ScimPatchOperation[] {
  if (!isRecord(body) || !Array.isArray(body.Operations)) return [];
  return body.Operations.filter(isRecord).map((op) => ({
    op: typeof op.op === 'string' ? op.op : '',
    path: typeof op.path === 'string' ? op.path : undefined,
    value: op.value,
  }));
}

export function parseUserPatch(body: unknown): UserPatch {
  const patch: UserPatch = {};
  for (const { path, value } of patchOperations(body)) {
    if (path) {
      const p = path.toLowerCase();
      if (p === 'active') patch.active = coerceBoolean(value);
      else if (p === 'displayname') patch.displayName = asString(value);
      else if (p === 'name.givenname') patch.givenName = asString(value);
      else if (p === 'name.familyname') patch.familyName = asString(value);
      else if (p === 'username') patch.email = asString(value);
      else if (p.startsWith('emails')) {
        const email = extractEmailValue(value);
        if (email) patch.email = email;
      }
      continue;
    }
    // Path-less op: `value` is a partial User resource.
    if (!isRecord(value)) continue;
    if ('active' in value) patch.active = coerceBoolean(value.active);
    const displayName = asString(value.displayName);
    if (displayName) patch.displayName = displayName;
    if (isRecord(value.name)) {
      const given = asString(value.name.givenName);
      const family = asString(value.name.familyName);
      if (given) patch.givenName = given;
      if (family) patch.familyName = family;
    }
    const email = extractEmailValue(value.emails);
    if (email) patch.email = email;
  }
  return patch;
}

/** Extract the id from a `members[value eq "<id>"]` path expression. */
function parseMemberPathFilter(path: string): string | null {
  const match = path.match(/members\[\s*value\s+eq\s+"([^"]+)"\s*\]/i);
  return match ? match[1] : null;
}

export function parseGroupPatch(body: unknown): GroupPatch {
  const patch: GroupPatch = { addMembers: [], removeMembers: [] };
  for (const { op, path, value } of patchOperations(body)) {
    const verb = op.toLowerCase();
    if (path) {
      const lower = path.toLowerCase();
      if (lower === 'displayname') {
        const displayName = asString(value);
        if (displayName) patch.displayName = displayName;
      } else if (lower === 'members') {
        const ids = extractMemberIds(value);
        if (verb === 'add') patch.addMembers.push(...ids);
        else if (verb === 'replace') patch.replaceMembers = ids;
        else if (verb === 'remove') {
          // `remove` on `members` with no value clears the whole set.
          if (ids.length) patch.removeMembers.push(...ids);
          else patch.replaceMembers = [];
        }
      } else if (lower.startsWith('members[')) {
        const id = parseMemberPathFilter(path);
        if (id) {
          if (verb === 'remove') patch.removeMembers.push(id);
          else patch.addMembers.push(id);
        }
      }
      continue;
    }
    // Path-less op: `value` is a partial Group resource.
    if (!isRecord(value)) continue;
    const displayName = asString(value.displayName);
    if (displayName) patch.displayName = displayName;
    const ids = extractMemberIds(value.members);
    if (ids.length) {
      if (verb === 'add') patch.addMembers.push(...ids);
      else if (verb === 'replace') patch.replaceMembers = ids;
      else if (verb === 'remove') patch.removeMembers.push(...ids);
    }
  }
  return patch;
}
