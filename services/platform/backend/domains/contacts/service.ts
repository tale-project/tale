import type { Sql, TransactionSql } from 'postgres';

import { authorizeRls } from '../../auth/access.ts';
import { toJson } from '../../db/sql.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { emitEvent } from '../events/emit.ts';

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
  readonly status: 400 | 403 | 404;

  constructor(code: string, message: string, status: 400 | 403 | 404 = 400) {
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

export async function createContact(
  tx: TransactionSql,
  scope: ContactScope,
  input: ContactInput,
): Promise<string> {
  assertContactAccess(scope, 'write');
  const email = input.email?.trim().toLowerCase();
  const now = Date.now();
  const rows = await tx<{ id: string }[]>`
    INSERT INTO app.contacts (
      org_id, name, email, phone, external_id, source, locale, address,
      tags, metadata, notes, created_at_ms, updated_at_ms
    ) VALUES (
      ${scope.organizationId}, ${input.name?.trim() ?? null}, ${email ?? null},
      ${input.phone ?? null}, ${input.externalId ?? null}, ${input.source},
      ${input.locale ?? null},
      ${input.address === undefined ? null : tx.json(toJson(input.address))},
      ${input.tags ?? []},
      ${input.metadata === undefined ? null : tx.json(toJson(input.metadata))},
      ${input.notes ?? null}, ${now}, ${now}
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) {
    throw new ContactError('CONTACT_CREATE_FAILED', 'Insert failed');
  }
  await createAuditLog(tx, {
    organizationId: scope.organizationId,
    actorId: scope.userId,
    ...(scope.email !== undefined ? { actorEmail: scope.email } : {}),
    actorType: 'user',
    action: 'contact.created',
    category: 'data',
    resourceType: 'contact',
    resourceId: id,
    ...(input.name !== undefined ? { resourceName: input.name } : {}),
    status: 'success',
  });
  await emitEvent(tx, {
    organizationId: scope.organizationId,
    eventType: 'contact.created',
    eventData: { contactId: id },
  });
  await emitHintInTx(tx, {
    orgId: scope.organizationId,
    entity: 'contact',
    entityId: id,
  });
  return id;
}

/** Find by normalized email or create with `source` (conversations lane). */
export async function findOrCreateContactByEmail(
  tx: TransactionSql,
  scope: ContactScope,
  args: { email: string; name?: string; source: ContactSource },
): Promise<{ contactId: string; created: boolean }> {
  const email = args.email.trim().toLowerCase();
  const existing = await tx<{ id: string }[]>`
    SELECT id FROM app.contacts
    WHERE org_id = ${scope.organizationId} AND email = ${email}
      AND lifecycle_status IS DISTINCT FROM 'trashed'
    LIMIT 1
  `;
  if (existing[0]) {
    return { contactId: existing[0].id, created: false };
  }
  const contactId = await createContact(tx, scope, {
    email,
    ...(args.name !== undefined ? { name: args.name } : {}),
    source: args.source,
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
    includeTrashed?: boolean;
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
      AND (${options.includeTrashed ?? false}
        OR lifecycle_status IS DISTINCT FROM 'trashed')
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
 * items run sequentially OUTSIDE one transaction so a refused item never
 * aborts the rest, and (0.4 parity) rows land without per-contact audit
 * rows — the importing call is the audited act, not each row.
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
      const email = contact.email?.toLowerCase().trim() || undefined;
      if (email !== undefined) {
        const existing = await sql<{ id: string }[]>`
          SELECT id FROM app.contacts
          WHERE org_id = ${scope.organizationId} AND email = ${email} LIMIT 1
        `;
        if (existing.length > 0) {
          throw new ContactError(
            'duplicate_email',
            `Contact with email ${email} already exists`,
          );
        }
      }
      const externalId =
        contact.externalId === undefined || contact.externalId === ''
          ? undefined
          : String(contact.externalId);
      if (externalId !== undefined) {
        const existing = await sql<{ id: string }[]>`
          SELECT id FROM app.contacts
          WHERE org_id = ${scope.organizationId}
            AND external_id = ${externalId}
          LIMIT 1
        `;
        if (existing.length > 0) {
          throw new ContactError(
            'duplicate_external_id',
            `Contact with external ID ${externalId} already exists`,
          );
        }
      }
      const now = Date.now();
      await sql`
        INSERT INTO app.contacts (
          org_id, name, email, phone, external_id, source, locale, address,
          tags, metadata, notes, created_at_ms, updated_at_ms
        ) VALUES (
          ${scope.organizationId}, ${contact.name?.trim() ?? null},
          ${email ?? null}, ${contact.phone ?? null},
          ${externalId ?? null}, ${contact.source ?? 'api_import'},
          ${contact.locale ?? null},
          ${contact.address === undefined ? null : sql.json(toJson(contact.address))},
          ${contact.tags ?? []},
          ${contact.metadata === undefined ? null : sql.json(toJson(contact.metadata))},
          ${contact.notes ?? null}, ${now}, ${now}
        )
      `;
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
