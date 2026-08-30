/**
 * `contacts` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../contacts.ts` are what
 * actually serve them.
 */

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
    returns: { success: boolean; contactId: string };
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
  'contacts/queries:listContacts': {
    kind: 'query';
    args: { organizationId: string };
    returns: Array<{
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
    }>;
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
      page: Array<{
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
      }>;
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
