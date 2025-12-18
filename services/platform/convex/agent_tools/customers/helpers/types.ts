// Result types shared between the customer_read tool and its helpers
export type CustomerReadGetByIdResult = {
  operation: 'get_by_id';
  customer: Record<string, unknown> | null;
};

export type CustomerReadGetByEmailResult = {
  operation: 'get_by_email';
  customer: Record<string, unknown> | null;
};

export type CustomerReadListResult = {
  operation: 'list';
  customers: Array<Record<string, unknown>>;
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
  'email',
  'status',
  'source',
  'locale',
];

export const defaultListFields: string[] = [
  '_id',
  'name',
  'email',
  'status',
  'source',
];
