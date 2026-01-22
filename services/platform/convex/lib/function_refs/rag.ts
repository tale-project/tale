/**
 * Type-safe function references for RAG module.
 */

import type { FunctionReference } from 'convex/server';
import { createRef } from './create_ref';

export type SearchRagDocumentsRef = FunctionReference<
  'action',
  'internal',
  {
    query: string;
    organizationId: string;
    userId?: string;
    userTeamIds?: string[];
    limit?: number;
  },
  Array<{
    id: string;
    text: string;
    score: number;
    metadata?: Record<string, unknown>;
  }>
>;

export function getSearchRagDocumentsRef(): SearchRagDocumentsRef {
  return createRef<SearchRagDocumentsRef>('internal', ['rag', 'actions', 'searchRagDocuments']);
}
