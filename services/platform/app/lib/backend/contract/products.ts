/**
 * `products` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../products.ts` are what
 * actually serve them.
 */

export interface ProductsContract {
  'products/mutations:bulkCreateProducts': {
    kind: 'mutation';
    args: {
      products: Array<{
        status?: 'active' | 'archived' | 'draft' | 'inactive';
        category?: string;
        description?: string;
        imageUrl?: string;
        stock?: number;
        price?: number;
        currency?: string;
        name: string;
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
        product: unknown;
      }>;
    };
  };
  'products/mutations:createProduct': {
    kind: 'mutation';
    args: {
      status?: 'active' | 'archived' | 'draft' | 'inactive';
      metadata?: Record<string, unknown>;
      category?: string;
      description?: string;
      tags?: string[];
      imageUrl?: string;
      stock?: number;
      price?: number;
      currency?: string;
      translations?: Array<{
        metadata?: Record<string, unknown>;
        name?: string;
        createdAt?: number;
        category?: string;
        description?: string;
        tags?: string[];
        language: 'en' | 'de' | 'fr';
        lastUpdated: number;
      }>;
      organizationId: string;
      name: string;
    };
    returns: string;
  };
  'products/mutations:deleteProduct': {
    kind: 'mutation';
    args: { productId: string };
    returns: string;
  };
  'products/mutations:updateProduct': {
    kind: 'mutation';
    args: {
      status?: 'active' | 'archived' | 'draft' | 'inactive';
      metadata?: Record<string, unknown>;
      name?: string;
      category?: string;
      description?: string;
      tags?: string[];
      imageUrl?: string;
      stock?: number;
      price?: number;
      currency?: string;
      translations?: Array<{
        metadata?: Record<string, unknown>;
        name?: string;
        createdAt?: number;
        category?: string;
        description?: string;
        tags?: string[];
        language: 'en' | 'de' | 'fr';
        lastUpdated: number;
      }>;
      productId: string;
    };
    returns: string;
  };
  'products/queries:approxCountProducts': {
    kind: 'query';
    args: { organizationId: string };
    returns: number;
  };
  'products/queries:listProducts': {
    kind: 'query';
    args: { organizationId: string };
    returns: Array<{
      _id: string;
      _creationTime: number;
      status?: 'active' | 'archived' | 'draft' | 'inactive';
      metadata?: Record<string, unknown>;
      category?: string;
      description?: string;
      externalId?: string | number;
      tags?: string[];
      imageUrl?: string;
      stock?: number;
      price?: number;
      currency?: string;
      translations?: Array<{
        metadata?: Record<string, unknown>;
        name?: string;
        createdAt?: number;
        category?: string;
        description?: string;
        tags?: string[];
        language: string;
        lastUpdated: number;
      }>;
      lastUpdated?: number;
      organizationId: string;
      name: string;
    }>;
  };
  'products/queries:listProductsPaginated': {
    kind: 'query';
    args: {
      status?: string;
      category?: string;
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
        status?: 'active' | 'archived' | 'draft' | 'inactive';
        metadata?: Record<string, unknown>;
        category?: string;
        description?: string;
        externalId?: string | number;
        tags?: string[];
        imageUrl?: string;
        stock?: number;
        price?: number;
        currency?: string;
        translations?: Array<{
          metadata?: Record<string, unknown>;
          name?: string;
          createdAt?: number;
          category?: string;
          description?: string;
          tags?: string[];
          language: string;
          lastUpdated: number;
        }>;
        lastUpdated?: number;
        organizationId: string;
        name: string;
      }>;
      isDone: boolean;
      continueCursor: string;
      splitCursor?: null | string;
      pageStatus?: null | 'SplitRecommended' | 'SplitRequired';
    };
  };
}
