/**
 * Contact workflow actions
 *
 * Safe, specialized operations for contact data in workflows — the single
 * directory that replaced the former customers + vendors actions (issue #2618).
 * A contact is any person/organization the org corresponds with (customers,
 * leads, vendors/suppliers). These actions:
 * - Use Convex indexes for efficient queries
 * - Require organizationId or contactId to prevent accidental bulk operations
 * - Support flexible filtering on metadata fields
 * - Support JEXL expression-based filtering for advanced queries
 *
 * Operations:
 * - create: Create a new contact
 * - filter: Filter contacts using JEXL expressions (⚠️ loops through ALL contacts - use carefully)
 * - query: Query contacts with pagination and filtering (uses indexes - RECOMMENDED)
 * - update: Update a contact by id
 * - get: Fetch a single contact by id
 *
 * ⚠️ Filter operation warning:
 * The filter operation loops through ALL contacts in the organization.
 * Use with caution on large datasets. For simple queries, prefer the 'query' operation.
 *
 * Filter operation example:
 * {
 *   operation: 'filter',
 *   expression: 'source == "shopify" && daysAgo(_creationTime) < 30'
 * }
 */

import { type Infer, v } from 'convex/values';

import { internal } from '../../../_generated/api';
import {
  contactAddressValidator,
  contactSourceValidator,
} from '../../../contacts/validators';
import { toConvexJsonRecord, toId } from '../../../lib/type_cast_helpers';
import { jsonRecordValidator } from '../../../lib/validators/json';
import type { ActionDefinition } from '../../helpers/nodes/action/types';

// Derived from the shared validators so the param types can never drift from
// the shapes the `parametersValidator` actually accepts.
type ContactAddress = Infer<typeof contactAddressValidator>;
type ContactSource = Infer<typeof contactSourceValidator>;

// Update payload — mirrors the `updates` shape accepted by
// `contacts/internal_mutations.ts::updateContacts`.
const contactUpdateValidator = v.object({
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  source: v.optional(contactSourceValidator),
  locale: v.optional(v.string()),
  address: v.optional(contactAddressValidator),
  tags: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
});

const paginationOptsValidator = v.object({
  numItems: v.number(),
  cursor: v.union(v.string(), v.null()),
});

// Type for all contact operation params (discriminated union)
type ContactActionParams =
  | {
      operation: 'create';
      name?: string;
      email?: string;
      phone?: string;
      externalId?: string | number;
      source: ContactSource;
      locale?: string;
      address?: ContactAddress;
      tags?: string[];
      notes?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      operation: 'filter';
      expression: string;
    }
  | {
      operation: 'query';
      paginationOpts: { numItems: number; cursor: string | null };
      externalId?: string | number;
      source?: ContactSource;
      locale?: string;
    }
  | {
      operation: 'update';
      contactId: string;
      updates: Infer<typeof contactUpdateValidator>;
    }
  | {
      operation: 'get';
      contactId: string;
    };

export const contactAction: ActionDefinition<ContactActionParams> = {
  type: 'contact',
  title: 'Contact Operation',
  description:
    'Execute contact-specific operations (create, filter, query, update, get). organizationId is automatically read from workflow context variables.',
  parametersValidator: v.union(
    // create: Create a new contact
    v.object({
      operation: v.literal('create'),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      externalId: v.optional(v.union(v.string(), v.number())),
      source: contactSourceValidator,
      locale: v.optional(v.string()),
      address: v.optional(contactAddressValidator),
      tags: v.optional(v.array(v.string())),
      notes: v.optional(v.string()),
      metadata: v.optional(jsonRecordValidator),
    }),
    // filter: Filter contacts using JEXL expressions
    v.object({
      operation: v.literal('filter'),
      expression: v.string(),
    }),
    // query: Query contacts with pagination
    v.object({
      operation: v.literal('query'),
      paginationOpts: paginationOptsValidator,
      externalId: v.optional(v.union(v.string(), v.number())),
      source: v.optional(contactSourceValidator),
      locale: v.optional(v.string()),
    }),
    // update: Update a contact by id
    v.object({
      operation: v.literal('update'),
      contactId: v.id('contacts'),
      updates: contactUpdateValidator,
    }),
    // get: Fetch a single contact by id
    v.object({
      operation: v.literal('get'),
      contactId: v.id('contacts'),
    }),
  ),
  async execute(ctx, params, variables) {
    // Read organizationId from workflow context variables with proper type validation
    const organizationId = variables.organizationId;
    if (typeof organizationId !== 'string') {
      throw new Error(
        'contact action requires a string organizationId in workflow context',
      );
    }

    switch (params.operation) {
      case 'create': {
        const result = await ctx.runMutation(
          internal.contacts.internal_mutations.createContact,
          {
            organizationId,
            name: params.name,
            email: params.email,
            phone: params.phone,
            source: params.source,
            locale: params.locale,
            address: params.address,
            externalId: params.externalId,
            tags: params.tags,
            notes: params.notes,
            metadata: params.metadata
              ? toConvexJsonRecord(params.metadata)
              : undefined,
          },
        );

        // Fetch and return the full created entity.
        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        const createdContact = await ctx.runQuery(
          internal.contacts.internal_queries.getContactById,
          { contactId: result.contactId, callerOrgId: organizationId },
        );

        if (!createdContact) {
          throw new Error(
            `Failed to fetch created contact with ID "${result.contactId}"`,
          );
        }

        return createdContact;
      }

      case 'filter': {
        // ⚠️ WARNING: This operation loops through ALL contacts in the organization.
        // Use with caution on large datasets. For simple queries, prefer the 'query' operation.
        const result = await ctx.runQuery(
          internal.contacts.internal_queries.filterContacts,
          {
            organizationId,
            expression: params.expression,
          },
        );

        return result.contacts;
      }

      case 'query': {
        const result = await ctx.runQuery(
          internal.contacts.internal_queries.queryContacts,
          {
            organizationId,
            externalId: params.externalId,
            source: params.source,
            // queryContacts accepts locale as an array of accepted values.
            locale: params.locale ? [params.locale] : undefined,
            paginationOpts: params.paginationOpts,
          },
        );

        return {
          page: result.page,
          isDone: result.isDone,
          continueCursor: result.continueCursor,
        };
      }

      case 'update': {
        const contactId = toId<'contacts'>(params.contactId);

        await ctx.runMutation(
          internal.contacts.internal_mutations.updateContacts,
          {
            contactId,
            // Org-scope the by-id update so a workflow can't patch another
            // tenant's contact (engages the updateContacts guard).
            organizationId,
            updates: params.updates,
          },
        );

        // Fetch and return the updated entity.
        const updatedContact = await ctx.runQuery(
          internal.contacts.internal_queries.getContactById,
          { contactId, callerOrgId: organizationId },
        );

        if (!updatedContact) {
          throw new Error(
            `Failed to fetch updated contact with ID "${contactId}"`,
          );
        }

        return updatedContact;
      }

      case 'get': {
        const contact = await ctx.runQuery(
          internal.contacts.internal_queries.getContactById,
          {
            contactId: toId<'contacts'>(params.contactId),
            callerOrgId: organizationId,
          },
        );
        return contact;
      }

      default: {
        const unhandled: never = params;
        throw new Error(
          `Unsupported contact operation: ${JSON.stringify(unhandled)}`,
        );
      }
    }
  },
};
