// Result types shared between the product_read tool and its helpers
export type ProductReadGetByIdResult = {
  operation: 'get_by_id';
  product: Record<string, unknown> | null;
};

export type ProductReadListResult = {
  operation: 'list';
  products: Array<Record<string, unknown>>;
  pagination: {
    hasMore: boolean;
    totalFetched: number;
    cursor: string | null;
  };
};

// Default field selections for each operation
export const defaultGetFields: string[] = [
  '_id',
  'name',
  'description',
  'price',
  'currency',
  'status',
  'category',
  'imageUrl',
  'stock',
];

export const defaultListFields: string[] = [
  '_id',
  'name',
  'description',
  'price',
  'currency',
  'status',
  'category',
];
