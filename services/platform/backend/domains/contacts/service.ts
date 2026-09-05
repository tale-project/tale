import type { Sql, TransactionSql } from 'postgres';

import { authorizeRls } from '../../auth/access.ts';
import { toJson } from '../../db/sql.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { emitEvent } from '../events/emit.ts';
import { assertNotHeld } from '../legal_holds/service.ts';

/**
 * Contacts — the per-org correspondent directory (0.4's unified
 * customers+vendors table). Role gate = the `contacts` row of the 0.4 access
 * matrix (members read, editors+ write). Bulk import lanes land with the
 * REST/connector surfaces.
 */

export const CONTACT_SOURCES = [
  'manual_import',
  'file_upload',
  'api_import',
  'conversation',
  'shopify',
  'woocommerce',
  'magento',
  'bigcommerce',
  'prestashop',
  'chargebee',
  'stripe',
  'recurly',
  'salesforce',
  'hubspot',
  'pipedrive',
  'zoho',
  'sap',
  'oracle',
  'netsuite',
  'mailchimp',
  'klaviyo',
  'sendgrid',
  'webhook',
  'zapier',
  'custom',
] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export class ContactError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'ContactError';
    this.code = code;
    this.status = status;
  }
}

export interface ContactScope {
  organizationId: string;
  userId: string;
  email?: string;
  role: string;
}

function assertContactAccess(
  scope: ContactScope,
  action: 'read' | 'write',
): void {
  if (!authorizeRls(scope.role, 'contacts', action)) {
    throw new ContactError('RBAC_FORBIDDEN', 'Insufficient role', 403);
  }
}

export interface ContactRow {
  id: string;
  organizationId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  externalId: string | null;
  source: string;
  locale: string | null;
  address: Record<string, unknown> | null;
  tags: string[];
  metadata: Record<string, unknown> | null;
  notes: string | null;
  lifecycleStatus: string | null;
  createdAt: number;
  updatedAt: number;
}

const CONTACT_COLUMNS = `
  id, org_id AS "organizationId", name, email, phone,
  external_id AS "externalId", source, locale, address, tags, metadata,
  notes, lifecycle_status AS "lifecycleStatus",
  created_at_ms::float8 AS "createdAt", updated_at_ms::float8 AS "updatedAt"
`;

export interface ContactInput {
  name?: string;
  email?: string;
  phone?: string;
  externalId?: string;
  source: ContactSource;
  locale?: string;
  address?: Record<string, unknown>;
  tags?: string[];
  metadata?: Record<string, unknown>;
  notes?: string;
}

/**
 * The per-(org, email) writer mutex every contact create holds. The
 * directory's email uniqueness is an application rule — `contacts_org_email`
 * is a plain index, and live deployments may already carry twins from the
 * time no door checked — so the three write paths (single create, bulk
 * import, the mail-ingest find-or-create) all serialize here before they
 * look. Two overlapping writers of one email thus see each other's commit:
 * the second finds the row and refuses (or, for find-or-create, adopts it).
 * The lock lives for the caller's transaction, across every api replica.
 */
async function lockContactEmail(
  tx: TransactionSql,
  organizationId: string,
  email: string,
): Promise<void> {
  await tx`
    SELECT pg_advisory_xact_lock(
      hashtextextended('contact:' || ${organizationId} || ':' || ${email}, 0)
    )
  `;
}

/** The (org, external id) twin of `lockContactEmail` for the import lane's
 * second duplicate key. Always taken AFTER the email lock, so two importers
 * never hold the pair in opposite order. */
async function lockContactExternalId(
  tx: TransactionSql,
  organizationId: string,
  externalId: string,
): Promise<void> {
  await tx`
    SELECT pg_advisory_xact_lock(
      hashtextextended('contact-ext:' || ${organizationId} || ':' || ${externalId}, 0)
    )
  `;
}

/**
 * The LIVE row an email resolves to — a trashed contact is out of the
 * directory (listing, count and palette all hide it), so it neither blocks
 * a re-create nor gets a new conversation attached to it. Oldest wins, so
 * pre-lock twins answer the same id on every lookup.
 */
async function findLiveContactIdByEmail(
  tx: TransactionSql,
  organizationId: string,
  email: string,
): Promise<string | null> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM app.contacts
    WHERE org_id = ${organizationId} AND email = ${email}
      AND lifecycle_status IS DISTINCT FROM 'trashed'
    ORDER BY created_at_ms ASC, id ASC
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

async function findLiveContactIdByExternalId(
  tx: TransactionSql,
  organizationId: string,
  externalId: string,
): Promise<string | null> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM app.contacts
    WHERE org_id = ${organizationId} AND external_id = ${externalId}
      AND lifecycle_status IS DISTINCT FROM 'trashed'
    ORDER BY created_at_ms ASC, id ASC
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

interface ContactInsertRow {
  organizationId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  externalId: string | null;
  source: ContactSource;
  locale: string | null;
  address: Record<string, unknown> | null;
  tags: string[];
  metadata: Record<string, unknown> | null;
  notes: string | null;
}

/** THE contact insert — every create door lands its row through here. */
async function insertContactRow(
  tx: TransactionSql,
  row: ContactInsertRow,
): Promise<string> {
  const now = Date.now();
  const rows = await tx<{ id: string }[]>`
    INSERT INTO app.contacts (
      org_id, name, email, phone, external_id, source, locale, address,
      tags, metadata, notes, created_at_ms, updated_at_ms
    ) VALUES (
      ${row.organizationId}, ${row.name}, ${row.email}, ${row.phone},
      ${row.externalId}, ${row.source}, ${row.locale},
      ${row.address === null ? null : tx.json(toJson(row.address))},
      ${row.tags},
      ${row.metadata === null ? null : tx.json(toJson(row.metadata))},
      ${row.notes}, ${now}, ${now}
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) {
    throw new ContactError('CONTACT_CREATE_FAILED', 'Insert failed');
  }
  return id;
}

/** The audit row, the automation event and the realtime hint one created
 * contact owes — the same three whether a member typed it or the mail
 * ingest minted it. */
async function recordContactCreated(
  tx: TransactionSql,
  args: {
    organizationId: string;
    contactId: string;
    name?: string | undefined;
    actor:
      | { type: 'user'; id: string; email?: string | undefined }
      | { type: 'system' };
  },
): Promise<void> {
  await createAuditLog(tx, {
    organizationId: args.organizationId,
    actorId: args.actor.type === 'user' ? args.actor.id : 'system',
    ...(args.actor.type === 'user' && args.actor.email !== undefined
      ? { actorEmail: args.actor.email }
      : {}),
    actorType: args.actor.type,
    action: 'contact.created',
    category: 'data',
    resourceType: 'contact',
    resourceId: args.contactId,
    ...(args.name !== undefined ? { resourceName: args.name } : {}),
    status: 'success',
  });
  await emitEvent(tx, {
    organizationId: args.organizationId,
    eventType: 'contact.created',
    eventData: { contactId: args.contactId },
  });
  await emitHintInTx(tx, {
    orgId: args.organizationId,
    entity: 'contact',
    entityId: args.contactId,
  });
}

function normalizeContactEmail(email: string | undefined): string | undefined {
  const normalized = email?.trim().toLowerCase();
  return normalized === undefined || normalized === '' ? undefined : normalized;
}

/**
 * Member create. An email that already names a LIVE contact of the org is
 * refused with 409 `CONTACT_DUPLICATE_EMAIL` — the code the create dialog
 * maps and the status the REST reference has promised for a duplicate email
 * since the door opened; the door itself never checked.
 */
export async function createContact(
  tx: TransactionSql,
  scope: ContactScope,
  input: ContactInput,
): Promise<string> {
  assertContactAccess(scope, 'write');
  const email = normalizeContactEmail(input.email);
  if (email !== undefined) {
    await lockContactEmail(tx, scope.organizationId, email);
    if (
      (await findLiveContactIdByEmail(tx, scope.organizationId, email)) !== null
    ) {
      throw new ContactError(
        'CONTACT_DUPLICATE_EMAIL',
        `Contact with email ${email} already exists`,
        409,
      );
    }
  }
  const id = await insertContactRow(tx, {
    organizationId: scope.organizationId,
    name: input.name?.trim() ?? null,
    email: email ?? null,
    phone: input.phone ?? null,
    externalId: input.externalId ?? null,
    source: input.source,
    locale: input.locale ?? null,
    address: input.address ?? null,
    tags: input.tags ?? [],
    metadata: input.metadata ?? null,
    notes: input.notes ?? null,
  });
  await recordContactCreated(tx, {
    organizationId: scope.organizationId,
    contactId: id,
    name: input.name,
    actor: { type: 'user', id: scope.userId, email: scope.email },
  });
  return id;
}

/**
 * Find by normalized email or create — the mail-ingest lane (a conversation's
 * correspondent), which has no member behind it: the audit row is the
 * system's. Serialized per (org, email) like every other create, and blind
 * to trashed rows like the directory itself: a mail from a contact the org
 * trashed mints a fresh live contact rather than re-attaching to the trash.
 */
export async function findOrCreateContactByEmail(
  tx: TransactionSql,
  args: {
    organizationId: string;
    email: string;
    name?: string | undefined;
    source: ContactSource;
    metadata?: Record<string, unknown> | undefined;
  },
): Promise<{ contactId: string; created: boolean }> {
  const email = normalizeContactEmail(args.email);
  if (email === undefined) {
    throw new ContactError(
      'CONTACT_EMAIL_REQUIRED',
      'find-or-create needs an email',
    );
  }
  await lockContactEmail(tx, args.organizationId, email);
  const existing = await findLiveContactIdByEmail(
    tx,
    args.organizationId,
    email,
  );
  if (existing !== null) {
    return { contactId: existing, created: false };
  }
  const contactId = await insertContactRow(tx, {
    organizationId: args.organizationId,
    name: args.name?.trim() ?? null,
    email,
    phone: null,
    externalId: null,
    source: args.source,
    locale: null,
    address: null,
    tags: [],
    metadata: args.metadata ?? null,
    notes: null,
  });
  await recordContactCreated(tx, {
    organizationId: args.organizationId,
    contactId,
    name: args.name,
    actor: { type: 'system' },
  });
  return { contactId, created: true };
}

export async function updateContact(
  tx: TransactionSql,
  scope: ContactScope,
  contactId: string,
  patch: Partial<ContactInput>,
): Promise<void> {
  assertContactAccess(scope, 'write');
  const rows = await tx<ContactRow[]>`
    SELECT ${tx.unsafe(CONTACT_COLUMNS)} FROM app.contacts
    WHERE id = ${contactId} AND org_id = ${scope.organizationId} LIMIT 1
  `;
  const contact = rows[0];
  if (!contact) {
    throw new ContactError('CONTACT_NOT_FOUND', 'Contact not found', 404);
  }
  const email =
    patch.email === undefined
      ? contact.email
      : patch.email.trim().toLowerCase();
  await tx`
    UPDATE app.contacts SET
      name = ${patch.name === undefined ? contact.name : (patch.name.trim() ?? null)},
      email = ${email},
      phone = ${patch.phone === undefined ? contact.phone : patch.phone},
      locale = ${patch.locale === undefined ? contact.locale : patch.locale},
      address = ${patch.address === undefined ? (contact.address === null ? null : tx.json(toJson(contact.address))) : tx.json(toJson(patch.address))},
      tags = ${patch.tags ?? contact.tags},
      metadata = ${patch.metadata === undefined ? (contact.metadata === null ? null : tx.json(toJson(contact.metadata))) : tx.json(toJson(patch.metadata))},
      notes = ${patch.notes === undefined ? contact.notes : patch.notes},
      updated_at_ms = ${Date.now()}
    WHERE id = ${contactId}
  `;
  await createAuditLog(tx, {
    organizationId: scope.organizationId,
    actorId: scope.userId,
    ...(scope.email !== undefined ? { actorEmail: scope.email } : {}),
    actorType: 'user',
    action: 'contact.updated',
    category: 'data',
    resourceType: 'contact',
    resourceId: contactId,
    status: 'success',
  });
  await emitEvent(tx, {
    organizationId: scope.organizationId,
    eventType: 'contact.updated',
    eventData: { contactId },
  });
  await emitHintInTx(tx, {
    orgId: scope.organizationId,
    entity: 'contact',
    entityId: contactId,
  });
}

/** Soft trash (governance owns hard erase). */
export async function deleteContact(
  tx: TransactionSql,
  scope: ContactScope,
  contactId: string,
): Promise<void> {
  assertContactAccess(scope, 'write');
  // Contacts carry no per-row hold; this blocks on the org-level 'nuclear
  // halt' only (the 0.4 posture).
  await assertNotHeld(tx, scope.organizationId, 'contact', contactId);
  const updated = await tx`
    UPDATE app.contacts SET
      lifecycle_status = 'trashed', status_changed_at_ms = ${Date.now()},
      updated_at_ms = ${Date.now()}
    WHERE id = ${contactId} AND org_id = ${scope.organizationId}
  `;
  if (updated.count === 0) {
    throw new ContactError('CONTACT_NOT_FOUND', 'Contact not found', 404);
  }
  await createAuditLog(tx, {
    organizationId: scope.organizationId,
    actorId: scope.userId,
    ...(scope.email !== undefined ? { actorEmail: scope.email } : {}),
    actorType: 'user',
    action: 'contact.deleted',
    category: 'data',
    resourceType: 'contact',
    resourceId: contactId,
    status: 'success',
  });
  await emitEvent(tx, {
    organizationId: scope.organizationId,
    eventType: 'contact.deleted',
    eventData: { contactId },
  });
  await emitHintInTx(tx, {
    orgId: scope.organizationId,
    entity: 'contact',
    entityId: contactId,
  });
}

export async function getContact(
  sql: Sql,
  scope: ContactScope,
  contactId: string,
): Promise<ContactRow> {
  assertContactAccess(scope, 'read');
  const rows = await sql<ContactRow[]>`
    SELECT ${sql.unsafe(CONTACT_COLUMNS)} FROM app.contacts
    WHERE id = ${contactId} AND org_id = ${scope.organizationId} LIMIT 1
  `;
  const contact = rows[0];
  if (!contact) {
    throw new ContactError('CONTACT_NOT_FOUND', 'Contact not found', 404);
  }
  return contact;
}

export async function listContacts(
  sql: Sql,
  scope: ContactScope,
  options: {
    search?: string;
    source?: ContactSource;
    tag?: string;
    cursor?: { updatedAt: number; id: string } | null;
    limit?: number;
  } = {},
): Promise<{
  items: ContactRow[];
  nextCursor: { updatedAt: number; id: string } | null;
}> {
  assertContactAccess(scope, 'read');
  const limit = Math.min(options.limit ?? 50, 200);
  const search = options.search?.trim() ? `%${options.search.trim()}%` : null;
  const cursor = options.cursor ?? null;
  const rows = await sql<ContactRow[]>`
    SELECT ${sql.unsafe(CONTACT_COLUMNS)} FROM app.contacts
    WHERE org_id = ${scope.organizationId}
      AND lifecycle_status IS DISTINCT FROM 'trashed'
      AND (${search}::text IS NULL OR name ILIKE ${search}
        OR email ILIKE ${search} OR phone ILIKE ${search})
      AND (${options.source ?? null}::text IS NULL OR source = ${options.source ?? null})
      AND (${options.tag ?? null}::text IS NULL OR ${options.tag ?? null} = ANY(tags))
      AND (${cursor?.updatedAt ?? null}::bigint IS NULL
        OR updated_at_ms < ${cursor?.updatedAt ?? null}
        OR (updated_at_ms = ${cursor?.updatedAt ?? null} AND id < ${cursor?.id ?? null}))
    ORDER BY updated_at_ms DESC, id DESC
    LIMIT ${limit + 1}
  `;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor:
      rows.length > limit && last
        ? { updatedAt: last.updatedAt, id: last.id }
        : null,
  };
}

// ---------------------------------------------------------------- bulk

export interface BulkCreateContactItem extends Omit<
  ContactInput,
  'email' | 'source' | 'externalId'
> {
  email: string;
  /** Defaults to 'api_import' — the REST door's provenance. */
  source?: ContactSource;
  externalId?: string | number;
}

export interface BulkCreateResult {
  success: number;
  failed: number;
  errors: {
    index: number;
    error: string;
    errorCode: string;
    contact: BulkCreateContactItem;
  }[];
}

/**
 * Bulk import — per-item duplicate checks (email, externalId) with
 * continue-on-error accounting, the 0.4 `bulkCreateContacts` semantics:
 * items run sequentially, EACH IN ITS OWN transaction, so a refused item
 * never aborts the rest, and (0.4 parity) rows land without per-contact
 * audit rows — the importing call is the audited act, not each row. The
 * per-item transaction is what lets the check hold the (org, email) lock
 * until the row lands: two overlapping imports of one email used to both
 * pass the SELECT and both insert.
 */
export async function bulkCreateContacts(
  sql: Sql,
  scope: ContactScope,
  contacts: BulkCreateContactItem[],
): Promise<BulkCreateResult> {
  assertContactAccess(scope, 'write');
  const result: BulkCreateResult = { success: 0, failed: 0, errors: [] };
  for (const [index, contact] of contacts.entries()) {
    try {
      const email = normalizeContactEmail(contact.email);
      const externalId =
        contact.externalId === undefined || contact.externalId === ''
          ? undefined
          : String(contact.externalId);
      await sql.begin(async (tx) => {
        if (email !== undefined) {
          await lockContactEmail(tx, scope.organizationId, email);
          if (
            (await findLiveContactIdByEmail(
              tx,
              scope.organizationId,
              email,
            )) !== null
          ) {
            throw new ContactError(
              'duplicate_email',
              `Contact with email ${email} already exists`,
            );
          }
        }
        if (externalId !== undefined) {
          await lockContactExternalId(tx, scope.organizationId, externalId);
          if (
            (await findLiveContactIdByExternalId(
              tx,
              scope.organizationId,
              externalId,
            )) !== null
          ) {
            throw new ContactError(
              'duplicate_external_id',
              `Contact with external ID ${externalId} already exists`,
            );
          }
        }
        await insertContactRow(tx, {
          organizationId: scope.organizationId,
          name: contact.name?.trim() ?? null,
          email: email ?? null,
          phone: contact.phone ?? null,
          externalId: externalId ?? null,
          source: contact.source ?? 'api_import',
          locale: contact.locale ?? null,
          address: contact.address ?? null,
          tags: contact.tags ?? [],
          metadata: contact.metadata ?? null,
          notes: contact.notes ?? null,
        });
      });
      result.success += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        index,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: error instanceof ContactError ? error.code : 'unknown',
        contact,
      });
    }
  }
  return result;
}

/** How many rows the org has (the table header's total; the 0.4
 * `approxCountContacts` probe, answered exactly rather than by
 * walking a capped page). Trashed rows are not part of the count. */
export async function countContacts(
  sql: Sql,
  organizationId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.contacts
    WHERE org_id = ${organizationId}
      AND lifecycle_status IS DISTINCT FROM 'trashed'
  `;
  return Number(rows[0]?.count ?? '0');
}

/**
 * Palette search over the org's contacts — name, email and external id (the
 * 0.4 `searchContacts` fields), newest first and hard-capped. The snippet is
 * assembled the same way the palette rendered it in 0.4, so a hit reads
 * identically on either lane.
 */
export async function searchContacts(
  sql: Sql,
  scope: ContactScope,
  query: string,
): Promise<
  { contactId: string; name: string; snippet: string; updatedAt: number }[]
> {
  assertContactAccess(scope, 'read');
  const trimmed = query.trim();
  if (trimmed === '') return [];
  const like = `%${trimmed}%`;
  const rows = await sql<
    {
      id: string;
      name: string | null;
      email: string | null;
      externalId: string | null;
      updatedAt: number;
    }[]
  >`
    SELECT id, name, email, external_id AS "externalId",
           updated_at_ms::float8 AS "updatedAt"
    FROM app.contacts
    WHERE org_id = ${scope.organizationId}
      AND lifecycle_status IS DISTINCT FROM 'trashed'
      AND (name ILIKE ${like} OR email ILIKE ${like}
           OR external_id ILIKE ${like})
    ORDER BY updated_at_ms DESC, id DESC
    LIMIT 25
  `;
  return rows.map((row) => ({
    contactId: row.id,
    name: row.name?.trim() || row.email?.trim() || 'Contact',
    snippet: [row.email?.trim(), row.externalId]
      .filter((part): part is string => !!part && part !== '')
      .join(' · '),
    // The field the palette labels "updated" carries the row's update time —
    // the same column the ORDER BY ranks on, so the shown time and the sort
    // order agree (a hit used to ship created_at under this name).
    updatedAt: row.updatedAt,
  }));
}
