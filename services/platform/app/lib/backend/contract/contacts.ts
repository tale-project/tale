/**
 * `contacts` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../contacts.ts` are what
 * actually serve them.
 */

/**
 * One row of the org's contact directory, as every contacts read answers it:
 * the listing, its paginated twin and the single by-id read. One declaration
 * so the three cannot drift — `ContactDoc` in `./docs` is this shape.
 */
interface ContactRecord {
  _id: string;
  _creationTime: number;
  metadata?: Record<string, unknown>;
  name?: string;
  lifecycleStatus?: 'active' | 'trashed' | 'expired' | 'deleted';
  statusChangedAt?: number;
  locale?: string;
  email?: string;
  phone?: string;
  externalId?: string | number;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
  tags?: string[];
  notes?: string;
  organizationId: string;
  source:
    | 'webhook'
    | 'manual_import'
    | 'file_upload'
    | 'api_import'
    | 'conversation'
    | 'shopify'
    | 'woocommerce'
    | 'magento'
    | 'bigcommerce'
    | 'prestashop'
    | 'chargebee'
    | 'stripe'
    | 'recurly'
    | 'salesforce'
    | 'hubspot'
    | 'pipedrive'
    | 'zoho'
    | 'sap'
    | 'oracle'
    | 'netsuite'
    | 'mailchimp'
    | 'klaviyo'
    | 'sendgrid'
    | 'zapier'
    | 'custom';
}

export interface ContactsContract {
  'contacts/mutations:bulkCreateContacts': {
    kind: 'mutation';
    args: {
      contacts: Array<{
        metadata?: Record<string, unknown>;
        name?: string;
        locale?: string;
        phone?: string;
        externalId?: string;
        address?: {
          street?: string;
          city?: string;
          state?: string;
          country?: string;
          postalCode?: string;
        };
        tags?: string[];
        notes?: string;
        source:
          | 'webhook'
          | 'manual_import'
          | 'file_upload'
          | 'api_import'
          | 'conversation'
          | 'shopify'
          | 'woocommerce'
          | 'magento'
          | 'bigcommerce'
          | 'prestashop'
          | 'chargebee'
          | 'stripe'
          | 'recurly'
          | 'salesforce'
          | 'hubspot'
          | 'pipedrive'
          | 'zoho'
          | 'sap'
          | 'oracle'
          | 'netsuite'
          | 'mailchimp'
          | 'klaviyo'
          | 'sendgrid'
          | 'zapier'
          | 'custom';
        email: string;
      }>;
      organizationId: string;
    };
    returns: {
      success: number;
      failed: number;
      errors: Array<{
        index: number;
        error: string;
        errorCode: string;
        contact: unknown;
      }>;
    };
  };
  'contacts/mutations:createContact': {
    kind: 'mutation';
    args: {
      metadata?: Record<string, unknown>;
      name?: string;
      locale?: string;
      email?: string;
      phone?: string;
      address?: {
        street?: string;
        city?: string;
        state?: string;
        country?: string;
        postalCode?: string;
      };
      tags?: string[];
      notes?: string;
      organizationId: string;
      source:
        | 'webhook'
        | 'manual_import'
        | 'file_upload'
        | 'api_import'
        | 'conversation'
        | 'shopify'
        | 'woocommerce'
        | 'magento'
        | 'bigcommerce'
        | 'prestashop'
        | 'chargebee'
        | 'stripe'
        | 'recurly'
        | 'salesforce'
        | 'hubspot'
        | 'pipedrive'
        | 'zoho'
        | 'sap'
        | 'oracle'
        | 'netsuite'
        | 'mailchimp'
        | 'klaviyo'
        | 'sendgrid'
        | 'zapier'
        | 'custom';
    };
    /** The new contact's id — what the adapter's `POST /contacts` unwraps,
     *  and the shape the sibling `products/mutations:createProduct` declares.
     *  This used to read `{success, contactId}`, a 0.4 shape the pg adapter
     *  never returned; nothing consumed it, so the mismatch stayed hidden
     *  behind `useBackendMutation`'s cast. */
    returns: string;
  };
  'contacts/mutations:deleteContact': {
    kind: 'mutation';
    args: { contactId: string };
    returns: null;
  };
  'contacts/mutations:updateContact': {
    kind: 'mutation';
    args: {
      metadata?: Record<string, unknown>;
      name?: string;
      locale?: string;
      source?:
        | 'webhook'
        | 'manual_import'
        | 'file_upload'
        | 'api_import'
        | 'conversation'
        | 'shopify'
        | 'woocommerce'
        | 'magento'
        | 'bigcommerce'
        | 'prestashop'
        | 'chargebee'
        | 'stripe'
        | 'recurly'
        | 'salesforce'
        | 'hubspot'
        | 'pipedrive'
        | 'zoho'
        | 'sap'
        | 'oracle'
        | 'netsuite'
        | 'mailchimp'
        | 'klaviyo'
        | 'sendgrid'
        | 'zapier'
        | 'custom';
      email?: string;
      phone?: string;
      externalId?: string;
      address?: {
        street?: string;
        city?: string;
        state?: string;
        country?: string;
        postalCode?: string;
      };
      tags?: string[];
      notes?: string;
      contactId: string;
    };
    returns: null | {
      _id: string;
      _creationTime: number;
      metadata?: Record<string, unknown>;
      name?: string;
      lifecycleStatus?: 'active' | 'trashed' | 'expired' | 'deleted';
      statusChangedAt?: number;
      locale?: string;
      email?: string;
      phone?: string;
      externalId?: string | number;
      address?: {
        street?: string;
        city?: string;
        state?: string;
        country?: string;
        postalCode?: string;
      };
      tags?: string[];
      notes?: string;
      organizationId: string;
      source:
        | 'webhook'
        | 'manual_import'
        | 'file_upload'
        | 'api_import'
        | 'conversation'
        | 'shopify'
        | 'woocommerce'
        | 'magento'
        | 'bigcommerce'
        | 'prestashop'
        | 'chargebee'
        | 'stripe'
        | 'recurly'
        | 'salesforce'
        | 'hubspot'
        | 'pipedrive'
        | 'zoho'
        | 'sap'
        | 'oracle'
        | 'netsuite'
        | 'mailchimp'
        | 'klaviyo'
        | 'sendgrid'
        | 'zapier'
        | 'custom';
    };
  };
  'contacts/queries:approxCountContacts': {
    kind: 'query';
    args: { organizationId: string };
    returns: number;
  };
  'contacts/queries:getContact': {
    kind: 'query';
    args: { contactId: string };
    returns: ContactRecord;
  };
  'contacts/queries:listContacts': {
    kind: 'query';
    /** `search` narrows the page server-side (the door's ILIKE over name,
     *  email and phone). Without it the read answers the directory's first
     *  page, which is the browsable default a picker opens on. */
    args: { organizationId: string; search?: string };
    returns: Array<ContactRecord>;
  };
  'contacts/queries:listContactsPaginated': {
    kind: 'query';
    args: {
      search?: string;
      locale?: string;
      source?: string;
      organizationId: string;
      paginationOpts: {
        id?: number;
        endCursor?: null | string;
        maximumRowsRead?: number;
        maximumBytesRead?: number;
        numItems: number;
        cursor: null | string;
      };
    };
    returns: {
      page: Array<ContactRecord>;
      isDone: boolean;
      continueCursor: string;
      splitCursor?: null | string;
      pageStatus?: null | 'SplitRecommended' | 'SplitRequired';
    };
  };
  'contacts/search:searchContacts': {
    kind: 'query';
    args: { organizationId: string; query: string };
    returns: Array<{
      contactId: string;
      name: string;
      snippet: string;
      updatedAt: number;
    }>;
  };
}
