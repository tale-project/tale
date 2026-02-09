import { z } from 'zod/v4';

export const cursorPaginationOptsSchema = z.object({
  numItems: z.number(),
  cursor: z.union([z.string(), z.null()]),
  /** Optional request correlation ID for tracking pagination requests */
  id: z.number().optional(),
});
export type CursorPaginationOpts = z.infer<typeof cursorPaginationOptsSchema>;

export const offsetPaginationOptsSchema = z.object({
  page: z.number().optional(),
  pageSize: z.number().optional(),
});
export type OffsetPaginationOpts = z.infer<typeof offsetPaginationOptsSchema>;

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
