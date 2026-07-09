// Result types shared between the contact_read tool and its helpers
export type ContactReadGetByIdResult = {
  operation: 'get_by_id';
  contact: Record<string, unknown> | null;
};

export type ContactReadGetByEmailResult = {
  operation: 'get_by_email';
  contact: Record<string, unknown> | null;
};

export type ContactReadListResult = {
  operation: 'list';
  contacts: Array<Record<string, unknown>>;
  pagination: {
    hasMore: boolean;
    totalFetched: number;
    cursor: string | null;
  };
};

export type ContactReadCountResult = {
  operation: 'count';
  count: number | null;
  message: string;
  isComplete: boolean;
};

// Default field selections for each operation
export const defaultGetFields: string[] = [
  '_id',
  'name',
  'email',
  'phone',
  'source',
  'locale',
];

export const defaultListFields: string[] = [
  '_id',
  'name',
  'email',
  'phone',
  'source',
];
