'use server';

import { fetchAction } from '@/lib/convex-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import type { Id } from '@/convex/_generated/dataModel';

interface RetryRagIndexingResult {
  success: boolean;
  jobId?: string;
  error?: string;
}

/**
 * Retry RAG indexing for a failed document.
 */
export async function retryRagIndexing(
  documentId: string,
): Promise<RetryRagIndexingResult> {
  try {
    const token = await getAuthToken();
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    return await fetchAction(
      api.actions.documents.retryRagIndexing,
      { documentId: documentId as Id<'documents'> },
      { token },
    );
  } catch (error) {
    console.error('[retryRagIndexing] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to retry RAG indexing',
    };
  }
}
